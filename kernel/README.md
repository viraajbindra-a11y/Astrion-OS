# Astrion Kernel

This is the product: an x86-64 operating system written from scratch in C, with
the Assistant built into the kernel. GRUB hands it control via multiboot2 and
everything after that is ours. No Linux underneath. It is what the `os-v*`
releases ship and what `docs/try-astrion.md` tells people to boot.

The web desktop in the repo root (`js/`, `server/`, `distro/`) is the older
track and is frozen until Oct 1, 2026 (`tasks/PLAN-SEPT.md`). Plan and dates:
`tasks/LAUNCH-SEPT.md`.

## Status (2026-09-13)

Everything below is in the released ISO and is exercised by the UI suite on
every release (`tools/uitest.py`, 14 tests that boot the real kernel in QEMU and
drive it over QMP):

| Subsystem | Files |
|---|---|
| Boot: GRUB multiboot2 → long mode → paging (1 GiB pages when the CPU has them) | `boot/multiboot2.S`, `src/kernel_mb2.c` |
| IDT, exceptions, panic screen, PIC + IRQ dispatch, PIT @100 Hz | `src/isr.S`, `src/idt.{h,c}`, `src/pit.{h,c}` |
| Physical frame allocator + kernel heap | `src/pmm.{h,c}`, `src/heap.{h,c}` |
| Preemptive scheduler, ring 3 with a syscall boundary, per-process address spaces | `src/task.{h,c}`, `src/context_switch.S`, `src/usermode.S`, `src/syscall.{h,c}`, `src/vmspace.{h,c}`, `src/usermem.{h,c}` |
| ELF loader + bundled test programs (`hello`, `rogue`, `poke`, `peek`, `iodemo`) | `src/elf.{h,c}`, `src/*_elf.h` |
| RAM filesystem, ATA PIO disk, persistence across reboots | `src/fs.{h,c}`, `src/ata.{h,c}` |
| PS/2 keyboard + mouse, serial console, CMOS RTC, ACPI shutdown/reboot | `src/kbd.{h,c}`, `src/mouse.{h,c}`, `src/serial.{h,c}`, `src/rtc.{h,c}`, `src/acpi.{h,c}`, `src/power.{h,c}` |
| Framebuffer, antialiased font, window manager, desktop + dock | `src/af.{h,c}`, `src/wm.{h,c}`, `src/desktop.{h,c}`, `src/console.{h,c}` |
| Apps: Terminal (52 commands), Editor, Files, Calculator, Monitor, Settings, Snake | `src/shell.{h,c}`, `src/calc.{h,c}`, `src/settings.{h,c}`, `src/snake.{h,c}` |
| Assistant: intent table (files, machine, settings, apps) + learns your phrasing to disk | `src/wm.c`, `include/assist_match.h`, `src/learn.{h,c}` |
| On-device transformer runtime: loads a weight file from a boot module, runs the forward pass in-kernel | `src/model_rt.c`, `src/model_load.c`, `src/model.c`, `src/tok.c`, `include/model*.h` |
| PCI scan, e1000 driver, ARP, DHCP, ICMP ping, DNS (Terminal `net`) | `src/pci.{h,c}`, `src/e1000.{h,c}`, `src/mmio.{h,c}`, `include/net_*.h` |

Two things to be straight about:

- **The released ISO has no brain module in it.** The model runtime is real and
  was verified running an in-kernel forward pass (M7, 2026-07-25), but the weight
  file arrives as a separate multiboot2 module (`make iso-grub MODEL=... TOK=...`)
  and the release ISO is built without one. The Assistant says "no brain loaded"
  if you ask it to generate text; everything else it does is live.
- **The Assistant has no path to the network.** The network code exists for the
  Terminal's `net` command and the wire-level test; nothing routes the Assistant
  or the model runtime to it.

Still true: never booted on real hardware (emulator only), no USB, no SMP, ATA
PIO only, cannot be installed to a disk. The legacy UEFI/gnu-efi path
(`boot/boot.c`, `make iso`) is parked on OVMF firmware bugs (lesson #194) and is
not what ships.

## Run it

Download `astrion.iso` from the
[latest release](https://github.com/viraajbindra-a11y/Astrion-OS/releases/latest)
(tag `os-v0.3` or newer) and:

```bash
qemu-system-x86_64 -cdrom astrion.iso -m 512
```

With a persistent disk and the serial log on your terminal:

```bash
qemu-img create -f raw astrion.disk 64M
qemu-system-x86_64 -cdrom astrion.iso -drive file=astrion.disk,format=raw,if=ide -m 512 -serial stdio
```

`docs/try-astrion.md` covers VirtualBox and UTM too. In the shell, try `help`,
`ls`, `write hi.sh echo hello`, `run hi.sh`, `sync` (then reboot — files
persist), `exec rogue.elf` (a hostile program the CPU kills), `isotest`, `ps`,
`net arp`, `snake`.

## Build and test (macOS or Linux)

```bash
cd kernel
make test                                              # host unit tests + header gates
make CC=x86_64-elf-gcc LD=x86_64-elf-ld kernel-mb2     # the kernel (cross toolchain on macOS)
make run-grub                                          # build an ISO and boot it in QEMU
make ui-test                                           # build the ISO and run all 14 UI tests against it
```

`make run-grub MODEL=build/oracle.bin TOK=build/qwen.atk` boots with a brain
module; see the Makefile for how the module reaches the kernel. CI
(`.github/workflows/build-kernel.yml`, `ui-suite.yml`) runs the same targets on
every push to `kernel/**`, and `release-os.yml` publishes the ISO on an `os-v*`
tag only if the whole UI suite passes.

## Why two OVMFs? (UEFI path, parked)

| Firmware | Source | Behavior |
|---|---|---|
| `/opt/homebrew/share/qemu/edk2-x86_64-code.fd` | Homebrew QEMU 11.0 (Linaro 2024 build) | **#GP in `BootScriptExecutorDxe`** when calling `LocateHandleBuffer(SimpleFileSystem)`. Not our bug. |
| `firmware/RELEASEX64_OVMF.fd` | [retrage/edk2-nightly](https://retrage.github.io/edk2-nightly/) (upstream EDK2 nightly) | No firmware crash. Lets us debug actual bootloader bugs. |

`scripts/get-ovmf.sh` downloads the upstream OVMF on demand; `make run-retrage`
runs the UEFI path with it. Real Surface Pro 6 hardware uses Microsoft's UEFI
build, which is yet another EDK2 variant — `docs/hardware-testing.md` is the
verify path when that day comes.
