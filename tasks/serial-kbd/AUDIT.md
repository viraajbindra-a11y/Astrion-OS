# Serial-console keyboard input — boot audit (Rex)

**Build:** commit `0934aa7`, CI run `29669116810`, artifact `astrion-grub-iso`.
**Baseline for comparison:** commit `cf266d0` (pre serial-RX), CI run `29667483179`.
**Rig:** QEMU 11.0.0, TCG, 256M, `-chardev socket,id=s0,path=/tmp/rxa.sock,server=on,wait=off,logfile=/tmp/rxa-log.txt -serial chardev:s0`,
monitor `/tmp/rxa-mon.sock`, `-display none -no-reboot`. Input driven by a Python AF_UNIX client.
**Boots:** 6 (A, B, C1-baseline, C2, D, E). Every run: exactly 1 boot banner, 0 faults, 0 panics, QEMU never reset.

Scope this run: serial keyboard ONLY. Palette was another agent's job and was not assessed.

---

## Verdicts

| # | Claim | Verdict | Proof |
|---|---|---|---|
| 1 | Boot log survives the FCR 0xC7→0x01 change | **CONFIRMED** | `bootlog-diff.txt` — 3 lines total |
| 2 | Can type over serial; not a one-shot | **CONFIRMED** | `frames/A01-help.png`, `A14-crlf-pmm.png` |
| 3 | High-bit noise dropped, no phantom arrows | **CONFIRMED** | `A04` vs `A07`, `C07-after-sweep.png` |
| 4 | Arrows / lone Esc / Ctrl+C/V / CRLF | **CONFIRMED** | `B12`, `B03`, timings below |
| 5 | PS/2 still works alongside serial | **CONFIRMED** | `frames/B17-interleaved-echo.png` |

No blocking defects. One LOW cosmetic robustness nit (F-1). One suspected defect investigated and **disproved** (see "Non-finding").

---

## 1. Boot log intact — CONFIRMED

Diffed the full boot log of `0934aa7` against the pre-serial-RX build `cf266d0`, same rig, same flags.
**Total diff: 3 lines.**

```
-RTC: 2026-07-19 01:57:01 (CMOS wall clock, no network time)
+RTC: 2026-07-19 01:49:43 (CMOS wall clock, no network time)
+SERIAL: COM1 RX enabled, IRQ4 unmasked (console keyboard)
```

The RTC line differs only because the two boots happened at different wall-clock times. The one added
line is the intended new one. **Every other line is byte-identical.**

- 2842 bytes, 71 lines. Full multiboot2 tag dump present, mmap table, ELF sections, framebuffer tag.
- Banner `=== Astrion v2.0 Kernel (multiboot2 path) ===` present, once.
- `PMM: initializing physical frame allocator...` present.
- `TASKS: scheduler up (task 0 = shell, task 1 = clock)` present.
- **0 non-ASCII bytes** in the whole log — nothing garbled.
- Line endings clean: 71 CR / 71 LF / 71 CRLF — no truncation, no lost character mid-line.

The FCR change did not touch transmit. Koa's first suspect is cleared.

## 2. Typing works — CONFIRMED

Bytes over the socket are *executed*, not merely echoed. `help` rendered the full command table and
returned the prompt (`A01-help.png`). Then `pmm` (arena + `frames 55776 free / 55776`, self-test PASS),
`date`, `files`, `version`, `clip`, `echo` — all ran in the same session. Not a one-shot.

## 3. High-bit noise is dropped — CONFIRMED (the one that mattered)

The allow-list is `if (b >= 0x20 && b <= 0x7E) rb_push(...)` — `b` is `uint8_t`, so 0x80–0xFF cannot pass.
Booted proof, with a control experiment so the negative result means something:

- Opened Files, selection on `greet.sh` (`A04-files-baseline.png`).
- Sent **22 high-bit bytes**: `0x80 0x81 0x82 0x83` individually, then `0x84 0x85 0x8a 0x90 0xa0 0xc0 0xfe 0xff`, then `0x81`×10.
- Result (`A07-after-81-x10.png`): selection still on `greet.sh`. Pixel diff vs baseline confined to
  bbox `(1092,16,1212,28)` — that is the top-bar clock and nothing else. **Zero bytes echoed back**,
  so they never reached the ring buffer.
- **Control:** one real `ESC[B` moved the selection two rows (`A09`), diff 54,740 px, bbox `(222,16,1212,434)`.
  The detector was sensitive; the noise was silent.
- Stronger version: full **0x80–0xFF sweep (128 bytes)** at the shell prompt → prompt clean, no residue,
  next command ran normally (`C07-after-sweep.png`).

0x80–0x83 are numerically KEY_UP..KEY_RIGHT internally. Injected raw: nothing. Injected as `ESC[A/B/C/D`: real
key events. The allow-list has no hole.

## 4. Arrows, Esc, Ctrl, CRLF — CONFIRMED

**Arrows.** Move the Files selection and the editor caret. Echo confirms the internal codes:
UP `0x80`, DOWN `0x81`, LEFT `0x82`, RIGHT `0x83`.

**Lone Esc.** Fires every time. Measured host-send → echo-return over 3 reps: **49.2 / 51.2 / 58.2 ms**.
Koa predicted 20–30 ms; the extra is host socket round-trip plus the main loop's poll cadence. A real
`ESC[B` came back in **7.9 ms** and leaked no stray `0x1b` — so arrows are not delayed and the
disambiguation actually works. Window closed in every rep (`B01`, `B04`).

**CRLF.** `date\r\n` and `pmm\r\n` each produced exactly one Enter — one command line, one output block,
one prompt (`A14-crlf-pmm.png`). Echo stream shows `date\n` / `pmm\n`, never `\n\n`.

**Ctrl+C / Ctrl+V.** Full loop driven by serial bytes only (`B12-shell-paste-entered.png`):
`edit readme.txt` → `ESC[C`×6 / `ESC[D`×3 move the caret → `0x03` copies the line (Valentina's "copied"
chip appears bottom-right, diff bbox `(1011,16,1211,592)`) → `0x1b` closes the editor → `clip` prints
`clipboard (59 bytes): type 'sync' to save to disk, then reboot - files come back.` → `0x16` pastes that
exact line onto the prompt → Enter, and the shell parses it (`unknown command: type`), proving it is
real input and not a rendering artifact.

**Burst.** `abcdefghijklmnop` in one write — all 16 characters landed, in order.

## 5. PS/2 regression — CONFIRMED

Same boot, both paths, interleaved **character by character** (`B17-interleaved-echo.png`):

```
PS/2 "ec"  serial "h"  PS/2 "o"  serial " IN"  PS/2 "t"  serial "erleaved\r"
   -> astrion:/> echo INterleaved
   -> INterleaved
```

Every character landed in the right order. No drops, no duplicates. Also alternated whole commands
(`pmm` PS/2, `date` serial, `clip` PS/2, `version` serial) — all correct.

- PS/2 arrows still move the Files selection: diff 54,732 px, bbox `(222,16,1212,434)` — the same
  signature as the serial arrows (54,740 px). Untouched.
- PS/2 Esc still closes windows, instantly (`B20`).
- Clock keeps ticking with the socket connected and idle: two frames 3 s apart differ **only** in the
  clock region. **No IRQ4 storm.**

Side observation (expected, not a bug): PS/2 keystrokes also echo *out* the serial port, because the
main loop echoes everything it pulls from the shared ring buffer. That is how I proved both paths feed
one buffer.

---

## F-1 (LOW, cosmetic) — escape bail-outs leak the rest of the sequence as literal text

When the CSI state machine gives up, the remaining bytes are re-read as ordinary characters and typed
into the shell line. Two triggers, both of which I had to force:

1. Sequence split across the 30 ms timeout — I sent `ESC[`, waited **500 ms**, then `B`. The `B` arrived
   as a literal letter.
2. Parameter run longer than `SEQ_MAX` (16) — I sent `ESC[` + `"1;"`×40 + `R`; the overflow leaked as
   literal `1;1;1;...R` onto the prompt (`C04`, `C07`).

**Why it is LOW:** the leaked bytes still go through the `0x20..0x7E` allow-list, so a bail-out can
**never** synthesise a phantom arrow — the safety property held. Worst case is a stray printable
character the user backspaces. Neither trigger is reachable in practice: at 9600 baud a 3-byte arrow
takes ~3 ms against a 30 ms window, and no real terminal sends 80 parameter bytes in one CSI.
Truncated `ESC[` alone recovers cleanly and does not eat the next command (`C02`, `echo AFTERTRUNC` ran).
Not worth a fix before the demo. Filing for the record only.

## Non-finding (investigated, disproved) — the "4 dropped bytes"

First flood run (3800 bytes in one write) came back 4 bytes short, mid-stream, and looked like a
ring-buffer overflow (`rb[64]`, `rb_push` drops silently when full). It is not.

- Re-ran every size 46 → 3800 bytes while continuously draining the socket: **LOST=0 at every size**,
  byte-exact.
- Echo completeness is itself a guest-side oracle: a byte the kernel dropped could never be echoed. A
  complete 3800/3800 echo proves the ring buffer lost nothing.
- Screen oracle (`E01-nodrain.png`): 760 bytes flooded with **zero** host-side draining — all ten
  `echo` lines render full length, no short row.
- Whether my Python client calls `recv()` cannot affect the host→guest direction. It can only affect
  guest→host, where a full socket send buffer makes QEMU drop *output* bytes — which is exactly what a
  **mid-stream** gap looks like.

Conclusion: harness artifact on the echo channel, not a kernel input drop. **No defect.** Worth knowing
operationally: a serial terminal that stops reading can lose *log* bytes. Input is unaffected.

## Cosmetics Koa flagged — my judgment

- **Enter echoes a bare LF (staircase) — worth the one-line fix.** The kernel log itself is already
  correct CRLF (71/71/71); the echo at `kernel_mb2.c:906` (`serial_putc(c)`) is the *only* place in the
  stream that emits LF without CR, so a real terminal staircases against otherwise-clean output. Emit
  `'\r'` before `'\n'` there. Low risk, visible payoff the moment anyone attaches a terminal.
- **Arrows echo as a raw 0x80–0x83 byte — leave it.** Only visible to someone driving over serial, costs
  one junk glyph, and it is genuinely useful when debugging because you can see arrows arriving. If it
  is ever fixed, suppress the echo for `c >= 0x80` at the same site. I would not spend the change.

## Artifacts

- `frames/A*.png` — boot log / typing / high-bit noise / arrows / Esc / CRLF
- `frames/B*.png` — Esc timing, editor arrows, Ctrl+C/V, PS/2 interleave
- `frames/C*.png` — adversarial: flood, truncated + split + oversized escapes, control bytes, 0x80–0xFF sweep
- `frames/D*.png`, `frames/E*.png` — flood threshold and the input-vs-echo isolation
- `bootlog-0934aa7.txt`, `bootlog-pre-cf266d0.txt`, `bootlog-diff.txt`
- `echo-rx.bin`, `echo-rx-B.bin`, `echo-rx-C.bin` — raw guest echo streams
- `RESULTS.txt` — full run transcript

Frames `01_*.png` … `15_*.png` in `frames/` are leftovers from an earlier stalled session and are **not**
evidence for this audit. Everything above cites `A*`–`E*` only.
