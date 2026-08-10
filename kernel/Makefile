# NOVA OS Kernel — Build System
#
# Prerequisites:
#   - gcc (cross-compiler for x86_64-elf recommended)
#   - gnu-efi (for UEFI bootloader)
#   - xorriso, mtools (for ISO creation)
#
# Targets:
#   make kernel   - Build the kernel binary
#   make boot     - Build the UEFI bootloader
#   make iso      - Build bootable ISO
#   make clean    - Clean build artifacts
#   make run      - Run in QEMU (for testing)

CC = gcc
LD = ld
OBJCOPY = objcopy

# Gate tooling. Prefer the cross binutils when present — they're the correct
# tools for cross-ELF, and they're what a macOS dev box has (homebrew
# x86_64-elf-binutils) — else fall back to the plain names, which is what CI
# uses on Linux. Resolved to a path so the gates can tell "tool missing" from
# "check failed".
#
# Why that distinction matters: the reloc and SSE gates below are written as
# `! { tool ... | grep ... }`. With the tool ABSENT the pipeline emits nothing,
# grep matches nothing, and the `!` flips that into SUCCESS — so both gates
# passed VACUOUSLY on any machine without binutils, silently, while claiming to
# guard the triple-fault class. (The PIE gate had the inverse bug: it reported
# "is not a PIE" when the truth was "I couldn't tell.") A check that cannot run
# must say so, never return a verdict.
READELF := $(shell command -v x86_64-elf-readelf 2>/dev/null || command -v readelf 2>/dev/null)
OBJDUMP := $(shell command -v x86_64-elf-objdump 2>/dev/null || command -v objdump 2>/dev/null)

# Kernel flags — freestanding (no OS, no libc)
CFLAGS = -ffreestanding -fno-stack-protector -fno-pic -mno-red-zone \
         -Wall -Wextra -O2 -I include -I gui -I drivers
LDFLAGS = -nostdlib -T src/linker.ld

# EFI flags
EFI_CFLAGS = -I/usr/include/efi -I/usr/include/efi/x86_64 \
             -fpic -ffreestanding -fno-stack-protector -fshort-wchar \
             -mno-red-zone -DEFI_FUNCTION_WRAPPER

# Detect gnu-efi lib dir. Ubuntu 22+ uses /usr/lib/x86_64-linux-gnu
# (Debian multi-arch); older systems used /usr/lib directly. 2026-04-04
# CI build failed here — the paths were hardcoded to /usr/lib and the
# linker couldn't find -lefi / -lgnuefi.
EFI_LIB_DIR := $(shell if [ -f /usr/lib/x86_64-linux-gnu/elf_x86_64_efi.lds ]; \
                       then echo /usr/lib/x86_64-linux-gnu; \
                       else echo /usr/lib; fi)
EFI_LDFLAGS = -nostdlib -znocombreloc -shared -Bsymbolic \
              -T $(EFI_LIB_DIR)/elf_x86_64_efi.lds \
              -L $(EFI_LIB_DIR) \
              $(EFI_LIB_DIR)/crt0-efi-x86_64.o

# Source files
KERNEL_SRCS = src/kernel.c gui/framebuffer.c drivers/keyboard.c drivers/mouse.c
KERNEL_OBJS = $(KERNEL_SRCS:.c=.o)

BUILD_DIR = build
ISO_DIR = $(BUILD_DIR)/iso

.PHONY: all kernel boot iso clean run run-retrage kernel-mb2 iso-grub run-grub

all: iso

# Build kernel
%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

kernel: $(KERNEL_OBJS)
	@mkdir -p $(BUILD_DIR)
	$(LD) $(LDFLAGS) -o $(BUILD_DIR)/kernel.bin $(KERNEL_OBJS)
	@echo "Kernel built: $(BUILD_DIR)/kernel.bin"

# Build UEFI bootloader
boot:
	@mkdir -p $(BUILD_DIR)
	$(CC) $(EFI_CFLAGS) -c boot/boot.c -o $(BUILD_DIR)/boot.o
	$(LD) $(EFI_LDFLAGS) $(BUILD_DIR)/boot.o -o $(BUILD_DIR)/boot.so -lefi -lgnuefi
	# .rodata is required for string literals + const data; without it
	# the loaded EFI binary has dangling pointers and crashes with #UD
	# at runtime (2026-05-25 QEMU test caught this). .eh_frame is a
	# safety belt — not always present but harmless if absent.
	$(OBJCOPY) -j .text -j .sdata -j .data -j .rodata -j .dynamic \
	           -j .dynsym -j .rel -j .rela -j .reloc -j .eh_frame \
	           --target=efi-app-x86_64 \
	           $(BUILD_DIR)/boot.so $(BUILD_DIR)/BOOTX64.EFI
	@echo "Bootloader built: $(BUILD_DIR)/BOOTX64.EFI"

# Create bootable ISO
iso: kernel boot
	@mkdir -p $(ISO_DIR)/EFI/BOOT
	@mkdir -p $(ISO_DIR)/nova
	cp $(BUILD_DIR)/BOOTX64.EFI $(ISO_DIR)/EFI/BOOT/
	cp $(BUILD_DIR)/kernel.bin $(ISO_DIR)/nova/
	# Create FAT image for UEFI
	dd if=/dev/zero of=$(BUILD_DIR)/fat.img bs=1M count=64
	mkfs.vfat $(BUILD_DIR)/fat.img
	mmd -i $(BUILD_DIR)/fat.img ::/EFI ::/EFI/BOOT ::/nova
	mcopy -i $(BUILD_DIR)/fat.img $(BUILD_DIR)/BOOTX64.EFI ::/EFI/BOOT/
	mcopy -i $(BUILD_DIR)/fat.img $(BUILD_DIR)/kernel.bin ::/nova/
	# Build ISO
	xorriso -as mkisofs \
	    -o $(BUILD_DIR)/nova-os.iso \
	    -e fat.img \
	    -no-emul-boot \
	    $(BUILD_DIR)/
	@echo ""
	@echo "==================================="
	@echo "  NOVA OS ISO: $(BUILD_DIR)/nova-os.iso"
	@echo "==================================="

# Run in QEMU for testing (Linux — /usr/share/ovmf is Debian/Ubuntu's path)
run: iso
	qemu-system-x86_64 \
	    -bios /usr/share/ovmf/OVMF.fd \
	    -cdrom $(BUILD_DIR)/nova-os.iso \
	    -m 256M \
	    -serial stdio \
	    -vga virtio

# Run in QEMU using retrage's upstream EDK2 nightly OVMF.
# Background (2026-05-26): Homebrew QEMU 11.0's bundled OVMF (Linaro 2024 build)
# hits a #GP in BootScriptExecutorDxe when our bootloader calls
# LocateHandleBuffer. The retrage nightly does not have that bug. Use this
# target on macOS to test the kernel locally.
run-retrage: iso
	./scripts/get-ovmf.sh
	qemu-system-x86_64 \
	    -bios firmware/RELEASEX64_OVMF.fd \
	    -cdrom $(BUILD_DIR)/nova-os.iso \
	    -m 256M \
	    -serial stdio \
	    -display none \
	    -no-reboot

# Run kernel directly (faster, for development)
run-kernel: kernel
	qemu-system-x86_64 \
	    -kernel $(BUILD_DIR)/kernel.bin \
	    -m 256M \
	    -serial stdio

# ─── Multiboot2 + GRUB path (v2.0 alt boot, 2026-05-26) ─────────────
# Bypasses UEFI/OVMF entirely. GRUB reads our multiboot2 header, loads
# the kernel at 1 MiB, hands off in 32-bit protected mode. Our asm stub
# in boot/multiboot2.S sets up long mode + calls kernel_mb2_main.
#
# Doesn't depend on gnu-efi. Doesn't go through DxeCore. Works on any
# x86_64 machine with a BIOS or UEFI CSM (or with UEFI when grub-efi
# is used, which is a separate target we'll add when needed).

MB2_CFLAGS = -ffreestanding -fno-stack-protector -fno-pic -mno-red-zone \
             -Wall -Wextra -O2 -mcmodel=kernel -m64 \
             -mno-mmx -mno-sse -mno-sse2 -mno-3dnow \
             -mgeneral-regs-only -I include
# 2026-05-31: -mno-sse + -mgeneral-regs-only stop gcc from emitting SSE
# instructions for struct copies + memset. We never enable SSE in CR0/CR4,
# so any SSE instruction would triple-fault silently. Caught when the
# basic-meminfo tag case stopped producing serial output mid-parse —
# gcc had inlined a struct-field write as an SSE move.
# -I include: shared astrion_abi.h (user-program ABI) lives in include/.
MB2_LDFLAGS = -nostdlib -T src/linker_mb2.ld -z max-page-size=4096
# The GPT (src/gpt.c) is the ONLY file that uses floating point. The rest of
# the kernel is -mno-sse; here we allow hardware SSE/SSE2 (enabled at boot via
# CR0/CR4) so inference uses fast hardware float instead of soft-float, and so
# gcc can pass/return floats at all (x86-64 float ABI needs XMM). -mstackrealign
# guards against a movaps on a not-16-aligned stack.
GPT_CFLAGS = -ffreestanding -fno-stack-protector -fno-pic -mno-red-zone \
             -Wall -Wextra -O2 -mcmodel=kernel -m64 \
             -msse -msse2 -mstackrealign -I include
LIBGCC = $(shell $(CC) -print-libgcc-file-name)

# ─── User-program build (the sample ELF that `exec` loads) ──────────
# A freestanding ELF64 PIE: mirrors the kernel's no-SSE / no-red-zone
# flags (a stray SSE op triple-faults — lesson #196) but adds -fPIE so
# the loader can place it at any base and fix it with R_X86_64_RELATIVE
# relocs. NO -mcmodel=kernel (that's for the high-half kernel; user code
# uses the default small/PIC model). -fcf-protection=none drops endbr64.
PROG_CFLAGS = -ffreestanding -fno-stack-protector -fPIE -mno-red-zone \
              -Wall -Wextra -O2 -m64 \
              -mno-mmx -mno-sse -mno-sse2 -mno-3dnow -mgeneral-regs-only \
              -fno-asynchronous-unwind-tables -fcf-protection=none \
              -nostdlib -I include
# Default ld -pie layout (no custom script): ld emits the dynamic
# machinery (.dynamic/.gnu.hash/.rela.dyn) itself and separates RX/RW
# segments. A custom script that DISCARDed .hash made ld fail with
# "could not find section .hash". --no-dynamic-linker drops .interp;
# we relocate the image ourselves so no real dynamic linking happens.
PROG_LDFLAGS = -nostdlib -pie -e _start -z max-page-size=0x1000 \
               -z noexecstack --no-dynamic-linker

# Build a user program ($1=name), gate it (PIE, RELATIVE-only relocs, no
# SSE), and emit it. The same recipe builds every one of them — hello, rogue,
# iodemo and the poke/peek isolation pair are all ring-3 ELF64 PIEs the kernel
# loads + relocates into the user window.
define PROG_RULE
$(BUILD_DIR)/$(1).elf: progs/$(1).c include/astrion_abi.h
	@mkdir -p $(BUILD_DIR)
	$$(CC) $$(PROG_CFLAGS) -c progs/$(1).c -o $(BUILD_DIR)/$(1).o
	$$(LD) $$(PROG_LDFLAGS) -o $$@ $(BUILD_DIR)/$(1).o
	@[ -n "$$(READELF)" ] || { echo "FAIL: gate cannot run - no readelf found (tried x86_64-elf-readelf, readelf)"; exit 1; }
	@[ -n "$$(OBJDUMP)" ] || { echo "FAIL: gate cannot run - no objdump found (tried x86_64-elf-objdump, objdump)"; exit 1; }
	@echo "=== user prog gate ($(1)): must be PIE (ET_DYN) ==="
	@$$(READELF) -h $$@ | grep -q 'DYN' || { echo "FAIL: $(1).elf is not a PIE"; exit 1; }
	@echo "=== user prog gate ($(1)): only RELATIVE/NONE relocations ==="
	@! { $$(READELF) -r $$@ 2>/dev/null | grep -E 'R_X86_64_' | grep -Ev 'R_X86_64_(RELATIVE|NONE)'; } \
	    || { echo "FAIL: $(1).elf has a non-RELATIVE reloc (symbol/GOT/PLT)"; exit 1; }
	@echo "=== user prog gate ($(1)): no SSE instructions ==="
	@! $$(OBJDUMP) -d $$@ | grep -Eiq 'xmm|movaps|movups' \
	    || { echo "FAIL: $(1).elf contains SSE"; exit 1; }
	@echo "user prog OK: $$@"

src/$(1)_elf.h: $(BUILD_DIR)/$(1).elf
	xxd -i -n $(1)_elf $(BUILD_DIR)/$(1).elf > src/$(1)_elf.h
	# Make the embedded array + length const so they land in .rodata.
	sed -i.bak 's/^unsigned /static const unsigned /' src/$(1)_elf.h && rm -f src/$(1)_elf.h.bak
	@echo "generated src/$(1)_elf.h"
endef

$(eval $(call PROG_RULE,hello))
$(eval $(call PROG_RULE,rogue))
$(eval $(call PROG_RULE,iodemo))
# poke + peek are a PAIR: they hardcode the same user virtual address and the
# demo is that one writes it and the other cannot see it. Never build one
# without the other, and if you change SCRATCH_VA change it in both.
$(eval $(call PROG_RULE,poke))
$(eval $(call PROG_RULE,peek))

kernel-mb2: src/hello_elf.h src/rogue_elf.h src/iodemo_elf.h \
            src/poke_elf.h src/peek_elf.h
	@mkdir -p $(BUILD_DIR)
	$(CC) $(MB2_CFLAGS) -c boot/multiboot2.S -o $(BUILD_DIR)/multiboot2.o
	$(CC) $(MB2_CFLAGS) -c src/isr.S -o $(BUILD_DIR)/isr.o
	$(CC) $(MB2_CFLAGS) -c src/idt.c -o $(BUILD_DIR)/idt.o
	$(CC) $(MB2_CFLAGS) -c src/kbd.c -o $(BUILD_DIR)/kbd.o
	$(CC) $(MB2_CFLAGS) -c src/pit.c -o $(BUILD_DIR)/pit.o
	$(CC) $(MB2_CFLAGS) -c src/rtc.c -o $(BUILD_DIR)/rtc.o
	$(CC) $(MB2_CFLAGS) -c src/acpi.c -o $(BUILD_DIR)/acpi.o
	$(CC) $(MB2_CFLAGS) -c src/power.c -o $(BUILD_DIR)/power.o
	$(CC) $(MB2_CFLAGS) -c src/serial.c -o $(BUILD_DIR)/serial.o
	$(CC) $(MB2_CFLAGS) -c src/console.c -o $(BUILD_DIR)/console.o
	$(CC) $(MB2_CFLAGS) -c src/clipboard.c -o $(BUILD_DIR)/clipboard.o
	$(CC) $(MB2_CFLAGS) -c src/settings.c -o $(BUILD_DIR)/settings.o
	$(CC) $(MB2_CFLAGS) -c src/desktop.c -o $(BUILD_DIR)/desktop.o
	$(CC) $(MB2_CFLAGS) -c src/calc.c -o $(BUILD_DIR)/calc.o
	$(CC) $(MB2_CFLAGS) -c src/wm.c -o $(BUILD_DIR)/wm.o
	$(CC) $(MB2_CFLAGS) -c src/af.c -o $(BUILD_DIR)/af.o
	$(CC) $(GPT_CFLAGS) -c src/gpt.c -o $(BUILD_DIR)/gpt.o
	$(CC) $(MB2_CFLAGS) -c src/model.c -o $(BUILD_DIR)/model.o
	$(CC) $(MB2_CFLAGS) -c src/model_load.c -o $(BUILD_DIR)/model_load.o
	$(CC) $(MB2_CFLAGS) -c src/model_rt.c -o $(BUILD_DIR)/model_rt.o
	$(CC) $(MB2_CFLAGS) -c src/tok.c -o $(BUILD_DIR)/tok.o
	$(CC) $(MB2_CFLAGS) -c src/shell.c -o $(BUILD_DIR)/shell.o
	$(CC) $(MB2_CFLAGS) -c src/mouse.c -o $(BUILD_DIR)/mouse.o
	$(CC) $(MB2_CFLAGS) -c src/snake.c -o $(BUILD_DIR)/snake.o
	$(CC) $(MB2_CFLAGS) -c src/heap.c -o $(BUILD_DIR)/heap.o
	$(CC) $(MB2_CFLAGS) -c src/pmm.c -o $(BUILD_DIR)/pmm.o
	$(CC) $(MB2_CFLAGS) -c src/vmspace.c -o $(BUILD_DIR)/vmspace.o
	$(CC) $(MB2_CFLAGS) -c src/fs.c -o $(BUILD_DIR)/fs.o
	$(CC) $(MB2_CFLAGS) -c src/learn.c -o $(BUILD_DIR)/learn.o
	$(CC) $(MB2_CFLAGS) -c src/ata.c -o $(BUILD_DIR)/ata.o
	$(CC) $(MB2_CFLAGS) -c src/context_switch.S -o $(BUILD_DIR)/context_switch.o
	$(CC) $(MB2_CFLAGS) -c src/task.c -o $(BUILD_DIR)/task.o
	$(CC) $(MB2_CFLAGS) -c src/elf.c -o $(BUILD_DIR)/elf.o
	$(CC) $(MB2_CFLAGS) -c src/gdt.c -o $(BUILD_DIR)/gdt.o
	$(CC) $(MB2_CFLAGS) -c src/usermem.c -o $(BUILD_DIR)/usermem.o
	$(CC) $(MB2_CFLAGS) -c src/syscall.c -o $(BUILD_DIR)/syscall.o
	$(CC) $(MB2_CFLAGS) -c src/usermode.S -o $(BUILD_DIR)/usermode.o
	$(CC) $(MB2_CFLAGS) -c src/kernel_mb2.c -o $(BUILD_DIR)/kernel_mb2.o
	$(LD) $(MB2_LDFLAGS) -o $(BUILD_DIR)/kernel_mb2.elf \
	    $(BUILD_DIR)/multiboot2.o \
	    $(BUILD_DIR)/isr.o \
	    $(BUILD_DIR)/idt.o \
	    $(BUILD_DIR)/kbd.o \
	    $(BUILD_DIR)/pit.o \
	    $(BUILD_DIR)/rtc.o \
	    $(BUILD_DIR)/acpi.o \
	    $(BUILD_DIR)/power.o \
	    $(BUILD_DIR)/serial.o \
	    $(BUILD_DIR)/console.o \
	    $(BUILD_DIR)/clipboard.o \
	    $(BUILD_DIR)/settings.o \
	    $(BUILD_DIR)/desktop.o \
	    $(BUILD_DIR)/calc.o \
	    $(BUILD_DIR)/wm.o \
	    $(BUILD_DIR)/af.o \
	    $(BUILD_DIR)/gpt.o \
	    $(BUILD_DIR)/model.o \
	    $(BUILD_DIR)/model_load.o \
	    $(BUILD_DIR)/model_rt.o \
	    $(BUILD_DIR)/tok.o \
	    $(BUILD_DIR)/shell.o \
	    $(BUILD_DIR)/mouse.o \
	    $(BUILD_DIR)/snake.o \
	    $(BUILD_DIR)/heap.o \
	    $(BUILD_DIR)/pmm.o \
	    $(BUILD_DIR)/vmspace.o \
	    $(BUILD_DIR)/fs.o \
	    $(BUILD_DIR)/learn.o \
	    $(BUILD_DIR)/ata.o \
	    $(BUILD_DIR)/context_switch.o \
	    $(BUILD_DIR)/task.o \
	    $(BUILD_DIR)/elf.o \
	    $(BUILD_DIR)/gdt.o \
	    $(BUILD_DIR)/usermem.o \
	    $(BUILD_DIR)/syscall.o \
	    $(BUILD_DIR)/usermode.o \
	    $(BUILD_DIR)/kernel_mb2.o \
	    $(LIBGCC)
	@echo "=== ELF section layout ==="
	objdump -h $(BUILD_DIR)/kernel_mb2.elf | head -40
	@echo "=== ELF program headers ==="
	readelf -l $(BUILD_DIR)/kernel_mb2.elf | head -30
	@echo "=== multiboot2 magic search (file offset of bytes d6 50 52 e8) ==="
	@grep -obUaP "\xd6\x50\x52\xe8" $(BUILD_DIR)/kernel_mb2.elf | head -3 || echo "magic NOT FOUND"
	# Verify the multiboot2 header. If it is wrong GRUB refuses the kernel and a
	# real machine gives you a blank screen and no explanation, so this is one
	# of the highest-stakes 16 bytes in the project.
	#
	# It used to be gated on grub-file, which ships with GRUB and therefore does
	# not exist on a macOS dev box — the build said so honestly and carried on,
	# which meant the check ran nowhere a developer would see it fail. The header
	# is a documented byte layout, so tools/mb2check.py validates it against the
	# spec with no GRUB involved: magic, architecture, checksum, the 32 KiB
	# search window, 8-byte alignment, and the tag chain down to its end tag.
	# `mb2check.py --selftest` corrupts each of those in turn and requires a
	# rejection, so this is a gate that has been watched to fail.
	@python3 tools/mb2check.py $(BUILD_DIR)/kernel_mb2.elf
	# grub-file too when it exists — an independent implementation disagreeing
	# with ours is worth knowing about, and CI has it.
	@if command -v grub-file >/dev/null 2>&1; then \
	    grub-file --is-x86-multiboot2 $(BUILD_DIR)/kernel_mb2.elf \
	        && echo "  grub-file agrees: valid multiboot2 kernel"; \
	fi
	@echo "Multiboot2 kernel built: $(BUILD_DIR)/kernel_mb2.elf"

# A file to hand the kernel at boot via multiboot2 `module2`. This is the path
# the language model will arrive on: GRUB reads it at 20-50 MB/s before the
# kernel starts, versus ata.c's ~3 MB/s PIO, and it needs no disk driver to
# exist. Set MODEL=<path> to include one; unset, the ISO is built exactly as
# before so nothing here changes the normal build.
#   make iso-grub MODEL=weights/qwen-0.6b-q4.bin
# TOK=<path> is the same, for the BPE tokenizer module (ATK1). The kernel finds
# each module by its MAGIC, so the order and names below don't matter:
#   make run-grub MODEL=build/oracle.bin TOK=build/qwen.atk
MODEL ?=
MODEL_NAME := $(notdir $(MODEL))
TOK ?=
TOK_NAME := $(notdir $(TOK))

iso-grub: kernel-mb2
	@mkdir -p $(BUILD_DIR)/iso-grub/boot/grub
	cp $(BUILD_DIR)/kernel_mb2.elf $(BUILD_DIR)/iso-grub/boot/kernel_mb2.elf
	@if [ -n "$(MODEL)" ]; then \
	    [ -f "$(MODEL)" ] || { echo "FAIL: MODEL=$(MODEL) does not exist"; exit 1; }; \
	    cp "$(MODEL)" $(BUILD_DIR)/iso-grub/boot/$(MODEL_NAME); \
	    echo "module: $(MODEL_NAME) ($$(wc -c < "$(MODEL)") bytes)"; \
	fi
	@if [ -n "$(TOK)" ]; then \
	    [ -f "$(TOK)" ] || { echo "FAIL: TOK=$(TOK) does not exist"; exit 1; }; \
	    cp "$(TOK)" $(BUILD_DIR)/iso-grub/boot/$(TOK_NAME); \
	    echo "module: $(TOK_NAME) ($$(wc -c < "$(TOK)") bytes)"; \
	fi
	@echo 'set timeout=0'                                > $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo 'set default=0'                               >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo 'menuentry "Astrion v2.0 (multiboot2)" {'     >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo '  multiboot2 /boot/kernel_mb2.elf'           >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@if [ -n "$(MODEL)" ]; then \
	    echo "  module2 /boot/$(MODEL_NAME) $(MODEL_NAME)" >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg; \
	fi
	@if [ -n "$(TOK)" ]; then \
	    echo "  module2 /boot/$(TOK_NAME) $(TOK_NAME)" >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg; \
	fi
	@echo '  boot'                                      >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo '}'                                           >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	grub-mkrescue -o $(BUILD_DIR)/astrion-grub.iso $(BUILD_DIR)/iso-grub
	@echo "GRUB ISO: $(BUILD_DIR)/astrion-grub.iso"

# RAM and CPU model are variables so a run can override them:
#   make run-grub MEM=256M          - the old small config
#   make run-grub CPU=qemu64        - force the 2 MiB / 4 GiB fallback path
MEM ?= 12G
CPU ?= max

# -cpu max is not optional at this size. The boot code picks its page mapping
# from CPUID: with PDPE1GB it maps 512 GiB using 1 GiB pages, without it falls
# back to 4 GiB. QEMU's DEFAULT cpu model does not expose PDPE1GB, so plain
# `-m 12G` would boot fine and leave 8 of those 12 GiB unaddressable, silently.
# Check the "PAGING:" line in the serial log to see which path a run took.
run-grub: iso-grub
	qemu-system-x86_64 \
	    -cdrom $(BUILD_DIR)/astrion-grub.iso \
	    -cpu $(CPU) \
	    -m $(MEM) \
	    -serial stdio \
	    -display none \
	    -no-reboot

# Same, but with a disk attached, so the filesystem actually persists.
#
# This target exists because it did NOT, and that was a real hole: nothing in
# the build or the test path ever passed -drive, so every run had ata_present()
# false and a RAM-only filesystem. `sync` printed "no disk attached" and no one
# was watching for it. "Your files survive a reboot" was a documented claim that
# the default way of running the OS could not demonstrate.
#
# The image is created once and then left alone — that is the entire point, so
# deliberately NOT a phony that recreates it. Delete it by hand to start clean.
DISK ?= $(BUILD_DIR)/astrion.disk
DISK_MB ?= 64

$(DISK):
	@mkdir -p $(BUILD_DIR)
	@dd if=/dev/zero of=$@ bs=1m count=$(DISK_MB) 2>/dev/null
	@echo "created $@ ($(DISK_MB) MiB) - your files will persist here"

run-disk: iso-grub $(DISK)
	qemu-system-x86_64 \
	    -cdrom $(BUILD_DIR)/astrion-grub.iso \
	    -drive file=$(DISK),format=raw,if=ide \
	    -cpu $(CPU) \
	    -m $(MEM) \
	    -serial stdio \
	    -display none \
	    -no-reboot

.PHONY: run-disk

# ── Host-side unit tests ───────────────────────────────────────────────
# Compiled with the HOST compiler, not the cross one: these run logic that has
# no hardware dependency, so they don't need a kernel or an emulator. Some
# kernel behaviour genuinely cannot be gated in QEMU — the PS/2 delta decode is
# the standing example, since QEMU clamps every mouse packet to +/-127 and so
# never emits the 256 packet shapes where a wrong decode differs from a right
# one. Booting proves nothing there; this does.
HOSTCC ?= cc
HOST_TEST_SRCS := $(wildcard tests/test_*.c)
HOST_TESTS     := $(patsubst tests/%.c,$(BUILD_DIR)/%,$(HOST_TEST_SRCS))
# The tests are ENTIRELY about the logic in these headers, so a header edit
# has to rebuild them. Without this prerequisite `make test` re-ran a stale
# binary and reported a pass for code that no longer existed — the same
# "a gate that cannot fail is not a gate" failure the reloc gates had.
HOST_TEST_HDRS := $(wildcard include/*.h)

# `| $(BUILD_DIR)` is an order-only prerequisite and there was no rule to
# satisfy it, so `make test` on a clean tree died with "No rule to make target
# build/test_assist_match" before running a single case.
$(BUILD_DIR):
	@mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/test_%: tests/test_%.c $(HOST_TEST_HDRS) | $(BUILD_DIR)
	$(HOSTCC) -std=c11 -Wall -Wextra -Werror -Iinclude -o $@ $<

# test_model.c #includes the engine source and the generated oracle fixture,
# neither of which the generic rule above tracks; name them so an edit to the
# forward pass or a regenerated fixture rebuilds the gate instead of re-running
# a stale binary (the "a gate that cannot fail is not a gate" trap).
$(BUILD_DIR)/test_model: src/model.c tools/ref_forward_fixture.h

# test_model_load.c #includes model.c + model_load.c and, at RUN time, shells out
# to tools/mkweights.py to produce the blob it round-trips. Name all three so an
# edit to the loader, the converter or the fixture rebuilds the gate rather than
# re-running a stale binary (the "a gate that cannot fail is not a gate" trap).
$(BUILD_DIR)/test_model_load: src/model.c src/model_load.c tools/ref_forward_fixture.h tools/mkweights.py

# test_tok.c #includes the engine source and the generated Qwen reference
# fixture; name them so an edit to tok.c or a regenerated fixture rebuilds the
# gate instead of re-running a stale binary.
$(BUILD_DIR)/test_tok: src/tok.c tools/tok_ref_fixture.h

test: $(HOST_TESTS)
	@[ -n "$(HOST_TEST_SRCS)" ] || { echo "FAIL: no tests found in tests/ - refusing to report a pass"; exit 1; }
	@echo "running $(words $(HOST_TESTS)) host test(s)"
	@for t in $(HOST_TESTS); do echo "--- $$t"; ./$$t || exit 1; done
	@echo "--- tools/mb2check.py --selftest"
	@python3 tools/mb2check.py --selftest
	# Nothing the console prints may contain non-ASCII. putchar_nolock maps
	# anything outside 32..126 to '?', and a UTF-8 em dash is THREE bytes — so
	# one "—" in the boot banner rendered as "???" on screen. Source that looks
	# right and output that looks broken, which review does not catch and a
	# screenshot does. This is the cheap permanent version of that screenshot.
	@echo "--- console strings are ASCII-only"
	@python3 -c "import pathlib,sys; \
bad=[(f.name,n,l.strip()[:70]) for f in pathlib.Path('src').glob('*.c') \
for n,l in enumerate(f.read_text().splitlines(),1) \
if ('console_puts(' in l or 'assist_say(' in l) and any(ord(c)>126 for c in l)]; \
[print('  FAIL %s:%d: %s'%b) for b in bad]; \
print('  ok  all console output is ASCII' if not bad else ''); \
sys.exit(1 if bad else 0)"
	# How much of the way people ACTUALLY ask does the Assistant understand?
	# The corpus was 82.3% the first time it was measured, and nothing in the
	# build enforced that, so nothing stopped it sliding back. The floor is
	# deliberately below today's number: it catches a regression without going
	# red the moment someone adds a phrasing that has not been taught yet,
	# which is exactly what the corpus is meant to be full of. Raise it when a
	# round of work lands; never lower it to make a build pass.
	@echo "--- Assistant intent coverage"
	@$(CC) -std=c11 -Iinclude tools/intent_probe.c -o $(BUILD_DIR)/intent_probe
	@$(BUILD_DIR)/intent_probe --expect tools/intent_corpus.tsv --min 95
	@echo "host tests: all passed"

# The UI suite: boots the real ISO in QEMU, drives real mouse and keyboard over
# QMP, and checks real pixels and real serial output. Separate from `test`
# because these are minutes, not milliseconds — `test` is the fast host-side
# gate you run constantly, this is the one you run before believing a demo.
#
# Deliberately does NOT depend on iso-grub: that target re-invokes the kernel
# build with the default compiler and dies on -mcmodel=kernel, so the ISO is
# assembled here from an already-built ELF. Build the kernel first:
#   make CC=x86_64-elf-gcc LD=x86_64-elf-ld kernel-mb2
# macOS homebrew installs it as i686-elf-grub-mkrescue; Linux (and CI) has it
# under the plain name. Resolved rather than hardcoded so the same target runs
# in both places — the whole point of a suite is that it runs everywhere.
GRUB_MKRESCUE := $(shell command -v i686-elf-grub-mkrescue 2>/dev/null || command -v grub-mkrescue 2>/dev/null)

ui-test: $(BUILD_DIR)/kernel_mb2.elf
	@[ -n "$(GRUB_MKRESCUE)" ] || { \
	    echo "FAIL: no grub-mkrescue (tried i686-elf-grub-mkrescue and grub-mkrescue)"; exit 1; }
	@mkdir -p $(BUILD_DIR)/iso-grub/boot/grub
	@cp $(BUILD_DIR)/kernel_mb2.elf $(BUILD_DIR)/iso-grub/boot/
	@[ -f $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg ] || printf \
	    'set timeout=0\nset default=0\nmenuentry "Astrion v2.0 (multiboot2)" {\n  multiboot2 /boot/kernel_mb2.elf\n  boot\n}\n' \
	    > $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@$(GRUB_MKRESCUE) -o $(BUILD_DIR)/astrion-ui.iso $(BUILD_DIR)/iso-grub >/dev/null 2>&1
	python3 tools/uitest.py $(BUILD_DIR)/astrion-ui.iso $(BUILD_DIR)/uitest

.PHONY: test ui-test

clean:
	rm -rf $(BUILD_DIR)
	rm -f $(KERNEL_OBJS)
	rm -f boot/*.o
