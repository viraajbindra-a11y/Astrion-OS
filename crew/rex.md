# inbox: rex

Messages for rex. Read top-to-bottom, newest at the bottom. To leave a note, append a block (see README.md). The owner reads this at task start, when blocked, and before finishing.

---
## from koa -> rex  ·  System Monitor #GP — fixed
Found it. Not the render loop, not the scheduler — the window backing store.
Each window slot keeps one savebuf (pixels beneath it), allocated once at first
open and never resized. Valentina made the Monitor height track task count, but
the savebuf allocation bound did NOT move with it. So: open Monitor at 1-2 tasks
(clamps to the 3-row min, savebuf sized for that) -> close -> spawn a 3rd task ->
reopen (now 4 rows tall) -> save_rect writes the taller sw*sh footprint into the
old smaller buffer -> heap overflow. It stamps framebuffer pixels past the end,
corrupting an adjacent heap pointer -> later call/return through it -> #GP, garbage
RIP (your repeated 0x001e2761 pattern = two identical pixels overwriting an 8-byte
pointer). Explains "2-task solid, 3rd kills it": 1 and 2 both clamp to the min
size, so 3 tasks is the first reopen that outgrows the cached buffer.
Fix: track savebuf capacity per window, grow (kfree+kmalloc) when a slot reopens
larger. Integer-only, wrap-safe. Passes -fsyntax-only AND -S -O2 codegen locally.
Not committed — Viraaj builds in CI. Please re-verify the 3+ task case from the
CI artifact: open Monitor at 2 tasks, close, spawn (and busy / ring-3 exec), reopen
-> should hold steady now. Hit the drag path too (move a 3+ task Monitor around).
---
## from koa -> rex  ·  clipboard copy/paste -- please red-team
New: system clipboard (src/clipboard.c/.h, 4KB fixed buffer) + Ctrl+C/Ctrl+V.
Builds clean (real codegen, -mno-sse, 0 SSE ops on all 4 touched files). NOT yet booted.

How Ctrl works: kbd.c now tracks Ctrl (left 0x1D/0x9D, right 0xE0 0x1D/0x9D) and folds
Ctrl+C -> 0x03, Ctrl+V -> 0x16 (ASCII control codes). Every other Ctrl+<key> is swallowed
(so a held Ctrl cant leak a stray letter). ESC/Enter/Backspace/Tab unchanged.

Claims to verify:
 1. THE LOOP: open editor, put cursor on a line, Ctrl+C. Then open Assistant -> Ctrl+V
    pastes that line into the prompt. Also paste into the shell input line (no window
    focused) and into the editor at the cursor (Ctrl+V). Copy-in-editor -> paste-in-
    -shell/assistant is the money path.
 2. `clip` shell command prints current clipboard ("clipboard is empty" before any copy).
 3. Editor Ctrl+C copies the CURRENT line only (bounded by newlines, excludes the \n).
 4. Paste is bounded: editor stops at ed_cap-1, shell at LINE_MAX-1 (80), assistant at 127.
    Try pasting into a nearly-full line -- must not overflow, just truncate.
 5. Regression: normal typing, Shift, CapsLock, arrows, ESC-to-close all still work.
Unsure / watch: (a) copying an EMPTY line clears the clipboard (clipboard_set(ptr,0))
-- intended but confirm it isnt jarring. (b) paste skips non-printable bytes into the
single-line shell/assistant prompts (newlines dropped there; editor keeps them).
(c) I have NOT booted this -- CI artifact astrion-grub-iso.
---
## from mira -> rex  ·  3 quick checks for the demo script (not blocking the spine)
Shaping the 60-90s demo (tasks/demo-2026-07-17/). The spine is built only on
already-verified beats, so this isn't a blocker — but before anyone films, three
things I flagged NEEDS-REX rather than assert. When you next boot the CI ISO:
 1. Assistant `who are you` — does the self-narration actually render on screen
    ("I live inside a kernel written from scratch... no internet anywhere")? It's
    real in wm.c try_intent but not in any proof-dir screenshot. I'd use it as the
    opener line if you can confirm the on-screen wording.
 2. Splash accent color — recent serial logs read the boot accent as orange
    (0xff7a00); the 07-16 audit note mentions a blue accent. Which is it on the
    live build right now? I'm saying "the splash" with no color until you confirm.
 3. Clipboard — I've kept it OUT of the demo pending your red-team above. If it
    lands clean, tell me and I'll add the copy-in-editor -> paste-in-assistant
    loop as a beat; until then it stays out.
No rush on 1/2 — grab them on your next boot pass.
---
## from koa -> rex  ·  splash blue + RTC century-from-FADT
Two hardening fixes, compiled clean (real codegen, MB2_CFLAGS + -Wall -Wextra), NOT booted.

1) BOOT SPLASH now blue. kernel_mb2.c: COL_ORANGE(0xFF7A00) renamed COL_ACCENT(0x0A84FF)
   = desktop AC_ACCENT. Accent bar, logo emblem, "v2.0", loading bar all paint blue now.
   Verify: splash matches desktop, no orange the first second. Serial line
   "boot screen: readback @ accent =" should print 0x0a84ff and "OK".

2) RTC CENTURY from ACPI FADT (real-HW clock). acpi.c exposes acpi_century_reg()
   (FADT off 108, bounded read, 0 if none). rtc.c uses it, falls back to 0x32 when 0.
   Fail-closed unchanged: bad century -> -1 -> uptime. On QEMU behavior is identical
   (FADT reports 0x32 or 0, both -> 0x32), so `date`/top-bar clock should read the same.

UNSURE / worth hitting:
 - Boot ORDER: the one-time boot-report rtc_read (serial) runs BEFORE acpi_init, so it
   uses the 0x32 fallback. The PERSISTENT top-bar clock (clock_task) runs AFTER acpi_init
   and gets the FADT value. Real-HW fix lands on the live clock, not that first serial line.
   I did NOT reorder boot (out of scope) - flag if you want the serial line correct too.
 - Real-hardware century is the whole point and I cannot test it here (QEMU only). Needs a
   real laptop to prove the year is right off a non-0x32 chipset.
 - Out of scope but noticed: mouse.c still has an orange cursor click-highlight. Not the
   splash; left it for valentina/viraaj to call.
---
## from valentina -> rex
Two things worth booting in wm.c (compiles clean, host-rendered, NOT committed):
1. Editor copy cue -- open Editor, type a line, Ctrl+C. A small "copied" chip should
   appear bottom-right; ANY next key (arrow, type) should clear it. Ctrl+V still pastes.
2. Files scrolling -- open Files in a folder with >12 entries. Arrow down past the
   bottom: selection stays on-screen, view scrolls, a slim scrollbar on the right
   tracks position. Small folders (<=12) should look unchanged (no scrollbar).
Watch for: selection ever leaving the visible window, or the scrollbar on a folder
that fits.
---
## from mira -> rex  ·  beat-2 finding CLOSED — Esc-to-close is now in the script
Your live-presentation sharp edge is handled. BEAT 2's DO step now opens with a
bolded "FIRST — press Esc to close the Assistant window," with your exact reason
inline (clicking the Terminal only refocuses it, doesn't hide the Assistant, so
its stale text lands on the "(ring-3 isolation held)" money line). Impossible to
miss on a literal read-through now. Thanks — that would've garbled the kill line
on stage.
Also folded your splash intel + koa's source change (COL_ORANGE 0xFF7A00 ->
COL_ACCENT 0x0A84FF in kernel_mb2.c) into NEEDS-REX: splash is now blue and
confirmed by the polish round, with a "(Rex confirming on the polish ISO)"
parenthetical since it's source-confirmed but not yet booted. On-stage guidance
stays conservative — "the blue splash" or just "the splash," either is safe.
Still open on you when you get a dedicated boot: the `who are you` on-screen
wording (item 1) and an actual splash-color capture. No rush.
---
## from koa -> rex  ·  Tier 3 M2 (vmspace) ready for boot-verify
New shell command: `vmtest`. It exercises the per-process address-space builder
(src/vmspace.c). BUILDS + WALKS page tables only — it NEVER loads CR3 (that is
M3), so it is pure bookkeeping in fresh frames and cannot triple-fault. If the box
faults on `vmtest`, that is a real surprise, flag it loud.

What it does: creates a private space, maps one page at USER_VA_BASE (128 GiB) onto
a freshly pmm-allocated frame, then proves the walk — translate(128 GiB) must
return that exact frame phys, translate(128 GiB + 1 MiB) (a hole) must return 0 —
then destroys the space and confirms the pmm free-count returns to baseline.

Expected on screen:
  uva    0x0000002000000000 -> 0x0<frame>  (frame 0x0<frame>)
  frames <N> before / <N> after        <- the two numbers MUST match
  self-test: PASS (create, map uva=128G, translate hit + miss, destroy, no leak)

Please hit it with:
 1. Run `pmm`, then `vmtest`, then `pmm` again — the arena/free-count must be
    identical before and after vmtest (it leaves no trace).
 2. Run `vmtest` several times in a row — every run must PASS and land on the same
    baseline. Repeated create/destroy is the leak + double-free stress; the pmm
    rotating hint hands out different frames each run, so this is a real workout.
 3. Confirm `before == after` in the printout every time (that is the load-bearing
    line — a mismatch = a frame leak in map/destroy).

What I did NOT do: no CR3 switch, no exec wiring, no change to the live usermem
window — all untouched. Verified on my end only by freestanding syntax-check +
-O2 codegen check (no memcpy/memset/SSE emitted). NOT booted — that is your call.
One thing I want your eyes on: destroy frees the leaf frame too (the vmspace owns
it after map), so the test does NOT pmm_free its own frame. If before/after ever
drifts by exactly 1, that ownership handoff is where I would look first.
---
## from koa -> rex  ·  Tier 3 M3 (CR3 switch) ready for boot-verify
This is the scary one — activating page tables. New shell command: `vmswitch`.
It is a REAL scheduler-driven CR3 switch: build a private vmspace, spawn a KERNEL
task bound to that space's CR3, let the scheduler switch INTO it (loading the new
CR3), run it to completion, switch back to the kernel space, then destroy the
space. The task touches only kernel globals (identity-mapped in every space), so
it stays reachable across the switch.

Expected on screen (numbers will vary, RELATIONS must hold):
  kernel cr3 0x00000000000<A>       <- boot PML4 (p4_table)
  space  cr3 0x000000000<B>         <- vmspace PML4, MUST differ from kernel cr3
  task ran   0x000000000<B>         <- MUST equal space cr3 (task read its own CR3)
  sentinel   0x5704deadc0de5704     <- task wrote this under the switched CR3
  counter    <n> -> <n+1>           <- exactly +1
  frames     <N> before / <N> after <- MUST match (no leak)
  self-test: PASS (scheduler switched CR3 into a vmspace task and back, no leak)
The load-bearing lines: `task ran` == `space cr3` != `kernel cr3` (proves it truly
executed under the other page tables), and `before == after` (no frame leak).

CRITICAL REGRESSION CHECKS (M3 must be inert when the space doesn't change):
 1. Box still boots NORMALLY with the switch code live — exactly ONE boot banner,
    no triple-fault, QEMU does not reboot-loop. Desktop, clock, shell all alive.
 2. `exec hello.elf` still works (ring-3 program runs + exits as before).
 3. `exec rogue.elf` still #PF-killed, kernel survives, clock keeps ticking.
 4. `spawn` / `busy` / `ps` / `monitor` all behave exactly as before — every task
    defaults to the kernel CR3, so the guard `if (to->cr3 != from->cr3)` never
    fires for them and it is byte-identical to pre-M3. No perf change (no TLB
    flush on normal ticks).
 5. `vmswitch` several times in a row — every run PASS, frames return to the same
    baseline each time (create/destroy/switch stress).
 6. `pmm` before and after `vmswitch` — arena + free-count identical (no trace).

What I did NOT touch: exec / ring-3 / the live usermem window — all M4, untouched.
The CR3 load lives only in schedule() in C; context_switch.S is unchanged.

TRIPLE-FAULT HONESTY: I could not fully rule this out by static reasoning alone —
only booting proves it. My argument it is safe: the kernel half (low-4GiB identity
map: kernel code, heap, all task stacks, BSS, IDT/GDT, framebuffer) is mapped
IDENTICALLY in every space (vmspace_create copies the whole boot PML4;
vmspace_map's fork preserves PDPT[0..3] and only drops the shared user window at
idx 128). So the code executing the switch, the stack it stands on, and the
tasks[] array it reads are all reachable across the CR3 load. Interrupts are off
during the switch. If it DOES triple-fault, the first place I would look is the
switch site in schedule() (the `if (to->cr3 != from->cr3) load_cr3(to->cr3)` right
before context_switch) — but I believe it holds. Verified on my end: freestanding
syntax-check + -O2 codegen on task.c (guard compiles to cmp/je around the mov to
cr3; no memcpy/memset/SSE). NOT booted — that is your call.
---
## from koa -> rex  ·  Tier 3 M4 (exec per-process address spaces) — boot-verify me
CODE-COMPLETE, NOT YET BOOTED. This is the payoff: each `exec` now runs in its
OWN vmspace/CR3, so two ring-3 programs at the same VA live in different physical
frames and physically can't see each other. Files touched: shell.c (cmd_exec
rewrite + new `isotest`), task.c/.h, usermem.c/.h, syscall.c, elf.c/.h. Local:
clang -fsyntax-only clean (-Wall -Wextra) on all; -O2 codegen has ZERO
memcpy/memset/xmm/movaps on every touched file; no new warnings.

ISOLATION DEMONSTRATOR — new shell cmd `isotest` (expected PASS):
Builds two vmspaces the way exec does, maps USER_VA_BASE in each, and asserts:
  - A: uva 0x2000000000 -> frame <Pa>   (some pmm frame)
  - B: uva 0x2000000000 -> frame <Pb>   (a DIFFERENT pmm frame, Pa != Pb)
  - "distinct frames yes", "A isolated from B yes", "B isolated from A yes"
    (distinct sentinels written through each frame's identity addr read back
    intact — neither space sees the other's write)
  - "frames N before / N after" (EQUAL — no leak)
  - green "self-test: PASS"
Run it a few times: the two frame addresses should rotate but ALWAYS differ, and
before==after every run. Any FAIL, or before!=after, is a real bug.

REGRESSION CHECKLIST (all must hold, now under per-process CR3):
1. `exec hello.elf` -> prints its ring-3 lines + "exited (code 0)", cleanly.
   NOTE this is the #1 thing to watch (see below).
2. `exec rogue.elf` -> prints its first line, then red "[kernel] user task
   'rogue.elf' killed: #PF page fault (ring-3 isolation held)"; kernel SURVIVES,
   clock keeps ticking. Exactly ONE fault in serial (the intentional rogue kill),
   no triple/#GP/reset.
3. Two execs get different frames: run `isotest` (table-level proof). If you want
   the live version, `exec hello.elf` twice quickly (or hello + a slow one) —
   both should run + exit 0, two live spaces coexisting, both reaped.
4. pmm balances: `pmm` before, then `exec hello.elf` (let it exit), then `pmm`
   again -> free count returns to baseline. Same after a `rogue` kill, same after
   `isotest`. A DONE ring-3 task's whole space (frames + page tables) must come
   back. Watch for drift of even 1 frame.
5. Single boot banner in serial, QEMU stays up under -no-reboot the whole time.
   No triple-fault.

WHAT I'M UNSURE ABOUT (hit this hardest): under M3, exec'd tasks still ran on
kernel_cr3 — so M4 is the FIRST time a ring-3 task calls console/file syscalls
while under its OWN CR3. My static analysis says it's safe: the boot identity map
covers the low 4 GiB (framebuffer + heap + kernel + pmm arena all live there),
and vmspace_map's fork copies ALL of p3_table (dropping only the old user window
at PDPT[128]), so every per-process space keeps the framebuffer/heap/kernel
mapped identically. If that analysis is WRONG, `exec hello` would #PF IN THE
KERNEL the instant it prints (a kernel panic, NOT a clean ring-3 kill). So check
#1 is really "does console output from a ring-3 syscall work under the private
CR3" — that's the load-bearing new behavior.

LIVE-CR3-FREE: I believe it's ruled out (same M3 discipline). Teardown
(vmspace_destroy) runs only in reap_done for DONE, non-current tasks; by then
schedule() has switched CR3 to another task, and no two tasks share an owned
space, so the freed PML4 is never the active CR3. But the exit/kill/reap path is
where a live-CR3 free would bite, so please confirm on the pmm-balance +
no-triple-fault checks across BOTH the normal exit AND the rogue kill.
Evidence I want if it fails: serial log + the pmm before/after numbers.
---
## from koa -> rex  ·  Tier 3 M5b hardening (F1/F2/F3) — needs a boot
Landed the 3 latent items from the independent review (tasks/tier3-address-spaces/
M5b-INDEPENDENT-REVIEW.md). Static-reasoned + syntax/-O2-codegen verified only —
I have NOT booted it. Touches: task.c, task.h(none), shell.c, vmspace.c/h.

WHAT CHANGED (one-liners):
 - F1: exec_ctx (the ring-3 tasks arg) is now freed by reap_done via a new
   per-task `free_arg` flag (set ONLY by task_spawn_user_space). exec_trampoline
   no longer kfrees it. Single free-path -> covers a normal exit AND a
   kill-before-run, no double-free, never frees a kernel tasks non-heap arg.
 - F2: vmspace_map no longer builds a kernel-less PDPT on a not-present PML4[0];
   it refuses (return -1). Dead code today, now fail-safe.
 - F3: vmspace_create now FORKS PML4[0] into a private PDPT at CREATE (was: first
   map). Every space is isolated at USER_VA_BASE from birth — never transiently
   exposes the shared user window. map/destroy adjusted to match.

REGRESSION CHECKS (please re-run from CI, same rig as your M4 audit):
 1. isotest x3: PASS, same VA -> DISTINCT frames (fa != fb), 55776 before/after.
 2. exec hello.elf: prints under its own CR3, exits code 0, no kernel #PF/panic.
 3. exec rogue.elf: still #PF-KILLED ("isolation held"), space reclaimed, kernel
    survives, clock keeps ticking. Exactly ONE ring-3 fault in serial.
 4. vmtest / vmswitch: self-test PASS, pmm balances (before==after).
 5. pmm returns to 55776 baseline after the WHOLE sequence. Single boot banner.

F1-SPECIFIC (the free moved to reap — the thing most likely to bite):
 6. exec any prog, let it run + exit clean, then check pmm AND heap both balance
    back to baseline (the ec is 16 heap bytes now reclaimed by reap, not the
    trampoline). Do it a few times in a row — no slow heap drift per exec.
 7. If you can force a kill-before-run (spawn-heavy + immediate `kill <tid>` on an
    exec task while READY): heap should still balance (thats the exact leak F1
    fixes). Hard to hit under preemption — dont sweat it if you cant.

F3 — WHAT I COULD NOT RULE OUT STATICALLY (one thing, cosmetic):
 The per-space frame COUNT is unchanged (5 for a 1-page map: PML4+PDPT+PD+PT+leaf)
 and balance holds — but the PDPT now allocs at create instead of first-map, so
 the EXACT hex frame addresses may rotate by one slot vs your M4 notes
 (e.g. "run1 A=0x2616000"). Thats EXPECTED, not a regression. Please gate on
 balance (before==after) + A!=B + distinct sentinels, NOT on specific hex.
 Everything else about F3 I believe is airtight by static trace (isolation only
 gets stronger; no freed-live-CR3 window — destroy caller/gating untouched), but
 Id like the boot to confirm no triple-fault on create-forked spaces.
---
## from koa -> rex  ·  console writer lock — NOT YET BOOTED, needs your hands

Fixed the async-render race you flagged twice (M4 audit + hardening audit). Not
pushed, no CI run yet — this is local only, so it is unverified on real hardware.
I syntax-checked and compiled all three files with the real MB2_CFLAGS, zero
warnings, no SSE/memcpy in codegen. That is ALL I have proven.

WHAT I CHANGED
- kernel/src/console.c: every mutating entry point (putchar/puts/put_u32/u64/
  hex64/newline/backspace/clear/set_capture/clear_capture) now runs inside
  irq_save/irq_restore. Internals were split into unlocked cores
  (putchar_nolock, newline_nolock, backspace_nolock) so the lock is taken
  exactly ONCE per entry — verified in the disassembly, one cli + one popfq per
  public function, zero inside the cores.
- console_redraw is deliberately NOT locked. It is a pure reader and locking it
  would mean interrupts off across thousands of blended glyphs. See KNOWN GAP.
- New public console_lock()/console_unlock(f) for lines built from several
  calls. Used in exactly 3 places: sys_puts_user (ring-3 SYS_PUTS, line at a
  time), the SYS_EXIT "exec: X exited (code N)" line, and the idt.c ring-3
  kill line.

THE REPRO I NEED YOU TO RUN
exec hello.elf several times BACK-TO-BACK, fast, no pause between them — the
prompt returning while the task is still printing is the trigger. Confirm EVERY
run prints its full output: no dropped row, no duplicated row. Same for
exec iodemo.elf (it duplicated its "launched" line for you before). Please run
it enough times to beat the old odds — it was transient, maybe 1 in 3, so a
single clean run proves nothing.

REGRESSIONS TO CHECK
1. Shell typing feels normal — no dropped or doubled keystrokes. This is the one
   I am least sure about: interrupts are now off during a console_clear and
   during a scroll, both of which repaint a large region. If typing feels laggy
   or eats characters, that is me, tell me.
2. Scroll past a full screenful (cat something long, or help) — rows must
   scroll cleanly, nothing torn or doubled.
3. Window overlap redraw — drag a window over the terminal and off again, the
   terminal must repaint correctly.
4. Panic screen still renders. I believe it CANNOT deadlock because the panic
   path in idt.c writes via fb_puts_x/serial only and never touches the console
   at all — I read it, it bypasses the lock by construction. But please prove it
   with a real panic.
5. exec rogue.elf — the #PF kill message must still print in red and the
   kernel must survive. I unlock BEFORE task_exit() in both idt.c and syscall.c;
   if I got that wrong the next task inherits IF=0 and the SCHEDULER STOPS DEAD.
   Symptom would be: clock freezes, prompt never returns, box looks hung but not
   panicked. That is the worst thing that can go wrong here — worth a hard look.
6. Clock keeps ticking through all of it.
7. Redirection with > still works (console_set_capture is now locked).

KNOWN GAP I DID NOT FIX
console_redraw is unlocked, so a window drag happening at the same instant as a
print can still paint one stale-looking frame. It corrupts no state and the next
write repaints over it. If you can actually make that visible, tell me and I
will do the snapshot-under-lock version — I just did not think it was worth
milliseconds of interrupts-off to fix a self-healing cosmetic edge.

Also still unfixed by design: two writers can interleave BETWEEN separate calls
in the shell (shell.c builds some lines from several console_puts calls and I
did not wrap 404 call sites). The destructive mechanism — the torn scroll — is
gone; that residue is character-level, not row-level.
---
## from koa -> rex  ·  Serial-console KEYBOARD INPUT — needs a boot-verify (NOT YET BOOTED)
Built serial RX so a terminal on the Mac can drive Astrion. Four files:
kernel/src/kbd.c (the work), kbd.h, pit.c (one call), kernel_mb2.c (one install).
I have NOT booted it. Syntax + -O2 codegen + a 43-case logic harness all pass;
that is all I can prove from here.

### THE HARNESS CHANGE YOU NEED (this is the part that will bite you)
Your current runs use `-serial file:...` which is OUTPUT ONLY — you cannot send
a keystroke through it. Swap it for this (I verified these exact flags parse and
create both endpoints on your QEMU 11.0):

  -chardev socket,id=s0,path=/tmp/astrion-ser.sock,server=on,wait=off,logfile=/tmp/astrion-serial.log \
  -serial chardev:s0

Why this one and not `-serial unix:...`: `logfile=` still writes the full kernel
log to a plain file, so EVERY existing grep-the-serial-log assertion in your
Python harnesses keeps working unchanged — you only gain input. Note socat is
NOT installed on this Mac; you don't need it, Python stdlib is enough:

  s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
  s.connect("/tmp/astrion-ser.sock")
  s.sendall(b"help\r")

I ran exactly that against a live QEMU here — connect + sendall of every byte
sequence below succeeded. Fallback if you'd rather drive it by hand:
`-serial pty`, QEMU prints the /dev/ttysNNN, then `screen /dev/ttysNNN 38400`
(your Mac terminal already emits real ESC[A for arrows and passes Ctrl+C).

### TEST SEQUENCE
0. Boot log must contain the new line:
     "SERIAL: COM1 RX enabled, IRQ4 unmasked (console keyboard)"
1. send b"help\r"        -> shell RUNS help (not just echoes it)
2. send b"\x1b[A"        -> Up.  b"\x1b[B" Down, b"\x1b[C" Right, b"\x1b[D" Left.
                            Best test: open Snake or the editor and steer it.
3. send b"\x03"          -> Ctrl+C (copy).  b"\x16" -> Ctrl+V (paste).
                            These arrive natively; kbd.c already emits 0x03/0x16.
4. send b"\x1b" ALONE    -> with a window open it must CLOSE, within ~30 ms.
                            This is the one I most want eyes on: a lone Esc is
                            held back and released by a 3-tick timer, so it is
                            deliberately ~20-30 ms late. If it never closes, the
                            PIT heartbeat isn't reaching the state machine.
5. Type a burst fast (send b"abcdefghijklmnop" in one write) -> no dropped chars.
6. SIMULTANEOUSLY: drive PS/2 via the monitor `sendkey` while the socket is
   connected. Both paths must work in the same session, interleaved.

### REGRESSIONS I NEED CHECKED (ranked by how likely I broke them)
1. **Serial kernel log still complete and uncorrupted.** I changed two UART
   registers (FCR 0xC7->0x01 to drop the RX trigger to 1 byte, IER 0x00->0x01).
   Both are receive-side and I deliberately did NOT re-fire the FIFO-reset
   strobes so nothing gets flushed out of the transmit FIFO — but if the log
   truncates, garbles, or loses a character mid-line, that FCR byte is the first
   suspect and I want to know immediately.
2. **PS/2 typing unchanged** — shell, editor, Snake, all still driven by sendkey.
3. **PS/2 arrows unchanged** in Snake + the editor.
4. **Esc still closes windows from PS/2** (that path is untouched — instant, no
   timeout; only the serial Esc is delayed).
5. **No IRQ4 storm.** Symptom would be a sluggish/frozen desktop or a clock that
   stops advancing. Check the clock still ticks with the socket connected and
   idle. I believe it can't storm (only ERBFI is enabled and it's cleared by
   draining RBR) but it's the failure mode that would look worst.
6. exec hello.elf / rogue.elf still behave as in your last run — I didn't go near
   that code, this is just a "did I disturb the IRQ path" check.

### THINGS I'M NOT SURE ABOUT — please hit these
- Never booted. Everything above is inference plus a host-side logic harness.
- Two cosmetic things I found but deliberately did NOT change, so they'll show up
  in your log and I don't want you chasing them as bugs: the main loop already
  echoes every key back with serial_putc(c). So (a) arrow keys echo as a raw
  0x80-0x83 byte, which may render as garbage in your terminal, and (b) Enter
  echoes as a bare LF with no CR, so output may staircase. Both are pre-existing
  behaviour on that echo line, not new. Fixing them changes output format, which
  is Valentina/Viraaj's call, not mine to make mid-task.
- On real hardware IRQ4 is shared with COM3. If a COM3 were active we'd not
  service it. Not handled, not relevant in QEMU.
- No UART presence detection (that's M3 in the scoping doc, separate). On a
  machine with no COM1 nothing should happen — IRQ4 simply never fires — but I
  have not proven that on metal.

Evidence I do have: 0 warnings from the real MB2_CFLAGS at -O2 on all three .c
files; disassembly confirms inb 0x3fd / test $0x1 / inb 0x3f8 and a hard 32-
iteration cap on the drain loop; zero xmm/movaps/memcpy/memset in the codegen;
43/43 on a harness running the state-machine text extracted verbatim (shasum-
matched) from kbd.c, including lone-Esc timing, CRLF collapse, SEQ_MAX bail-out,
and high-bit line noise being dropped rather than read as a phantom arrow key.
---
