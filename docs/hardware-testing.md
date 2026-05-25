# Hardware testing — pre-flash checklist + post-boot smoke test

This doc is for the small group flashing Astrion on real hardware.
Today: the 12-year-old founder + dad. By Phase 4 (Aug 10 – Sep 27,
2026): a 5-laptop matrix.

If you're an end user who just wants to try Astrion in a browser or
boot from USB without flashing, see [`install.md`](install.md)
instead. This doc is the harder, riskier path.

---

## Pre-flash checklist

**Don't skip.** Each item is here because we got bitten by it (or
because it would brick someone if we don't catch it).

### Power
- [ ] Laptop battery **at 80% OR plugged into AC.** Lesson #193:
      a low-battery force-sleep mid-self-mod-cycle false-positives
      as a rollback failure. Do not flash on a laptop that might
      sleep during the test.
- [ ] Plug in `caffeinate -i` (macOS host) or equivalent on the
      host that's writing the USB. Interrupting `dd` mid-write
      leaves a corrupted USB that boots into nothing.

### Recovery path (before you touch the target laptop)
- [ ] **Surface Pro 6 specifically:** have a Windows Recovery USB
      ready. Make it from another machine via
      [Microsoft's tool](https://support.microsoft.com/en-us/surface-recovery-image).
      You will want this if Astrion's installer (which we are NOT
      running for v1.0 — USB-only — but a future tester might) ever
      writes to the EFI partition.
- [ ] **Any laptop:** know the boot-menu key. Surface Pro:
      Volume Down + Power. ThinkPad: F12. Most: F2/F8/F9/F12.
      [`install.md`](install.md) has the full list.
- [ ] If the laptop has anything important on it, **back it up**.
      We aren't writing to disk, but a botched flash + a panic'd
      reformat is how laptops lose data. Don't be that person.

### ISO integrity
- [ ] Download the latest ISO from
      <https://github.com/viraajbindra-a11y/Astrion-OS/releases>.
- [ ] Verify the SHA-256 against the release notes:
      ```bash
      shasum -a 256 ~/Downloads/astrion-os-*.iso
      ```
      A mismatch means the download corrupted; re-download.

### USB stick
- [ ] **8 GB or larger.** The slim ISO is ~1.4 GB but USB
      formatting overhead + FAT cluster waste eats some of that.
- [ ] **USB 3.0 stick if possible.** USB 2.0 boots are 5–10×
      slower; testing patience is a finite resource.
- [ ] **Brand-name stick.** Cheap unbranded sticks fail random
      blocks during DD write; balenaEtcher will catch this in
      verify mode (which it runs by default).
- [ ] **Use a USB 3.0 port** on the target laptop. Some Surface
      Pro 6 USB-A ports are wired to the USB 2.0 hub internally;
      try every port if boot is weird.

### Target-laptop BIOS / UEFI prep
- [ ] **Disable Secure Boot.** Astrion's GRUB isn't Microsoft-
      signed (yet). Surface Pro 6: power off, hold Volume Up while
      pressing power, → Security → Secure Boot → Disable.
- [ ] **Confirm UEFI boot** (not Legacy/CSM). Astrion only boots
      UEFI in v0.2.x.
- [ ] If the laptop has a TPM-locked Windows partition, **suspend
      BitLocker** before flashing the USB. (Surface Pro 6 with
      Windows 11 has this by default.) Otherwise rebooting after
      pulling the USB may demand the recovery key.

### Network on the target
- [ ] **Wi-Fi credentials in your head** — Astrion's setup wizard
      will ask. Don't pull up a sticky note while the laptop's
      booted into Astrion; the Wi-Fi picker is the first thing.
- [ ] **If you want the AI brain** during the first run, you'll
      need network reachable BEFORE you click through the wizard's
      AI Brain step. The wizard pulls the Ollama model in-place;
      no network = no model = mock AI until Settings → AI → Pull
      Model.

---

## Flash

1. Write the ISO with balenaEtcher (macOS / Linux) or Rufus
   (Windows; pick "DD image mode" if asked).
2. **Wait for verify to finish** — Etcher does this automatically.
   Skipping verify is how you find out at boot time that a block
   is bad.
3. Eject the USB cleanly.

---

## Boot the target

1. Plug USB into the target laptop's USB 3.0 port.
2. Power on while holding the boot-menu key for that laptop.
3. Select the USB drive.
4. GRUB appears with the ASTRION banner. **Press Enter** (or wait
   3 s).
5. The kernel scroll-by takes 20–60 s depending on the laptop.
   Expect blank screen flashes — Astrion is detecting hardware.

If the kernel hangs OR you see a panic message:
- Reboot, this time pressing **Esc** in GRUB to see the boot
  options. Try the "safe graphics" entry (different driver path).
- On very-recent NVIDIA laptops, add `nomodeset` to the kernel
  cmdline via GRUB's `e` key.
- File a bug with the panic text + laptop model.

---

## Post-boot smoke test

Once the setup wizard finishes and the desktop is visible:

### Smoke 1 — surface input
- [ ] Touchscreen works (tap a dock icon, it launches)
- [ ] Pen/stylus works (open Notes app, scribble — surface should
      register strokes)
- [ ] Type Cover keyboard works (Spotlight `Cmd+Space`, type
      something)
- [ ] Trackpad works (cursor moves, click registers)

### Smoke 2 — basic apps
- [ ] Spotlight opens via Cmd+Space (or Ctrl+Space on non-Mac
      keyboards)
- [ ] Open Notes → write 2 sentences → close → reopen → text
      persists
- [ ] Open Calculator → 2+2 = 4
- [ ] Open Files → see at least the gitignored home

### Smoke 3 — Wi-Fi + Astrion's network paths
- [ ] Click the Wi-Fi indicator in the menubar → see your network
      → click → enter password → connected
- [ ] Open Settings → AI → if you skipped the wizard's AI Brain
      step, click "Pull Model" for one of {qwen2.5:1.5b,
      qwen2.5:7b, gpt-oss:20b} per available RAM
- [ ] Open Spotlight → type "what's 17 * 23?" → response should
      come back within ~2 s (cached) or ~5 s (cold model load)

### Smoke 4 — THE safety story (the reason we built this)

The whole v1.0 launch hinges on this working on real hardware.

- [ ] Settings → Safety → **▶ Run disk cycle** (single click,
      wait ~25 s for the first cycle to warm Ollama)
- [ ] Verify the disk-cycles row shows `1 · 1 ok · 0 failed`
- [ ] Verify the last-cycle line shows `apply ✓ · applyV ✓ ·
      rollback ✓ · rollbackV ✓` — all four green
- [ ] Click ▶ Start soak. Let it run 10 minutes. Verify a second
      cycle fires at tick 10 + completes green
- [ ] If both cycles green: this hardware passes the M8.P5
      verification gate. If any cycle fails: file a bug with the
      "Last failure" row contents (the gate name + reason) +
      laptop model + Ollama model + Astrion version

### Smoke 5 — recovery
- [ ] Cleanly shut down (menubar → power → Shut Down)
- [ ] Pull the USB
- [ ] Reboot — laptop should come back to Windows / its normal OS
      with no changes
- [ ] If the laptop DOESN'T come back to its normal OS: insert the
      Windows Recovery USB you prepared at the top of this doc,
      boot it, "Repair this PC" → restore BCD

---

## What to file as a bug

Open an issue at
<https://github.com/viraajbindra-a11y/Astrion-OS/issues> with
**`[hardware]`** in the title and include:

- Laptop model + year
- Astrion version (visible in About: Settings → System Info)
- Specific smoke step that failed (e.g. "Smoke 3 — Wi-Fi
  password accepted but no IP")
- The "Last failure" row from Settings → Safety if a soak cycle
  failed
- A screenshot if anything looks wrong visually

Bugs from real-hardware boots are by far the most valuable signal
we get during the Phase 4 hardware soak. Thank you.

---

## Known issues

- **Surface Pro 6 — touch sometimes lags after wake.** Workaround:
  Settings → Display → toggle resolution and back. Real fix is
  Phase 4 work.
- **NVIDIA laptops with proprietary driver.** GRUB's `nomodeset`
  kernel cmdline option is the v1.0 workaround. Nouveau works
  unaccelerated but glitchy.
- **MacBook Apple Silicon (M1/M2/M3/M4).** Not supported. Astrion
  is x86_64-only in v1.0. v2.0 may add Asahi-style arm64; no
  commitment.

---

## When this doc changes

Update this file as the hardware matrix grows. Each "🟡 testing"
in [`install.md`](install.md) that becomes "✓ verified" needs:
- A new row in this doc's "Known issues" if anything is rough
- A pull-request comment with the smoke-test result from that
  laptop
- Optionally a screenshot of the Settings → Safety panel showing
  N green disk cycles, to prove the substrate works on that
  hardware (much stronger evidence than "I clicked some buttons")
