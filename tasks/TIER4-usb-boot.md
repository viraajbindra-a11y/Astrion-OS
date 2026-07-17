# Tier 4 — Booting Astrion on a real machine (USB)

This is the part I (Claude) can't do for you — it touches physical hardware
and a destructive disk write. Here are the exact steps to do it safely.
**Read the ⚠️ warnings — a wrong `dd` command can erase your Mac.**

> **What changed (2026-07-17):** I inspected the actual CI-built ISO and the
> old "BIOS/Legacy-only" warning was **wrong**. The ISO is a proper **hybrid**
> — it boots **BIOS *and* modern UEFI machines**, and it's USB-writable. Details
> in "The honest hardware reality" below. The one real limit left is **input**
> (PS/2 only), not boot mode.

---

## What you need

- A **USB stick** (any size ≥ 64 MB; it will be **fully erased**).
- The ISO: `astrion-grub.iso` — download the `astrion-grub-iso` artifact from
  the latest green **Build Astrion OS Kernel** run on GitHub.
- A **target machine** to boot it on (not your main machine).

---

## Step 1 — Write the ISO to the USB stick

### Easiest + safest: balenaEtcher (recommended)
1. Install **balenaEtcher** (free, from balena.io).
2. Flash from file → pick `astrion-grub.iso`.
3. Select target → pick your USB stick.
4. Flash. Etcher won't let you pick your system drive, so it's hard to mess up.

### Command line (faster, but ⚠️ dangerous)
```bash
# 1. List disks and FIND YOUR USB. Look at the SIZE to identify it.
diskutil list

# 2. Say it's /dev/disk4 — TRIPLE-CHECK this number. If you pick your
#    Mac's disk here you WILL erase your computer.
diskutil unmountDisk /dev/disk4

# 3. Write it (rdisk = raw = faster). Replace disk4 with YOUR number.
sudo dd if=astrion-grub.iso of=/dev/rdisk4 bs=4m
# (this takes ~1 min; no progress bar — be patient. Ctrl-T shows status.)

# 4. Eject
diskutil eject /dev/disk4
```
> ⚠️ **The `of=` disk number is the whole risk.** `diskutil list` shows every
> disk; the USB is usually the last one and matches your stick's size (e.g.
> "16.0 GB"). If you're not 100% sure, use balenaEtcher instead.

The ISO is `isohybrid`/GPT-hybrid (verified: GPT protective MBR + an EFI El
Torito image with `BOOTX64.EFI`), so a raw `dd`/Etcher write boots on both
BIOS and UEFI firmware straight off the stick.

---

## Step 2 — Boot the machine from the USB

1. Plug the USB into the **target** machine (powered off).
2. Power on and immediately tap the **boot-menu key**. It varies by brand:
   - Dell: `F12` · HP: `F9` or `Esc` · Lenovo: `F12` · ASUS/Acer: `F12` or
     `Esc` · Surface: **hold Volume-Down** while powering on.
3. Pick the USB stick. On a UEFI machine it may appear twice — as
   **"UEFI: <stick>"** and a plain **"<stick>"** (that's BIOS/legacy). Either
   boots Astrion; UEFI is the modern default.
4. **Disable Secure Boot first if the USB won't boot / is rejected.** Our
   `BOOTX64.EFI` is GRUB and is **not signed** with Microsoft's key, so Secure
   Boot will block it. Enter BIOS setup (`F2`/`Del`) → Security → **Secure Boot
   = Disabled** → save → retry. (You do **not** need Legacy/CSM — UEFI works.)

**What you should see:** the **blue Astrion splash**, then the desktop with the
top-bar clock ticking. That's your OS running on bare metal. **Take a photo —
that's the Tier 4 win.**

---

## The honest hardware reality (read this before you try)

What's **guaranteed** on essentially any x86-64 PC with a screen, versus what's
**machine-dependent** — stated straight, because the demo's credibility is that
we never oversell.

| Capability | On real hardware | Why |
|---|---|---|
| **Boot (BIOS or UEFI) + USB** | ✅ guaranteed | Hybrid ISO, verified in the CI artifact (`BOOTX64.EFI` + BIOS GRUB + GPT-hybrid MBR). |
| **Splash → desktop → live clock → mouse cursor** | ✅ guaranteed | Framebuffer address comes from GRUB's multiboot2 tag (not hardcoded), and the clock reads the CMOS RTC. Standard on all PCs. |
| **Power off (menu → Shut Down)** | ✅ almost always | Real ACPI S5 — exactly what ACPI is for on physical machines. |
| **Keyboard + mouse input** | ⚠️ machine-dependent | We have a **PS/2 (i8042) driver only — no USB stack.** A laptop's *internal* keyboard/trackpad usually still works because the embedded controller presents it on i8042; a desktop's USB keyboard works only if **BIOS "USB Legacy Support" is ON**. Some strict UEFI machines drop i8042 emulation once our OS takes over → typing goes dead. Boot + desktop are unaffected. |
| **File persistence across reboot** | ⚠️ machine-dependent | We have an **ATA-PIO disk driver only.** NVMe/AHCI-only laptops (most 2016+) → no disk → the RAM filesystem still works (you can create/edit files in the session), they just don't survive a reboot. Every demo beat is in-session, so this doesn't affect the demo. |

**So:** on almost any machine you get **boot + desktop + clock + mouse + power-off**
for a legit "it runs on bare metal" photo. For **full keyboard interactivity**,
your best bet is a machine whose input rides i8042 — an older laptop's built-in
keyboard, or a desktop with **USB Legacy Support enabled** (or a literal PS/2
keyboard). A USB HID stack is a real post-MVP milestone, not a quick fix.

### Advanced: if the screen stays black but the machine clearly booted
The kernel identity-maps the low **4 GiB** of physical memory. If a particular
UEFI firmware places the GOP framebuffer **above 4 GiB** (rare — most are under),
the first draw would fault into unmapped memory. The tell is the serial line
`framebuffer @ <addr>` showing a high address. Only visible if the machine has a
serial port (or a USB-serial adapter on a header) — most laptops don't, so treat
this as a known edge case to report back, not something to chase blind.

---

## Safest option of all: just use QEMU

For the actual presentation, booting in QEMU on your Mac is more reliable than
fighting a stranger machine's firmware, and looks identical on a projector. See
`tasks/demo-2026-07-17/DEMO-SCRIPT.md`. Real hardware is a bonus flex, not a
requirement — and the `demo.gif` in that folder is the fallback that always works.
