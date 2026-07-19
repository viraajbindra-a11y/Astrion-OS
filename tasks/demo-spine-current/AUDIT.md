# Demo spine + palette on the CURRENT build — Rex

**Artifact:** `astrion-grub.iso`, CI run `29669116810`, commit `0934aa7` (HEAD).
`sha256 b680d04f226b1e9ee77beac255f135789d1e5ad190ccc0446bc43a509762a66c`
Downloaded from CI. Not built locally. This is the release binary, not a lookalike.

**Harness:** QEMU tcg, 256M, `-display none`, monitor `/tmp/rxb-mon.sock`, serial
`/tmp/rxb-ser.txt`. Mouse-driven (dock, power glyph) + sendkey. Every beat has a
frame in `frames/`. Mouse slam corrected to 12x`-255` steps — two `-4000` moves
only yield ~-510 against the ±255 PS/2 clamp and do NOT reach origin from
mid-screen. Calibrated against `frames/cal-01-mouse-769-700.png` (landed within
~5px) before any click was trusted.

**Verdict: all four demo beats work on the current build. All four palette items
are correct on real pixels. Nothing found that blocks filming or shipping.**
One pre-existing cosmetic defect is visible during the demo (item B1).

---

## PART 1 — the four demo beats (on 0934aa7, mouse-driven)

| # | Beat | Result | Evidence |
|---|------|--------|----------|
| 1 | AI does real work offline | **CONFIRMED** | `b1-03-write-result.png` "wrote to notes.txt: hello world"; `b1-04-read-result.png` "contents of notes.txt: hello world" |
| 2 | Hostile program killed by ring-3 | **CONFIRMED** | `b2-02-exec-rogue.png` red `[kernel] user task 'rogue.elf' killed: #PF page fault (ring-3 isolation held)`; serial L77 `[ring3 fault] #PF page fault from user task - killing it, kernel survives` |
| 3 | Neural net on bare metal | **CONFIRMED** | `b3-04-nn-final.png` — "so left / So quot see a two of to prison and fo" |
| 4 | Real power-off | **CONFIRMED** | `b4-03-dialog-run2.png` → **`EXIT=0`**, exactly ONE boot banner |

Detail:

- **Beat 1.** Clicked Assistant in the dock. Both halves work. The file is real —
  `ls` later lists `notes.txt` alongside the shipped files (`b3-04`).
- **Beat 2.** Followed the script's mandatory **Esc first**. Esc does close the
  Assistant and return focus to the Terminal (`b2-01-after-esc.png`), so the
  money line lands on a clean full-width Terminal with no stale Assistant text
  over it. The script's warning is correct and still necessary. Kernel survived,
  clock kept ticking (01:52:06 → later frames advance), `ls` works after the kill.
- **Beat 3.** Assistant reopens fine after Beat 2 closed it — the demo's
  close-then-reopen flow works. Output is honest gibberish, as intended.
- **Beat 4.** Power glyph → modal dialog ("Your session will end." / Shut Down /
  Restart / Cancel, desktop dimmed behind) → Shut Down → QEMU exits.
  **Verified `EXIT=0`**, captured via a wrapper shell, not inferred from the
  process disappearing. Note: `-no-shutdown` was deliberately OMITTED for this
  run — with it set, QEMU pauses instead of exiting and the exit code is masked.
  Anyone re-verifying this must drop that flag or they are testing nothing.
  Serial contains exactly **one** boot banner — no triple-fault second banner.

## PART 2 — palette on real pixels

| # | Item | Result | Measured |
|---|------|--------|----------|
| 5 | Shell prompt TEAL, matches Assistant | **CONFIRMED** | both exactly `#64D2FF` |
| 6 | Files active ring visible on blue tile | **CONFIRMED** | ring `#0A84FF` / 1px gap `#12162C` / tile `#0A84FF`; ring complete 58px |
| 7 | Snake border teal, food orange, text crisp | **CONFIRMED** | border `#64D2FF`, food `#FF9F0A`, title/GAME OVER `#64D2FF` lum190 on lum26 (~9:1) |
| 8 | Panic hazard bar orange, labels legible | **CONFIRMED** | bar `#FF9F0A` on `#8A1B17`; labels 4.54:1, values 9.33:1 |

- **Item 5.** Shell prompt `astrion:/>` core is `#64D2FF`. The Assistant's `>` is
  **also** `#64D2FF`. They agree. (A first pass appeared to show a mismatch — the
  `#0A84FF` in that region is the *caret block*, a different element, not the
  prompt glyph. Separated by sub-glyph sampling: `frames/zoom-assistant-prompt.png`.)
- **Item 6.** The fix works and is visible at 6x (`zoom-files-tile-ring-clean.png`).
  Scanline across the tile: dock bg | ring 2px | **dark gap 1px** | blue tile |
  gap 1px | ring 2px. Without the gap the ring would be blue-on-blue and invisible;
  with it, the running app reads as running. Top and bottom edges both continuous
  58px when the cursor is not parked on the tile. See B1 for the caveat.
- **Item 7.** Border is cold teal, food is the single warmest object in the field —
  the furniture no longer competes with the target (`p2-07-snake-f0.png`). Title,
  SCORE and GAME OVER are bright cyan at luminance 190 on a luminance-26 field:
  **crisp, not murky.** The "murky blue" she worried about did not happen — this
  is high-luminance cyan, not a dark blue. Body text is `#CADCFC` near-white.
- **Item 8.** `p2-10-panic.png`. Hazard bar is systemOrange on the deep-red field.
  `vector:`/`error:` labels are orange at **4.54:1** — over the 4.5:1 AA threshold,
  and far over the 3:1 large-text threshold at this glyph size. Legible. It is the
  thinnest contrast margin in the build; if anyone darkens that red field later,
  this is the first thing that breaks. Values are white at 9.33:1.
  Panic halts cleanly (serial `--- halt ---` + full register dump), no reboot loop.

## PART 3 — sanity

- `pmm`: `frames 55776 free / 55776`, `self-test: PASS`. Balanced **after** the full
  spine (file write + ring-3 exec + kill + NN inference). No leak from the demo.
- `isotest`: `PASS` — A `0x2618000` vs B `0x2619000`, distinct, no cross-visibility,
  `55776 before / 55776 after`. (`p3-02-isotest.png`)
- Exactly one boot banner per boot, all boots.
- No unexpected fault. The only faults observed were the two I asked for.

---

## Defects

### B1 — Terminal body keeps its *inactive* background forever once any window overlaps it
**Pre-existing. NOT introduced by the palette pass. Not a blocker. Cosmetic.**

Repro (deterministic, 3 steps):
1. Boot. Terminal body is `#171B2E` — correct (`00-desktop.png`, `b4-01`).
2. Click Assistant in the dock (any window over the Terminal will do).
3. Press Esc to close it.
→ Terminal body is now `#1E2761` and **never repaints back** for the rest of the
session (`b2-01`, `b2-02`, `p3-02` all `#1E2761`).

Cause — two disagreeing constants:
- `kernel/src/desktop.h:89` — `#define AC_TERM_BG 0x171B2Eu /* window body / terminal */`
- `kernel/src/console.c:21` — `#define COL_BG 0x1E2761u /* same navy as the boot screen */`

The desktop paints the window body with `AC_TERM_BG`; the console's own full
repaint paints with `COL_BG`. Whichever ran last wins. `console.c` has held
`0x1E2761` since `ecfdde4`; `desktop.h` moved to `0x171B2E` in `4bc314f` and
console.c was never brought along. `0934aa7` did not touch it.

Why it still matters: this lands **directly on the Beat 2 money line**, because
the script's mandatory Esc is exactly the trigger. Measured: the red kill line is
**4.90:1** on the wrong background vs **6.04:1** intended — still above AA, still
clearly legible on camera (`b2-02-exec-rogue.png` is the proof). So: film it, it
reads fine. But this is the single largest remaining palette incoherence — an
entire window body changing colour mid-demo — and it survived a commit whose
stated purpose was palette coherence.

### B2 — Snake dies in under ~2s if you don't steer it immediately
**Not a bug in the kernel. A demo-script risk on the OPTIONAL close only.**

Snake auto-starts moving on launch. Twice, opened and left untouched, it had
already hit the right wall and was showing GAME OVER before my first screendump
(~1.5-2s after launch) — `p2-03-snake-open.png`, `p2-07-snake-f0.png`.

It is genuinely playable: with immediate steering it survived a 12.2s window with
no GAME OVER panel (`p2-08-snake-steered.png`). So the game is fine — but the
optional close "click Snake, play 8 seconds" has no room for a presenter to click
and then talk. Steer on frame one or cut the beat. Spine beats are unaffected.

### Known artifact — status: not worse, but it now has a demo-relevant surface
The stale mouse-cursor backing-store artifact (already reported, not my finding)
is present and unchanged in severity. Noting one interaction only, because it
touches item 6: when you click a dock tile, the cursor is left sitting on the tile
you just activated, and the stale rect stamps the *pre-activation* tile back —
which chews a 22x2px notch out of the bottom of the **active ring Valentina just
fixed** (`p2-01-files-open.png`, gap x=511..532 at y=779..780, starting exactly at
my click x=511). Proven to be the cursor artifact and not a ring defect: clicking
the same tile higher up, where the stale rect cannot reach the ring, yields a
complete 58px ring on both edges (`p2-02-files-ring-clean.png`). Same known bug,
new surface. Fixing the cursor artifact would also finish item 6 in practice.

---

## What I did not verify
- Persistence across reboot (no disk image attached this run) — out of scope here,
  covered by `shutdown-2026-07-17`.
- Real hardware. QEMU tcg only.
- The Restart path in the power dialog (only Shut Down was exercised).
