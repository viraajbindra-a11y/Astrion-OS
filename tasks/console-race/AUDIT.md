# Console async-output race fix — boot audit (Rex)

**Commit:** cf266d0 "kernel: fix console async-output render race"
**CI run:** 29667483179 (success, 36s) · artifact `astrion-grub-iso`
**ISO sha256:** `12e32ca7f9faaacaded3f97576fcd046ac527560d30110a14014be87b6d88315`
**Rig:** `qemu-system-x86_64 -cdrom astrion-grub.iso -m 256M -accel tcg -serial file -monitor unix:/tmp/rexc.sock -display none -no-reboot`
**Frames:** `tasks/console-race/frames/` · **Serial:** `serial-main-boot.log`, `serial-boot2.log`

Verdict: **the race I reported twice is GONE.** No regressions found that are
attributable to this commit. One pre-existing cosmetic defect found and proven
pre-existing by A/B against the prior build.

---

## 1. CRITICAL — scheduler alive after a task exits (the IF=0 freeze hazard)

Koa's riskiest change: `console_unlock` must precede `task_exit()`, which never
returns. If wrong, the next task inherits interrupts-off and the scheduler stops.

**CONFIRMED — no freeze on either path.**

| path | clock before → after | shell after | pmm |
|---|---|---|---|
| baseline (no exec) | 00:47:57 → 00:48:04 | — | — |
| `exec hello.elf` (normal exit, syscall.c) | 00:48:21 → 00:48:31 | accepted `pmm` | 55776/55776 |
| `exec rogue.elf` (#PF kill, idt.c) | 00:48:52 → 00:49:02 | accepted `pmm` | 55776/55776 |

Frames `02`,`03`,`04` (normal exit) and `05`,`06`,`07` (kill). Clock kept ticking
through both; the shell took and executed a command after each. Red kill line
still renders: `[kernel] user task 'rogue.elf' killed: #PF page fault (ring-3
isolation held)`. Serial: exactly ONE ring-3 fault, no triple/#GP/reset.

## 2. THE REPRO — back-to-back exec

Old signature (M4): 2nd `hello` **dropped** the `uptime` row and **duplicated**
the `CPL 3` row; `iodemo` duplicated its `launched` row.

**CONFIRMED FIXED.** 5 back-to-back `exec hello.elf` (frames `10-btb-run1..5`)
plus a 3-deep burst (`11`) and 3× `exec iodemo.elf` (`12-iodemo-run1..3`).
Every run printed complete: `launched` ×1, `Hello from RING 3`, `I run at CPL 3`
×1 (previously duplicated), `uptime when I started: <n> ms` present (previously
dropped), `tick 1..5` all five exactly once, `goodbye`, `exited (code 0)`.
Distinct uptimes per run (164990 / 167430 / 172300 / 206390 ms) confirm these are
genuinely separate runs, not a stale frame. iodemo: exactly one `launched` line
in all 3 runs. **Zero dropped rows, zero duplicated rows across 9 exec runs.**

Residue (known, by design, unchanged): the returning prompt can share a *row*
with ring-3 output, e.g. `astrion:/> Hello from RING 3 - ...`. Character-level
interleave between separate calls. Cosmetic; no row is torn or lost.

## 3. INTERRUPT LATENCY — dropped keystrokes (Koa did not measure this)

Method: type a 36-char known string `abcdefghijklmnopqrstuvwxyz0123456789` at
~12 ms/key, then read the input line off the frame. A control condition isolates
harness drops from kernel drops.

| condition | trials | result |
|---|---|---|
| A idle console (control) | 3 | 36/36 chars, in order (`22-A-idle-t1..3`) |
| B during heavy `help` scroll | 3 | 36/36 (`23-B-during-help-t1..3`) |
| C during `exec hello.elf` async output | 1 | 36/36 (`21`) |
| D immediately after `clear` | 2 | 36/36 (`24-D-after-clear-t1..2`) |

**324 keystrokes, zero dropped, zero duplicated, zero reordered.** No visible
clock stall during heavy scrolling (00:53:48 → 00:54:03 → 00:54:09 → 00:54:14,
monotonic). I could not feel or measure the latency Koa was worried about.

Caveat — capture timing, not a defect: my first control frame (`20`) showed only
26 chars. That was my screendump firing mid-type, not a kernel drop; it did not
recur once I settled 1.5 s before capture. Flagging it so nobody re-reads that
frame as a finding.

## 4. Regressions

- **Typing + backspace** — CONFIRMED. `pmmXXXX` + 4×backspace → exactly `pmm` (`43`).
- **Scroll past a full screen** — CONFIRMED. `help` scrolls the full region
  cleanly, no torn or doubled rows (`23`, `71`).
- **Window over Terminal** — CONFIRMED. Files opened over the Terminal *while a
  ring-3 task was printing* (the unlocked-`console_redraw` seam), ×3. Window
  rendered correctly, console kept printing underneath, Esc repainted the
  terminal perfectly (`40-overlap-open-t1..3`, `41-overlap-closed-t1..3`).
  **I could not produce persistent visual corruption at this seam.** Koa's
  known gap stands as an acceptable trade.
- **Panic** — CONFIRMED with a real panic (`60`). Full panic screen: vector
  `#BP breakpoint`, RIP/RSP/RFLAGS/RAX-RDX, `system halted — power-cycle to
  recover`. No deadlock; the path bypasses the console as claimed.
- **Redirection (`console_set_capture` now locked)** — CONFIRMED. `pmm > cap.txt`
  → `-> cap.txt (162 bytes)`; `cat cap.txt` returns the complete capture (`44`).
- **Clock** — ticked monotonically across the entire session, 00:47:57 → 01:00:36.

## 5. Tier 3 sanity

`isotest` ×2: A `0x26c9000` / B `0x26ca000`, distinct frames yes, A↔B isolated
yes, 55776 before/after, PASS. `vmtest`: PASS, 55776 before/after. `vmswitch`:
`task ran 0x26d4000` == `space cr3` != `kernel cr3 0x20a000`, sentinel
`0x5704deadc0de5704`, counter 0→1, 55776 before/after, PASS. `pmm` PASS and
back to the 55776 baseline after the entire sequence. Single boot banner on both
boots; only fault in serial is the intentional rogue kill.

---

## FINDING (pre-existing, NOT from this commit) — stale mouse-cursor backing store

A dark rectangle is stamped into the Terminal, overwriting console text, and
persists until that row is repainted.

**Repro (deterministic):**
1. Boot to desktop. **Do not touch the mouse** — the cursor sits at its boot home
   position (~640,415), over the Terminal body.
2. Run `help` three times. The console scrolls/repaints *underneath* the
   stationary cursor.
3. Move the mouse for the first time.
4. A ~26×32 px rectangle in colour `(23,27,46)` — the boot-era window background —
   is stamped at the cursor's old position over console bg `(30,39,97)`,
   obscuring text (frame `72`: it eats the `r` of `background counter`).

Mechanism: the cursor saves the pixels beneath it; console repaints under a
stationary cursor invalidate that savebuf; the next move restores stale pixels.
Same family as the window-savebuf bug Koa fixed earlier.

**Proven pre-existing.** Identical sequence on the pre-fix build a063698
(CI 29627038196, ISO sha `28613e7a…`) produces the same artifact. The box region
(636,400)-(668,436) is **pixel-identical** between the two builds. Frames `72`
(cf266d0) vs `82-PREV` (a063698). cf266d0 touches no mouse or window code.
Low severity, self-heals on the next repaint of that row — but it is visible on
screen and would show in a demo if the presenter leaves the mouse parked.

## Not verified

- **Splash accent colour** (mira's open item) — NOT CAPTURED. Both boots reached
  the desktop before my first screendump landed; frame `70` is already the
  terminal. I cannot confirm blue-vs-orange from this session. Unverified, not
  disputed. (Note: the *panic* screen's top bar is orange — that is the panic
  screen, not the splash.)
- **Bounded hole in the fix, by design:** `sys_puts_user` releases the lock at
  every `\n` *or* every 256 chars, so a ring-3 line longer than 256 chars can
  still interleave mid-row. Deliberate (a user program must not be able to park
  interrupts). Not reachable with hello/iodemo; noted so nobody calls the lock
  absolute.
- Concurrent ring-3 printers: `exec` returns the prompt immediately, but runs
  serialised in practice on this build — I could not get two ring-3 tasks
  printing simultaneously to stress the lock harder.
