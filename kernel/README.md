# Astrion Kernel (v2.0 bridge)

This is the C-language UEFI bootloader + early kernel for the **v2.0 real-OS
track**. v1.0 (the web-app Astrion desktop, ships Dec 21 2026) does NOT use
this — v1.0 runs on top of Linux. This directory is the multi-year project
toward an actual kernel; see `tasks/real-os-design-2026-05-25.md` for the
honest scope.

## Status (2026-06-10)

The multiboot2/GRUB path is the live kernel; it is **no longer a stub**.
What works today (each milestone has a screenshot in `tasks/first-*.png`):

| Subsystem | Files | Verified |
|---|---|---|
| Boot: GRUB → long mode → 4 GiB identity map | `boot/multiboot2.S` | ✅ |
| Multiboot2 info parse (mmap, framebuffer) | `src/kernel_mb2.c` | ✅ |
| Framebuffer text (8×12 font) + boot screen | `src/fb_font.h` | ✅ |
| IDT + 32 exception handlers + panic screen | `src/isr.S`, `src/idt.{h,c}` | ✅ |
| PIC remap + IRQ dispatch | `src/idt.c` | ✅ |
| PIT timer @100 Hz + uptime clock | `src/pit.{h,c}` | ✅ |
| PS/2 keyboard (incl. arrow keys) | `src/kbd.{h,c}` | ✅ |
| PS/2 mouse + cursor sprite + drag-paint | `src/mouse.{h,c}` | ✅ |
| Scrolling console + 25-command shell | `src/console.{h,c}`, `src/shell.{h,c}` | ✅ |
| Snake game (PIT-timed, arrow-steered) | `src/snake.{h,c}` | ✅ |
| Heap allocator (kmalloc/kfree/krealloc) | `src/heap.{h,c}` | ✅ |
| RAM filesystem (ls/cat/write/append/rm) | `src/fs.{h,c}` | ✅ |
| ATA PIO disk + persistence across reboots | `src/ata.{h,c}` + `fs_sync` | ✅ |
| Shell scripts (`run`) + redirection (`>`) | `src/shell.c`, `src/console.c` | ✅ |
| Cooperative scheduler (ps/spawn/kill) | `src/task.{h,c}`, `src/context_switch.S` | ✅ |

The legacy UEFI/gnu-efi path (`boot/boot.c`, `make iso`) still builds in CI
but is parked on two stacked OVMF firmware bugs (lesson #194). Surface Pro 6
hardware remains its next test vector.

## Local test recipe (macOS)

```bash
cd kernel
make run-grub        # build + boot the kernel in QEMU

# Or grab the CI artifact and boot with a persistent disk:
gh run download <run-id> --name astrion-grub-iso
dd if=/dev/zero of=astrion.disk bs=1M count=16
qemu-system-x86_64 -cdrom astrion-grub.iso \
  -drive file=astrion.disk,format=raw,if=ide -m 256M -serial stdio
```

In the shell, try: `help`, `ls`, `write hi.sh echo hello`, `run hi.sh`,
`ls > files.txt`, `sync` (then reboot — files persist), `spawn`, `ps`,
`snake` (the clock + spawned ticker keep running mid-game).

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
