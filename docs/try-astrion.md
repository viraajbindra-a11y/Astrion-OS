# Try Astrion

Astrion is an operating system written from scratch in C. There is no Linux
underneath it and no Windows underneath it — when it boots, the only software
running on the machine is Astrion.

It has a desktop, windows you can drag, a Terminal with about forty-five
commands, a text editor that saves to a real filesystem, a file browser, a
calculator, a system monitor, settings, and Snake. It also has an assistant that
runs entirely offline and **learns how you phrase things**.

You can run it in about five minutes, on the computer you already have. You do
not need a spare machine.

---

## The fastest way: VirtualBox

VirtualBox is free and runs on Windows, Mac and Linux.

1. Install it from [virtualbox.org](https://www.virtualbox.org/wiki/Downloads).
2. Download **astrion.iso** from the
   [Releases page](https://github.com/viraajbindra-a11y/Astrion-OS/releases).
3. Open VirtualBox → **New**.
   * Name: `Astrion`
   * Type: **Other**, Version: **Other/Unknown (64-bit)**
   * Memory: **512 MB** is plenty
   * Hard disk: choose **Do not add a virtual hard disk** — Astrion runs from
     the ISO. (Add one later if you want your files to survive a reboot; see
     *Keeping your files* below.)
4. Select the new machine → **Settings → Storage** → click the empty CD icon →
   choose your `astrion.iso`.
5. **Start.**

You should reach the desktop in a few seconds.

> **Honestly:** every automated test runs under QEMU, not VirtualBox. VirtualBox
> *should* work — Astrion asks for a plain BIOS boot and a PS/2 keyboard, which
> is exactly what VirtualBox provides — but nobody has confirmed it yet. If it
> misbehaves there and works under QEMU, that is worth reporting; it is a real
> bug and it is ours.

## The way we test: QEMU

This is the exact configuration every test in the project runs against, so if
anything is going to work, it is this.

**Mac** (needs [Homebrew](https://brew.sh)):

```bash
brew install qemu
```

**Windows**: install from [qemu.org/download](https://www.qemu.org/download/#windows)

**Linux**:

```bash
sudo apt install qemu-system-x86
```

Then, in the folder where you downloaded the ISO:

```bash
qemu-system-x86_64 -cdrom astrion.iso -m 512
```

## On a Mac, with a GUI: UTM

[UTM](https://mac.getutm.app) is QEMU with a friendly interface. Create a new
**Emulate** machine, pick **Other**, and point its CD drive at `astrion.iso`.
Emulate, not Virtualize — Astrion is x86-64, and Apple Silicon Macs are not.

---

## What to do once it boots

The Terminal opens by itself and tells you where to start. The short version:

**Click `Assistant` in the dock** and ask it things:

```
how much memory
list my files
what version
what's running
write hello to notes.txt
read notes.txt
```

**Then teach it something.** Ask for something it does not understand:

```
gimme my files
```

It will say so. Now say it a way it *does* understand:

```
show me the files
```

It answers, and tells you it learned. Now ask the first way again — it works.
That lesson is written to disk and survives a reboot.

**Or stay in the Terminal.** `help` lists everything. `ls`, `cat readme.txt`,
`edit notes.txt`, `snake`, `ps`, `mem`, `uptime`, `exec hello.elf` all do what
you would expect.

---

## Keeping your files

Astrion runs from the ISO, which is read-only, so by default your files vanish
when you close it. To keep them, give it a virtual hard disk:

**VirtualBox**: add a small (64 MB is plenty) virtual hard disk in Settings →
Storage, on the **IDE** controller. Astrion speaks IDE, not SATA.

**QEMU**: make a disk once, then pass it every time.

```bash
qemu-img create -f raw astrion.disk 64M
```

```bash
qemu-system-x86_64 -cdrom astrion.iso -drive file=astrion.disk,format=raw,if=ide -m 512
```

Type `sync` in the Terminal before shutting down, or use the Assistant, and your
files — and everything it has learned about how you talk — will be there next
time.

---

## When something breaks

It will. This is an operating system written by one person, and it has never run
on real hardware.

Please [open an issue](https://github.com/viraajbindra-a11y/Astrion-OS/issues)
and say:

1. what you were doing,
2. what happened,
3. which program you ran it in (VirtualBox / QEMU / UTM) and on what OS.

A screenshot helps enormously. If you can, run QEMU with `-serial stdio` added —
Astrion prints a running log there, including its own boot messages, and that
log usually says exactly what went wrong.

```bash
qemu-system-x86_64 -cdrom astrion.iso -m 512 -serial stdio
```

---

## What this is not, yet

Being straight about it, because finding out yourself is worse:

* **It does not run on real hardware yet.** It has only ever booted in an
  emulator. Making that work is the next milestone.
* **There is no networking.** None. It cannot reach the internet, which is also
  why the assistant is genuinely offline rather than marketed as offline.
* **You cannot install it** to a hard drive and boot your computer into it.
* **The assistant is not a chatbot.** It runs the machine — files, settings,
  telling you about the hardware. Ask it to write you a poem and it will
  honestly say it cannot, which is the intended behaviour.
