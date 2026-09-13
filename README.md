# Astrion OS

**An operating system written from scratch in C, with the AI built into the kernel. No Linux underneath. Built by a 12-year-old.**

```bash
qemu-system-x86_64 -cdrom astrion.iso -m 512
```

Download `astrion.iso` from the [latest release](https://github.com/viraajbindra-a11y/Astrion-OS/releases/latest),
then read **[docs/try-astrion.md](docs/try-astrion.md)** — five minutes in QEMU, VirtualBox or UTM, no spare computer needed.

<!-- demo GIF goes here once rex records it from the os-v0.3 ISO: ![Astrion](docs/astrion.gif) -->

## What it is

A real x86-64 kernel: GRUB boots it, it sets up long mode and paging itself, and
everything after that is ours — preemptive scheduler, ring-3 programs with their
own page tables and a syscall boundary, an ELF loader, a filesystem that survives
a reboot (ATA), PS/2 keyboard and mouse, a window manager, and a desktop with a
Terminal (52 commands), text editor, file browser, calculator, system monitor,
settings and Snake.

The Assistant is part of the kernel. Tell it `write hello to notes.txt`,
`how much memory`, `what's running`, `set the accent to teal` and it does the
real thing and answers from the kernel's own data. Say something it does not
understand, then say it a way it does, and it learns the phrasing and keeps it
across reboots. It lives inside the kernel and has no path to the network.

It is not a chatbot. The from-scratch language model that can run inside the
kernel is a separate boot module and is **not in the released ISO yet**; when it
is, it produces English-shaped text, not answers, and we say so on screen.

## Status, honestly

- Boots and runs in QEMU, VirtualBox (unconfirmed) and UTM. **Never booted on
  real hardware.**
- Every release passes 14 automated tests that boot the ISO and drive it with a
  real mouse and keyboard ([`kernel/tools/uitest.py`](kernel/tools/uitest.py)).
- Networking: an e1000 driver, ARP, DHCP, ICMP and DNS work from the Terminal
  under QEMU. Nothing is built on top of it. No browser.
- No USB, no SMP, ATA-PIO only, cannot be installed to a disk.

Source: [`kernel/`](kernel/). Plan: [`tasks/LAUNCH-SEPT.md`](tasks/LAUNCH-SEPT.md).

## Who wrote it

- One person directs this project: me, 12 years old. There is no human team;
  the names in [`crew/`](crew/) are Claude agents I run with roles (kernel C,
  design, QA, strategy).
- Claude drafts most of the code, including most of the kernel C. I decide what
  gets built, in what order, and what gets cut.
- I read the diffs and boot every build. Nothing is called done until it is
  seen working on a real boot, and CI enforces that rule on every release.
- The architecture calls are mine: from scratch, no Linux, the AI inside the
  kernel, no path from it to the network, and never claiming the model is
  smarter than it is.
- Lines a human typed: fewer than the lines Claude typed. Deciding what to keep
  is the human part.

## The other track: the web desktop

Before the kernel there was a desktop that runs in a browser — a Node/Express
server, vanilla JS apps, a C/GTK3 shell for a Debian-based live ISO, and an
Electron build. It has 78 apps (62 real + 16 toys), 55 bundled skills, a
Spotlight intent parser and a safety substrate for AI actions (typed capability
levels, red-team review, branch/rewind, golden-file integrity) — see
[docs/SAFETY.md](docs/SAFETY.md). An Electron-based Astrion Browser exists in
[`distro/astrion-browser/`](distro/astrion-browser/) and is installed into that
ISO by `distro/build.sh`; it has never been run outside the dev preview.

**This track is frozen until Oct 1, 2026** ([tasks/PLAN-SEPT.md](tasks/PLAN-SEPT.md)).
Its ISO and desktop-app builds are manual-only. The kernel is the product.
To run it locally anyway:

```bash
git clone https://github.com/viraajbindra-a11y/Astrion-OS.git
cd Astrion-OS && npm install && npm start   # http://localhost:3000
```

Install notes for that ISO: [docs/install.md](docs/install.md).

## Tech

- **Kernel:** C and a little x86-64 assembly, GRUB (multiboot2), tested under QEMU
- **Web desktop:** Node.js + Express + WebSocket, vanilla JS, C/GTK3 shell, Debian Bookworm ISO, Electron; AI via Ollama (local) or Anthropic (optional)

## License
MIT
