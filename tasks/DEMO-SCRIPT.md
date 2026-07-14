# Astrion v2.0 — Demo Script

Everything you need to present the OS with confidence. Practice it 2–3 times
and you'll be smooth. It's built to be **honest** — every claim here is true,
so nobody can catch you overselling.

---

## The one-liner (memorize this)

> "Astrion is an operating system I built from scratch in C — no Linux, no
> Windows underneath. It boots on a bare machine, has a desktop and apps, and
> it runs a small AI language model I trained myself, **inside the kernel** —
> no internet, no cloud."

If you only get one sentence, that's the one.

---

## How to run it (do this BEFORE you present)

The OS is an ISO file built by CI. On a Mac with QEMU installed
(`brew install qemu`):

```bash
qemu-system-x86_64 -cdrom astrion-grub.iso -m 256M
```

A window opens and Astrion boots. To get the ISO: download the
`astrion-grub-iso` artifact from the latest green "Build Astrion OS Kernel"
run on GitHub.

**Practice tip:** boot it once before the real demo so you know the timing.
Keep the screenshots in `tasks/*/` open in a folder as a backup in case the
laptop acts up.

---

## The demo, beat by beat

Each beat: **DO** = what you click/type. **SAY** = roughly what you say.
Go slow. Let each thing land.

### 1. Boot — the splash
**DO:** Start QEMU. The orange **Astrion** splash appears for ~1.5s, then the
desktop.
**SAY:** "This is my kernel booting on a bare machine. That splash, and
everything after it, is drawn by my own code — there's no operating system
under it doing the work."

### 2. The desktop
**DO:** Let them look. Point at the top bar clock ticking, the dock at the
bottom.
**SAY:** "A real desktop — top bar, a live clock, a dock of apps, a terminal
window. I drew all of this pixel by pixel."

### 3. The shell + filesystem
**DO:** Click the Terminal, type `help`, then `ls`.
**SAY:** "It has a real shell with commands, and a filesystem — these are
actual files stored on a virtual disk that survive a reboot."

### 4. Files + Editor (saves to disk)
**DO:** Type `files` (or click the Files dock icon). Arrow down to a file,
press Enter — it opens in the Editor. Type something, press **ESC** (saves).
Back in the terminal, `cat` the file to show your text is really there.
**SAY:** "A file browser and a text editor. When I save, it writes to the
disk for real — I can reboot and it's still there."

### 5. THE BIG ONE — the AI assistant
**DO:** Type `assistant` (or click the Assistant dock icon — it lights up).
Type `ROMEO` and press Enter. Watch it generate text, letter by letter.
**SAY:** "This is the part I'm proudest of. This is a neural network — an AI
language model — that I **trained myself**, and it's running *inside my
kernel*. No internet. No cloud. No graphics card. It's doing the math on the
CPU, live. I trained it on Shakespeare, so it writes in that style."

> **Be honest here (important):** if someone asks "can it answer questions
> like ChatGPT?" — say **no**: "It's a small model — about 200,000 numbers.
> It learned to write in a style, not to answer questions. The hard part I'm
> showing is that a neural network runs *at all* on an OS I wrote from
> scratch." That honesty makes you look smarter, not weaker.

### 6. Protected programs (the security wow — optional, great for judges)
**DO:** `exec iodemo.elf` — a program runs and reads/writes a file. Then
`exec rogue.elf` — it tries to attack the kernel and gets killed, but the OS
keeps running (`ls` still works).
**SAY:** "Programs run in a locked-down mode. This one does real work safely.
This next one *tries to attack the kernel* — and the CPU stops it, kills just
that program, and my OS keeps running like nothing happened."

### 7. Snake (fun closer)
**DO:** Click the Snake dock icon (or type `snake`). Play for 10 seconds.
**SAY:** "And of course… it plays Snake." (smile, let them laugh)

---

## Brag sheet — for questions / judges

Real, specific things you built (all true — say them with confidence):

- **Boots from scratch** via multiboot2 + GRUB into 64-bit long mode; sets up
  its own page tables and interrupt handlers.
- **Drivers I wrote:** keyboard, mouse, timer, display (framebuffer), and an
  ATA disk driver for persistence.
- **Real OS core:** a memory allocator, a filesystem, a shell, and a
  **preemptive scheduler** — many programs share one CPU, and a program stuck
  in a loop can't freeze the machine.
- **Runs real programs:** a proper ELF loader loads programs from files.
- **Protected mode (ring 3):** untrusted programs run isolated from the
  kernel and can only reach it through a real `syscall` instruction — attack
  it and you get killed, the kernel survives.
- **On-device AI:** a char-level transformer (~212K parameters) I trained in
  Python, with the inference engine rewritten in C to run in the kernel with
  a KV-cache and hardware floating point. No network, no libc.

If asked **"did you really build all this?"** — be honest: "Yes, I wrote the
kernel and all of it. I learned from tutorials and used standard tools like
GRUB and the C compiler, the same way every OS developer does. The design and
the code are mine."

---

## If something breaks

- **Won't boot / weird screen:** close QEMU and run the command again. It's
  deterministic; a re-boot fixes almost anything.
- **Assistant is slow:** that's normal — it's doing real math on the CPU.
  Let it run; the slowness is kind of the point ("watch it think").
- **Total failure:** open the screenshots in `tasks/ai-assistant-2026-07-08/`,
  `tasks/wm-apps-2026-07-04/`, `tasks/ring3-fileio-2026-07-10/`, and
  `tasks/boot-splash-2026-07-13/` and walk through those instead. Every beat
  above has a real screenshot proving it works.

---

## Timing

Whole demo is ~3–4 minutes. Beats 1–5 are the core (do these no matter what).
6 and 7 are bonus if you have time and the room is into it.

Good luck. You built a real operating system. Own it.
