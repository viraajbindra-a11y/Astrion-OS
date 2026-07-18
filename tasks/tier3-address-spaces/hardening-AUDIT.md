# Tier 3 HARDENING (F1/F2/F3) — BOOT RE-VERIFY

Commit **a063698** · CI run **29627038196** (completed/success) · artifact astrion-grub-iso
Booted: qemu-system-x86_64 11.0.0, `-m 256M -accel tcg -no-reboot`, serial->file.
Driven by monitor `sendkey` (shell focused on boot), no mouse. Frames in `frames-hardening/`.
Serial: `/tmp/rexh-ser.txt`. PMM baseline free = **55776**. Heap baseline = **used 200 KiB, blocks 15/1, net-live (allocs-frees) 14**.

Gating per Koa's caveat: PASS on **frame-count BALANCE + A != B + sentinel isolation**, NOT on specific hex (PDPT now allocs at create, addresses may rotate).

## VERDICT: **PASS. No regressions. F3 did not introduce a paging bug.**
Every address space (vmtest, vmswitch, isotest x2/run, and 4 exec'd programs) exercised the F3 fork-at-create path. No triple-fault, no leak, isolation intact. F1 heap balances exactly with zero drift over repeated exec.

---

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Boots clean, one banner, desktop | **CONFIRMED** | serial: exactly 1 "=== Astrion" banner, 1 "scheduler up", 0 panic/triple/reset. accent readback `0x0a84ff OK` (blue). PMM `55776 free / 55776`. frame 01: desktop + Terminal "shell ready", clock ticking |
| 2 | vmtest + vmswitch PASS (create-forked space built + switched-to) | **CONFIRMED** | frame 03 vmtest: `uva 0x2000000000 -> frame 0x260a000`, `55776 before / 55776 after`, PASS. frame 04 vmswitch: `task ran 0x260d000` == `space cr3 0x260d000` != `kernel cr3 0x20a000`, sentinel `0x5704deadc0de5704`, `counter 0 -> 1`, `55776 before/after`, PASS |
| 3 | isotest x3: same VA -> distinct frames, sentinels isolated, balanced | **CONFIRMED (x3)** | frames 05/06/07. Same VA `0x2000000000` -> A!=B every run (run1 0x2616/0x2617, run2 0x2620/0x2621, run3 0x262a/0x262b). All 3: "distinct frames yes", "A isolated from B yes", "B isolated from A yes", `55776 before/after`, PASS |
| 4 | exec hello.elf prints under own CR3, exits 0; pmm+heap balance (F1) | **CONFIRMED (x3)** | frames 09/10/11: 3 runs, full ring-3 output (Hello from RING 3 / CPL 3 / uptime / tick 1-5 / goodbye), green "exited (code 0)", all launched as tid 2 (reaped + recycled). frame 12 pmm after = `55776`. frame 13 heap after = **used 200 KiB, blocks 15/1, allocs 41/frees 27 (net-live 14)** — IDENTICAL to baseline. Zero heap drift over 3 execs |
| 5 | exec rogue.elf #PF-killed, kernel survives, space reclaimed | **CONFIRMED** | frame 14: `rogue: I am ring 3...`, red `[kernel] user task 'rogue.elf' killed: #PF page fault (ring-3 isolation held)`, prompt returned, clock advanced 22:54->22:55. serial line 88: exactly 1 "[ring3 fault] #PF ... kernel survives" |
| 6 | Final pmm = baseline; single banner, only expected fault | **CONFIRMED** | frame 15 final pmm = `55776 free / 55776` after WHOLE sequence incl. rogue kill. serial: 1 banner, 1 scheduler-up, exactly 1 ring-3 fault (rogue), 0 triple/panic/#GP/#DF/reset |

## F1/F2/F3 disposition
- **F1 (exec_ctx free moved to reap):** CONFIRMED FIXED. Heap net-live (allocs-frees) held at 14 across 3 exec cycles; allocs +15 / frees +15, perfectly matched; `used` returned to exactly 200 KiB. The 16-byte exec_ctx is reclaimed every cycle — no per-exec heap creep. (peak 216->229 KiB is transient high-water, not a leak; current `used` back to 200.) Did NOT chase the kill-before-run race — near-impossible under preemption, and balance-after-normal-exec is the practical proxy Koa named.
- **F2 (dead-branch fail-safe):** vmspace_map now refuses (-1) on a not-present PML4[0] instead of building a kernel-less PDPT. Post-F3, create always makes PML4[0] present, so this branch is **never taken on any live path** — it's defensive dead code. Not runtime-observable by design; boot proves its presence broke none of the reachable paths.
- **F3 (fork PML4[0] at create):** CONFIRMED. The load-bearing risk — a create-forked space switched-to must not fault — is directly proven by vmswitch (CR3 loaded into a create-forked space, ran real code, returned) and by 3 exec hello runs (ring-3 code under per-process create-forked CR3, printing via syscall, exiting clean, no kernel #PF). Isolation only got stronger; zero leak; no triple-fault.

## Serial invariants (single boot)
1x "=== Astrion" banner · 1x "scheduler up" · 4x "elf: loaded into ring-3 window ok" (3 hello + 1 rogue) · exactly 1x "[ring3 fault] #PF ... kernel survives" (the rogue) · 0x triple/panic/#GP/#DF/double-fault/reset/reboot.

## Non-blocking (NOT a hardening regression, pre-existing)
Console async-output render race on exec: when the shell reprints its prompt while a spawned ring-3 task is still printing, one row occasionally interleaves (e.g. `astrion:/>` landing mid "tick 2" in frame 10, or heap's `used:` line dropping in frame 14). Documented in M4-AUDIT. Non-deterministic, cosmetic; underlying data (exit codes, tick counts, balances) always correct. Flagged to koa previously for a console lock.
