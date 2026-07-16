# Astrion v2.0 kernel — independent audit (2026-07-16)

**Mandate:** "don't take your own word for this — make sure it's right; check if
everything you've said is even true." This audit takes **nothing** on trust.

**Method.** Booted the exact ISO the CI produced for commit `2ac5e24`
(`astrion-grub.iso`, downloaded from GitHub Actions — no local recompile). Drove
every subsystem purely over the QEMU monitor: real keyboard injection into the
running kernel, framebuffer `screendump` after each step, plus the COM1 serial
log. Every claim below is backed by a screenshot in `frames/` and/or a serial
line — not by my say-so. Drivers: `drive.py` (16 checkpoints) + `persist.py`
(2-boot disk test). Cleaned up all QEMU processes after each run.

---

## Verdict: every claimed feature is REAL and verified.

| # | Claim | Result | Evidence |
|---|-------|--------|----------|
| 1 | Boot: multiboot2 → long mode → linear framebuffer | ✅ | `serial.log` (magic OK, GRUB hand-off clean, fb 1280×800@32 @0xfd000000) |
| 2 | Heap based at `_kernel_end` (the blank-desktop fix) | ✅ | `serial.log`: "HEAP: base after kernel end = 0x600000" |
| 3 | Desktop chrome in Inter + web palette | ✅ | `frames/01_boot_desktop.png` (Astrion/v2.0/clock/dock/title all AA Inter) |
| 4 | Shell + command set | ✅ | every command below echoed + executed |
| 5 | RAM filesystem (ls / write / cat) | ✅ | `03_fs_write_read.png` — wrote 16 B, read back "helloastrion2026" |
| 6 | **Disk persistence across reboot** | ✅ | `P1…` sync "saved to disk"; `P2…` after full power-cycle `cat persist.txt` → "survivedreboot2026" |
| 7 | Preemptive scheduler (task 0 shell, task 1 clock) | ✅ | `04_ps.png` — 6470 context switches in ~34 s (100 Hz preempt) |
| 8 | **Preemption survives a runaway task** | ✅ | `05_preempt…png` — non-yielding `busy` spinner (red counter climbs) can't hang the shell |
| 9 | ELF loader runs programs in ring 3 | ✅ | `06/07/08` — iodemo/rogue/hello "launched in ring 3 as tid 3" |
| 10 | **Ring-3 file I/O via syscall** | ✅ | `06_ring3_iodemo.png` — CPL-3 program wrote+read ring3.txt via syscall, exit 0 |
| 11 | **Ring-3 isolation (hardware-enforced)** | ✅ | `07_ring3_rogue…png` + serial: rogue faults writing kernel mem → "#PF … killed (ring-3 isolation held)", kernel survives |
| 12 | Assistant does real actions **offline** | ✅ | `11_assist_write.png` "wrote to notes.txt: hello world"; `12` read-back |
| 13 | On-device GPT text generation | ⚠️ real but gibberish | `14_assist_gpt.png` — transformer runs on bare metal, emits "To speak dimmanded appear than begin" |
| 14 | Snake game + clean return to desktop | ✅ | `15_snake.png`, `16_after_snake_recovered.png` |
| 15 | Live top-bar clock | ✅ | advanced 00:00:12 → 00:01:57 across frames |

---

## Honest caveats (2)

1. **The on-device GPT produces Shakespeare-flavoured gibberish**, not coherent
   answers. That is exactly what a 212K-parameter char-level transformer trained
   on tiny-shakespeare does — the neural net genuinely runs on bare metal with no
   internet, but it is a *tech demo of on-device inference*, not a chatbot. The
   **useful** AI is the deterministic intent parser (make/write/read/list/delete
   files, open apps) which works perfectly and offline. **Demo framing:** lead
   with the actions ("it does things, no internet"); present the GPT as "and it's
   running a real neural network on a kernel I wrote from scratch," not as a
   smart assistant.

2. **Fonts: chrome is antialiased Inter; all console + in-app text is the 8×8
   bitmap font.** Inter covers the boot splash, top bar, dock, window title bars,
   and close button. Everything *inside* a window (terminal output, Assistant
   header/prompt/output, Files list, Editor, Snake labels) is bitmap. The
   "Astrion Assistant" header only looks smooth because it's scale-3 and blue
   (the old orange accent is now the blue accent). This matches the agreed
   "kernel = honest showcase, cut the web-parity goal" decision.

---

## What this means

The v2.0 from-scratch kernel is **not vaporware** — booted cold, it demonstrates
a real preemptive-multitasking OS with hardware-enforced ring-3 isolation, a
syscall ABI, an ELF loader, a persistent filesystem, and an offline AI that
performs real actions. That is the MVP, and it is genuinely done and genuinely
real. The remaining work is honest polish + the demo/story, not filling holes in
the claims.
