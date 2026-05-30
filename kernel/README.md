# Astrion Kernel (v2.0 bridge)

This is the C-language UEFI bootloader + early kernel for the **v2.0 real-OS
track**. v1.0 (the web-app Astrion desktop, ships Dec 21 2026) does NOT use
this — v1.0 runs on top of Linux. This directory is the multi-year project
toward an actual kernel; see `tasks/real-os-design-2026-05-25.md` for the
honest scope.

## Status (2026-05-26)

- Builds cleanly in CI (`.github/workflows/build-kernel.yml`, ~30s).
- Boots in QEMU through UEFI firmware → runs our bootloader → prints live
  serial through 4 stages → hits `\nova\kernel.bin` lookup.
- **Today's milestone**: the QEMU+EDK2 firmware crash that blocked us
  yesterday is bypassed by switching from the Homebrew-bundled OVMF to the
  upstream EDK2 nightly. See `scripts/get-ovmf.sh`.

## Local test recipe (macOS)

```bash
cd kernel
make run-retrage      # downloads upstream OVMF on first run, then boots
```

Expected serial output ends at "enumerating SimpleFileSystem handles" —
the next debugging step is wiring the LoadedImage → DeviceHandle path so
we find the boot device's filesystem reliably.

## Why two OVMFs?

| Firmware | Source | Behavior |
|---|---|---|
| `/opt/homebrew/share/qemu/edk2-x86_64-code.fd` | Homebrew QEMU 11.0 (Linaro 2024 build) | **#GP in `BootScriptExecutorDxe`** when calling `LocateHandleBuffer(SimpleFileSystem)`. Not our bug. |
| `firmware/RELEASEX64_OVMF.fd` | [retrage/edk2-nightly](https://retrage.github.io/edk2-nightly/) (upstream EDK2 nightly) | No firmware crash. Lets us debug actual bootloader bugs. |

The Homebrew OVMF probably has a backport patch in BootScriptExecutorDxe
that misbehaves with current QEMU. The upstream build is clean. Real
Surface Pro 6 hardware uses Microsoft's UEFI build, which is yet another
EDK2 variant — likely fine, but `docs/hardware-testing.md` is the verify
path.

## Build chain

- `boot/boot.c` — UEFI bootloader (gnu-efi). Sets up serial, GOP (optional),
  loads kernel.bin from boot device, ExitBootServices, jump to kernel.
- `src/kernel.c` — early kernel entry. Currently a stub that prints to
  framebuffer + halts. The real kernel work is multi-year.
- `Makefile` — `make iso` builds the bootable ISO; `make run-retrage` runs
  in QEMU with the working OVMF.
- `scripts/get-ovmf.sh` — downloads the upstream OVMF on demand.

CI builds the ISO on every push to `kernel/**` and uploads it as an
artifact. Download with `gh run download <run-id>`.
