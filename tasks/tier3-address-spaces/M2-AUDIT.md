# Tier 3 M2 (per-process address-space builder) — boot audit

**Verdict: PASS.** M2 holds. Every `vmtest` run PASSes, `before == after` on every run,
no frame leak, no double-free fault, no regression. Booted the real CI ISO in QEMU and
watched it — pixels + serial, not say-so.

- Commit: `6b3ba6c`
- CI run: `29622851507` (Build Astrion OS Kernel, completed/success, headSha 6b3ba6c)
- ISO: `tasks/tier3-address-spaces/iso-m2/astrion-grub.iso` (12.9 MB)
- Boot: `qemu-system-x86_64 -cdrom astrion-grub.iso -m 256M -accel tcg -serial file:/tmp/rex-ser.txt -monitor unix:/tmp/rex.sock -display none -no-reboot`
- Driven by shell commands via QEMU monitor `sendkey` (no mouse). 6 commands.
- Frames: `tasks/tier3-address-spaces/frames-m2/`

## Results

| Check | Result | Evidence |
|---|---|---|
| Boot to desktop, shell focused, clock ticking | PASS | `00-desktop.png` — prompt `astrion:/>`, clock `00:22:53`; ticked to `00:25:55` by end |
| Step 1 `pmm` baseline free-count | PASS | `01-pmm-before.png` — arena `0x2600000..0xffe0000`, **`55776 free / 55776`** (217 MiB), pmm self-test PASS |
| Step 2 `vmtest` run 1: uva 128G maps to a real frame | PASS | `02-vmtest-run1.png` — `uva 0x0000002000000000 -> 0x0000000002609000 (frame 0x2609000)` |
| Step 2 run 1: `before == after` (no leak) | PASS | `02-vmtest-run1.png` — **`frames 55776 before / 55776 after`** |
| Step 2 run 1: `self-test: PASS` | PASS | `02-vmtest-run1.png` — "PASS (create, map uva=128G, translate hit + miss, destroy, no leak)" |
| Step 3 `vmtest` x2 more: every run PASS, same baseline | PASS | `03-vmtest-run2-3.png` — run2 `55776/55776` frame `0x260e000`, run3 `55776/55776` frame `0x2613000`, both PASS |
| Step 3: fresh frames each run (real create/destroy, not a no-op) | PASS | frames rotate `0x2609000 -> 0x260e000 -> 0x2613000` (+0x5000 = 5 frames: PML4+PDPT+PD+PT+leaf), all reclaimed |
| Step 4 `pmm` after: arena + free-count IDENTICAL to step 1 | PASS | `04-pmm-after.png` — arena `0x2600000..0xffe0000`, **`55776 free / 55776`** — byte-identical to step 1, vmtest left no trace |
| Step 5 regression: open/close Files via shell + Esc | PASS | `05-files-open.png` (window renders: entries, footer), `06-files-closed.png` (clean dismiss, Terminal refocus) |
| Step 5 regression: open/close Editor (`edit x`) + Esc | PASS | `07-edit-open.png` (title `Editor: /x`, cursor), `08-edit-closed.png` (clean dismiss) |
| Step 5: exactly ONE boot banner (no triple-fault second banner) | PASS | serial line 2 only: `=== Astrion v2.0 Kernel (multiboot2 path) ===`, `grep -c` = 1 |
| Step 5: no panic / fault / exception event | PASS | serial: only "exception" hit is line 59 IDT init log; no panic/#GP/#PF/CR2/RIP; QEMU never exited (`-no-reboot` = no triple fault) |

## The load-bearing line

`frames <N> before / <N> after` — **before == after == 55776 on all three runs.** No drift.
Koa flagged "drift by exactly 1 = leaf-frame ownership handoff bug" — did not happen. The
vmspace-owns-the-leaf handoff on destroy is balanced; pmm free-count returns to exact baseline
every cycle.

## Notes
- Serial echoes command *input* (lines 71-77: pmm, vmtest x3, pmm, files, edit x); command
  *results* are pixels only (as expected). Every result frame was read.
- Cosmetic only (not a defect): the last `pmm` output block renders with a blue selection-band
  highlight in `04-pmm-after.png`. Text fully legible, values correct.
- Confirms Koa's design claim: vmtest builds/walks page tables but never loads CR3, so it can't
  triple-fault. It didn't. The box faulting on vmtest would have been "a real surprise" — no surprise.
