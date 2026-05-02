# Install Astrion OS

Three ways to try Astrion. Pick the one that matches your time + risk
appetite.

## Option 1 — Web preview (no install, ~30 seconds)

The whole desktop runs in a browser. No download, no USB, no risk.

→ <https://astrion-os.com> (or visit the GitHub Pages mirror at
<https://viraajbindra-a11y.github.io/Astrion-OS/>).

You get the full UI: setup wizard, dock, Spotlight, settings, every
app. The AI brain falls back to the offline "mock" mode unless you
plug in your own key in Settings → AI. **Limitation:** the kernel
calls that touch the host (boot manager, Wi-Fi picker, package
install) are stubbed — those need the real ISO.

## Option 2 — USB boot (no install, ~10 minutes)

This is the demo path. You boot Astrion off a USB stick without
touching your hard drive. Works on any UEFI laptop made in the last
~10 years.

### What you need

- A USB stick, **4 GB or larger** (the slim ISO is 1.4 GB but USB
  formatting overhead eats some of that)
- A computer that can boot from USB (most laptops since 2015)
- 5–15 minutes of patience

### Steps

1. **Download the ISO.** Latest release:
   <https://github.com/viraajbindra-a11y/Astrion-OS/releases/latest>.
   Grab the `astrion-os-X.Y.Z-amd64.iso` asset.

2. **Verify the SHA-256** (paranoid mode, optional). The release
   notes list the expected hash. On macOS:

   ```bash
   shasum -a 256 ~/Downloads/astrion-os-*.iso
   ```

   On Windows (PowerShell):

   ```powershell
   Get-FileHash $HOME\Downloads\astrion-os-*.iso -Algorithm SHA256
   ```

3. **Write the ISO to USB.** Use one of:
   - **macOS / Linux:** [balenaEtcher](https://etcher.io) — drag
     the ISO, pick the USB, click Flash.
   - **Windows:** [Rufus](https://rufus.ie) — pick the ISO, pick
     the USB, leave defaults, click Start. Choose "Write in DD
     Image mode" if asked.
   - **Command line (any Unix):**
     ```bash
     sudo dd if=astrion-os-X.Y.Z-amd64.iso of=/dev/diskN bs=4M status=progress oflag=sync
     ```
     (replace `/dev/diskN` with your USB device — `lsblk` to find
     it; **double-check before you press enter**, this command will
     overwrite whatever you point it at).

4. **Reboot with the USB plugged in.** Tap the boot-menu key at
   power-on:
   - Most Lenovo: **F12** or **Fn+F12**
   - Most HP: **F9** or **Esc**
   - Most Dell: **F12**
   - Surface Pro: hold **Volume Down** while pressing power
   - MacBook: hold **Option** at chime (Intel) — Apple Silicon
     can't boot Astrion yet, sorry

5. **Pick the USB drive** from the boot menu.

6. **GRUB shows up** with the ASTRION banner. Press Enter (or wait
   3 seconds).

7. **The setup wizard runs.** Walk through:
   - **Account.** Pick a name. Password is optional — leave blank
     for no lock screen.
   - **Wallpaper + accent.** Choose your colors.
   - **Pick your AI brain.** This is the new bit — Astrion reads
     your free RAM and recommends a model size. **Tiny** for 4 GB
     boxes, **Standard** for 8 GB+, **Big** for 16 GB+, **Remote**
     to point at another PC's Ollama, **Skip** to leave the AI
     unwired. The pull happens in-place; on a reasonable
     connection it takes 30 seconds (Tiny) to a few minutes (Big).
   - **Quick tips.** Read or skip.
   - **Done.** Desktop boots.

8. **Try it.** Press **Cmd+Space** (or Ctrl+Space) for Spotlight.
   Ask it anything. The AI is the brain you just picked, running
   on your hardware.

### What's NOT touched

- Your hard drive. The ISO runs from RAM + the USB; nothing on
  your computer changes.
- Your existing OS. Reboot without the USB and you're back to
  Windows / macOS / your usual Linux.

### What persists across reboots

- Nothing, by default. Each USB boot is fresh.
- If you want persistence, see Option 3 (full install) — or wait
  for the upcoming "Astrion live USB with persistence" mode.

## Option 3 — Full install to disk (one-way, ~15 minutes)

The ISO has an installer (the **Install Astrion** app on the
desktop after USB boot). It writes Astrion to a free partition on
your hard drive. **This replaces what's on that partition** —
choose the partition carefully.

We recommend NOT using Option 3 yet unless you have a spare laptop
to test with. Astrion is alpha software; v1.0 is targeted Dec 2026.

## Troubleshooting

- **The USB doesn't show up in the boot menu.** Try a different USB
  port (some BIOSes only see USB 2.0 ports for boot). Make sure you
  wrote the ISO with DD/Image mode, not as a file copy.
- **GRUB shows up but the kernel hangs.** Try the "safe graphics"
  boot entry (arrow down in GRUB). On very-recent NVIDIA laptops you
  may need to add `nomodeset` to the kernel cmdline.
- **The wizard says "Could not download brain."** Your network isn't
  reachable yet. Skip the brain step, finish the wizard, connect
  Wi-Fi from the menubar, then go to Settings → AI → Pull Model.
- **Anything else.** Open an issue:
  <https://github.com/viraajbindra-a11y/Astrion-OS/issues>.

## What you get

- 76 apps (Notes, Terminal, Calculator, Files, …)
- Spotlight search with intent kernel
- Self-hosted AI — Ollama bundled, model on your laptop
- Five-gate self-modification with branch + rewind
- Open source, MIT-style licensed, free forever

## Hardware tested

| Device | Status |
|---|---|
| Surface Pro 6 | ✓ verified |
| ThinkPad / IdeaPad (Intel + AMD) | testing in progress |
| Chromebook (boot-from-USB enabled) | testing in progress |
| Apple Silicon Mac | ✗ not supported (no x86_64) |

If you boot Astrion on hardware not on this list, please file an
issue with `[hardware]` in the title and the make/model — we're
building the compatibility matrix.
