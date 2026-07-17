# System Monitor #GP — fix + re-verify (2026-07-17)

**The bug (Rex found, Koa root-caused):** the Monitor `#GP`-panicked and halted
the machine the instant a 3rd scheduler task existed. Not the render, not the
scheduler — the window **backing store**. Each window slot keeps one `savebuf`
(the pixels beneath it), allocated once at first open and never resized.
Valentina had made the Monitor's height track the live task count, but the
savebuf bound didn't move with it: open at 1–2 tasks (clamps to the row minimum),
close, `spawn` a 3rd, reopen (now taller) → `save_rect` writes the bigger
footprint into the old smaller buffer → heap overflow → stamps a framebuffer
pixel over an adjacent heap pointer → later call/return through it → `#GP` with a
garbage RIP. The repeated `0x001e2761` in that RIP was two identical pixels
overwriting an 8-byte pointer.

**The fix (Koa, `3326f90`):** track savebuf capacity per window (`savecap`) and
regrow it (`kfree`+`kmalloc`) when a slot reopens larger than its cache; on OOM
leave `savecap` 0 so `save_rect` no-ops on null instead of overflowing.

**Re-verify (Rex, CI run 29610052365) — fix holds, all 5 CONFIRMED:**
1. Old repro DEAD — reopen at 3+ tasks renders clean; first-open at 3 clean; `busy` + ring-3 `exec` reopen clean (`V_A3/V_B1/V_A4/V_A5`).
2. Drag a 4-row Monitor — background restores, no smear (`V_A7b/c`).
3. 14 tasks → clamps at 10 rows, shows "+5 more" instead of crashing (`V_B2`).
4. Works at 3+ — switches climb, heap steady, uptime advancing (`V_A6a/b`).
5. Shrink (kill 11, reopen at 3) — clean, savecap-grows-never-shrinks stays in-bounds, no leak-into-garbage (`V_B3`).

*"It's genuinely fixed — safe to demo."*

**Coordination:** the entire cycle ran on the `crew/` mailbox with no human
relay — Rex's repro → `crew/koa.md`, Koa's fix + checklist → `crew/rex.md`,
Rex's "Closed." confirmation → `crew/koa.md`.
