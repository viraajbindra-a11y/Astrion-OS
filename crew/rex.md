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
