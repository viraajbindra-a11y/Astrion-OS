# Tier 3 M4 — exec per-process address spaces — BOOT AUDIT

Commit 3ff274f · CI run 29625190968 (completed/success) · artifact astrion-grub-iso
Booted: qemu-system-x86_64 11.0.0, -m 256M -accel tcg, -no-reboot, serial->file.
Driven by monitor `sendkey` (shell focused on boot). Frames in `frames-m4/`.
Serial: `/tmp/rexm4-ser.txt` (session-local). PMM baseline free = **55776**.

VERDICT: **PASS.** exec runs ring-3 syscalls under its OWN CR3 and prints — no
kernel #PF, no panic. Isolation proven, rogue still killed, zero frame leak.
One non-blocking cosmetic finding (console scroll race, pre-existing).

---

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Boot clean, one banner, desktop | CONFIRMED | serial: 1x "Astrion", 0 panic/triple/reset, ends `TASKS: scheduler up`. frame 01-desktop.png: desktop + Terminal "astrion shell ready", clock ticking |
| 2 | **exec hello.elf prints under own CR3, exit 0** | **CONFIRMED** | frame 03-exec-hello.png: "launched hello.elf ... tid 2", program's own lines (Hello from RING 3 / CPL 3 / uptime / tick 1-5 / goodbye), green "exec: hello.elf exited (code 0)". serial: **0 KERNEL PANIC**, "elf: loaded into ring-3 window ok" |
| 3 | isotest: two spaces, same VA -> distinct frames, no cross-visibility, no leak | CONFIRMED (x3) | frames 04,05. Same VA 0x2000000000 (128GiB) -> distinct frames; all 3 runs "distinct frames yes", "A isolated from B yes", "B isolated from A yes", "55776 before / 55776 after", green PASS |
| 4 | exec rogue.elf #PF-killed cleanly, kernel survives, clock ticks | CONFIRMED | frame 06-exec-rogue.png: rogue prints its line, then red "[kernel] user task 'rogue.elf' killed: #PF page fault (ring-3 isolation held)"; clock advanced 01:32:53->01:33:25. serial: exactly 1 "[ring3 fault] #PF", 0 panic |
| 5 | Fresh space each exec; ring-3 file I/O under per-process CR3 | CONFIRMED | frames 07,08 (hello 2nd+3rd run, both exit 0); frame 09-exec-iodemo.png: "iodemo: wrote ring3.txt (47 bytes)" + "read it back -> hello from a ring-3 program, saved via syscall" |
| 6 | pmm balances — no leak across exec/kill/isotest | CONFIRMED | frame 02 (before) = 55776 free; frame 10 (after hello x3 + rogue + iodemo + isotest x3) = 55776 free. Identical. self-test PASS both |
| — | Session invariants | CONFIRMED | 1 boot banner, 0 KERNEL PANIC, 0 triple/reset/reboot, 0 #GP/#DF, exactly 1 ring3 fault (rogue), 1 scheduler-up, QEMU never rebooted |

## isotest frame addresses (same VA 0x2000000000 in every run, always DISTINCT)
- run 1: A -> 0x0000000002616000, B -> 0x0000000002617000
- run 2: A -> 0x0000000002620000, B -> 0x0000000002621000
- run 3: A -> 0x000000000262a000, B -> 0x000000000262b000
Frames rotate (pmm rotating hint) but A != B every time; 55776 before/after every run.

## Non-blocking finding (NOT an M4 regression)
Console scroll/concurrency render race on the exec async-output path. When the
shell returns to its prompt while the spawned ring-3 task is still printing, the
two concurrent console writers occasionally garble ONE row:
 - hello 2nd run (frame 07): the "uptime when I started" line was replaced by a
   duplicated "I run at CPL 3..." line; shell prompt interleaved before "tick 2".
 - iodemo (frame 09): the "exec: launched iodemo.elf ... tid 2" line printed twice.
Re-running with more settle time (frame 08) produced the correct, complete output,
so this is a transient render artifact, NOT deterministic. The underlying data is
always correct (bytes written, file contents, exit codes, isolation, pmm balance).
Pre-existing: exec has spawned async-printing ring-3 tasks since M2/M3; M4 did not
touch the console. Cosmetic only. Flagged to koa for the console lock, not a blocker.
