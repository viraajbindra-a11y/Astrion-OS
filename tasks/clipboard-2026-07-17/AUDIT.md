# Clipboard (Ctrl+C / Ctrl+V) — audit (2026-07-17)

Feature by Koa (global 4 KiB buffer + Ctrl-folding in `kbd.c` → real ASCII
control codes 0x03/0x16). Verified by Rex on the CI ISO for commit `e95ee3c`.

**Verdict: all 5 CONFIRMED, "demo-safe." Nothing broke, nothing leaked.**

| # | Claim | Result | Evidence |
|---|-------|--------|----------|
| 1 | Editor copy → paste | ✅ | `A4` typed "hello clipboard 123"; `A5` Ctrl+C / Enter / Ctrl+V duplicated it at the cursor on line 2 |
| 2 | `clip` command | ✅ | `A1` fresh boot → "clipboard is empty"; `A8` after copy → "clipboard (19 bytes): hello clipboard 123" |
| 3 | Cross-app paste (the demo) | ✅ | copy in editor → `B1` pastes into shell input, `B2` pastes into Assistant prompt |
| 4 | Edges | ✅ | `A2` paste-when-empty = no-op; `B8` empty-line copy clears (intended); `B6` 200-char line truncates to exactly 79, one line, no overflow; `B3` eight Ctrl+letter chords → zero stray letters |
| 5 | No regressions | ✅ | `A6` arrows move caret; `B4` `help` runs after the chords (Ctrl not stuck); ESC still closes every window |

Two clean boots, no panic in either serial. Frames in `frames/`.
