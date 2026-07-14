# Tier 4 — Booting Astrion on a real machine (USB)

This is the part I (Claude) can't do for you — it touches physical hardware
and a destructive disk write. Here are the exact steps to do it safely.
**Read the ⚠️ warnings — a wrong `dd` command can erase your Mac.**

---

## What you need

- A **USB stick** (any size ≥ 64 MB; it will be **fully erased**).
- The ISO: `astrion-grub.iso` — download the `astrion-grub-iso` artifact from
  the latest green **Build Astrion OS Kernel** run on GitHub.
- A **target laptop** to boot it on (not your main machine — see the hardware
  reality below).

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

---

## Step 2 — Boot the laptop from the USB

1. Plug the USB into the **target** laptop (powered off).
2. Power on and immediately tap the **boot-menu key**. It varies by brand:
   - Dell: `F12` · HP: `F9` or `Esc` · Lenovo: `F12` · ASUS/Acer: `F12` or
     `Esc` · Surface: **hold Volume-Down** while powering on.
3. Pick the USB stick from the menu.
4. If it doesn't show / won't boot, enter BIOS setup (`F2`/`Del`) and:
   - Enable **Legacy Boot / CSM** (see the reality note below),
   - Disable **Secure Boot**,
   - then retry the boot menu.

**What you should see:** the orange **Astrion splash**, then the desktop with
the top-bar clock ticking. That's your OS running on bare metal. **Take a
photo — that's the Tier 4 win.**

---

## The honest hardware reality (read this before you try)

Two real limits right now. Neither is a bug — they're just features not built
yet, and the guide above still gets you a legit "it boots on real hardware"
photo on the right machine.

1. **Boot mode: the ISO is BIOS/Legacy-boot.** Our build uses BIOS GRUB
   (`grub-pc-bin`). So the target machine needs **Legacy/CSM boot support**
   (most laptops from roughly before ~2018 have it; many new UEFI-only ones
   do not — a Surface Pro 6 is UEFI-only). *I can add UEFI boot support to the
   ISO (a build change) so it boots modern machines too — just ask.*

2. **Keyboard/mouse: PS/2 only.** Our drivers are PS/2. Modern laptops use
   USB-HID keyboards/trackpads, which we don't have a driver for yet. So on a
   modern machine you'll get **boot + desktop + live clock, but typing won't
   work** (still a great photo). For a **fully interactive** demo on metal you
   want an **older laptop in Legacy/BIOS mode** (physical PS/2-style input),
   or wait for a USB stack (a real post-MVP milestone).

**Best target for a full hardware demo:** an old laptop (~pre-2018) that has a
Legacy/CSM option in BIOS. A thrift-store special works great.

**If all you have is a modern/UEFI machine:** tell me and I'll (a) add UEFI
boot support so it boots at all, and you'll get the boot-and-desktop photo;
full input still needs the USB stack.

---

## Safest option of all: just use QEMU

For the actual presentation, booting in QEMU on your Mac is more reliable than
fighting a stranger laptop's BIOS, and looks identical on the projector. See
`tasks/DEMO-SCRIPT.md`. Real hardware is a bonus flex, not a requirement.
