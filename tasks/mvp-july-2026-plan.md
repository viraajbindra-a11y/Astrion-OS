# Astrion v2.0 — July MVP Plan (tiered)

**Goal:** turn the from-scratch C kernel from "has all the OS primitives" into a
**demo-able, AI-native MVP operating system** — one you can boot, use, and show off.

**Deadline:** July 31 2026 (Aug 5 hard ceiling). Plan written 2026-07-03.
**Scope:** the REAL kernel in `kernel/` — NOT the Linux/web v1.0.
**Mode:** all four tracks, phased into weekly tiers, each tier ends shippable.

---

## Where we start (2026-07-03)
Already done + QEMU-verified: multiboot2+GRUB boot, 1280×800×32 framebuffer +
8×12 font + scrolling console, IDT/panic, PIC/PIT, PS/2 keyboard + mouse, ~27-cmd
shell, Snake, kmalloc heap, RAM FS, ATA disk persistence, scripts + `>`,
preemptive multitasking (ps/spawn/kill), exec (ELF64 PIE loader), ring-3
isolation + 7 syscalls. 203 lessons. HEAD `a00b2d7`.

The substrate is done. What's missing for an **MVP a person can use and be wowed
by**: it looks like a terminal not an OS; there's no AI (the whole identity); user
programs can't touch files; programs aren't isolated from each other; it's only
ever booted in QEMU.

---

## TIER 1 — Make it LOOK and FEEL like an OS  (Week 1: Jul 3–10)
*Highest demo leverage. Pure solo/QEMU. Ends with a screenshot that reads "desktop OS".*

- **T1.1 Desktop chrome** — top bar (Astrion logo, live clock, mem/task status),
  a wallpaper/background, a bottom dock/launcher. The shell becomes a "Terminal
  app" inside this, not the whole screen.
- **T1.2 Window manager (minimal)** — draw framed windows (title bar + border +
  close box), one focused at a time, mouse-movable. Even 2–3 windows sells it.
- **T1.3 Text editor app** — open/edit/save a file in the FS, framebuffer-drawn,
  keyboard-driven. Real utility + demo staple.
- **T1.4 File browser app** — visual list of FS files, click to open (editor / run).
- **T1.5 Visual polish pass** — palette, spacing, a nicer font weight for headings,
  smooth-ish cursor, boot splash.
**Ship:** a screenshot of the Astrion desktop with the clock, dock, an editor
window open. "He built an OS" moment.

## TIER 2 — AI-native assistant  (Week 2: Jul 10–17)
*The differentiator. Astrion = "the AI-native OS"; the kernel has zero AI today.*

- **T2.1 Intent router** — natural-language → OS action. "open my notes", "what's
  my uptime", "make a file called todo", "list files", "run snake". Parses intent,
  executes real kernel actions. Honest framing: on-device command understanding.
- **T2.2 On-device generative fallback** — a small, genuinely-local text generator
  (template + a compact Markov/knowledge model over a bundled corpus about the OS)
  so `ai <question>` answers OS questions without a network. NOT an LLM — labeled
  honestly as a local assistant.
- **T2.3 Assistant UI** — a dedicated assistant window/panel (Tier-1 chrome) with a
  prompt line + scrolling reply, plus the `ai` shell command.
- **T2.4 Wire actions safely** — the assistant can only invoke a whitelisted set of
  kernel actions (open editor, create/list/delete file with confirm, launch app).
**Ship:** type `ai open todo and it's demo day` → the editor opens a file. Demo gold.

## TIER 3 — Technical depth / robustness  (Week 3: Jul 17–24)
*Credibility to a technical reviewer. This is where the adversarial-review workflow
earns its keep (per-process isolation is boundary-substrate — lessons #200/#202/#203).*

- **T3.1 Per-process address spaces** — a PML4 per ring-3 task; every program links
  at the same base VA; a program probing outside its own map is killed. Isolates
  programs from EACH OTHER (the honest #1 gap in `usermem.h`). ← adversarial review.
- **T3.2 Ring-3 file-I/O syscalls** — open/read/write/close over the FS so user
  programs actually USE the filesystem, not just print. Grows the ABI past 7 calls.
- **T3.3 Page allocator over real RAM** — replace the fixed 2 MiB static user pool
  with a frame allocator over the multiboot2 mmap (~255 MiB), so many/large programs.
- **T3.4 A real sample program** — a user-space app that reads a file, transforms it,
  writes it back — proving the ABI end-to-end in ring 3.
**Ship:** two isolated programs running at once + a user program that edits a file.

## TIER 4 — Real hardware + release  (Week 4: Jul 24–31)
*The capstone + shipping. Honest scope on hardware (see note).*

- **T4.1 Bootable USB image** — hybrid ISO (grub-mkrescue already makes these);
  verify + document the `dd` flash recipe per OS.
- **T4.2 Real-hardware boot** — boot on an actual laptop, render the Astrion desktop
  + live clock on a real screen. **Photograph it.** (See hardware note.)
- **T4.3 Bug bash + hardening** — run the whole demo path, fix what breaks, canary
  every new parser/bound (wrap-safe `a > cap - b`).
- **T4.4 Release** — version bump, git tag `v0.2-mvp`, capture the screenshot/photo
  deck + a short demo clip for the Dad update.
**Ship:** photo of Astrion on real hardware + a tagged MVP release.

**Buffer:** Aug 1–5 for overflow on any tier.

---

## Honest hardware note (Tier 4)
Modern laptops have **no PS/2 keyboard** (USB HID) and **no ATA PIO disk** (AHCI/
NVMe). Our drivers are PS/2 + ATA PIO. So on a modern machine we get **boot +
framebuffer display + clock** (GRUB sets the framebuffer; PIT is legacy) — a real,
photographable milestone — but **not keyboard/disk**. Full interactivity on real
hardware needs either (a) an old PS/2-era laptop in BIOS legacy/IDE mode, or (b) a
USB HID + AHCI stack (months, post-MVP). Tier 4's committed goal is the display
milestone; full interactive real-hardware is a stretch. This is stated so nobody
is surprised — not a reason to skip it.

## Tiering logic
1 before 2: the assistant needs windows/apps to open. 2 before 3: demo value first,
depth second (depth is invisible in a demo but real for credibility). 4 last: you
can't ship-to-hardware until the software MVP exists. Polish is folded into every
tier, not saved for the end. Each tier is independently shippable, so a slip on a
late tier still leaves a real MVP.
