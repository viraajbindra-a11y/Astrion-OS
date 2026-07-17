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
# SSE), and emit it. The same recipe builds hello.elf and rogue.elf — both
# are ring-3 ELF64 PIEs the kernel loads + relocates into the user window.
define PROG_RULE
$(BUILD_DIR)/$(1).elf: progs/$(1).c include/astrion_abi.h
	@mkdir -p $(BUILD_DIR)
	$$(CC) $$(PROG_CFLAGS) -c progs/$(1).c -o $(BUILD_DIR)/$(1).o
	$$(LD) $$(PROG_LDFLAGS) -o $$@ $(BUILD_DIR)/$(1).o
	@echo "=== user prog gate ($(1)): must be PIE (ET_DYN) ==="
	readelf -h $$@ | grep -q 'DYN' || { echo "FAIL: $(1).elf is not a PIE"; exit 1; }
	@echo "=== user prog gate ($(1)): only RELATIVE/NONE relocations ==="
	@! { readelf -r $$@ 2>/dev/null | grep -E 'R_X86_64_' | grep -Ev 'R_X86_64_(RELATIVE|NONE)'; } \
	    || { echo "FAIL: $(1).elf has a non-RELATIVE reloc (symbol/GOT/PLT)"; exit 1; }
	@echo "=== user prog gate ($(1)): no SSE instructions ==="
	@! objdump -d $$@ | grep -Eiq 'xmm|movaps|movups' \
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

kernel-mb2: src/hello_elf.h src/rogue_elf.h src/iodemo_elf.h
	@mkdir -p $(BUILD_DIR)
	$(CC) $(MB2_CFLAGS) -c boot/multiboot2.S -o $(BUILD_DIR)/multiboot2.o
	$(CC) $(MB2_CFLAGS) -c src/isr.S -o $(BUILD_DIR)/isr.o
	$(CC) $(MB2_CFLAGS) -c src/idt.c -o $(BUILD_DIR)/idt.o
	$(CC) $(MB2_CFLAGS) -c src/kbd.c -o $(BUILD_DIR)/kbd.o
	$(CC) $(MB2_CFLAGS) -c src/pit.c -o $(BUILD_DIR)/pit.o
	$(CC) $(MB2_CFLAGS) -c src/rtc.c -o $(BUILD_DIR)/rtc.o
	$(CC) $(MB2_CFLAGS) -c src/acpi.c -o $(BUILD_DIR)/acpi.o
	$(CC) $(MB2_CFLAGS) -c src/power.c -o $(BUILD_DIR)/power.o
	$(CC) $(MB2_CFLAGS) -c src/console.c -o $(BUILD_DIR)/console.o
	$(CC) $(MB2_CFLAGS) -c src/clipboard.c -o $(BUILD_DIR)/clipboard.o
	$(CC) $(MB2_CFLAGS) -c src/desktop.c -o $(BUILD_DIR)/desktop.o
	$(CC) $(MB2_CFLAGS) -c src/wm.c -o $(BUILD_DIR)/wm.o
	$(CC) $(MB2_CFLAGS) -c src/af.c -o $(BUILD_DIR)/af.o
	$(CC) $(GPT_CFLAGS) -c src/gpt.c -o $(BUILD_DIR)/gpt.o
	$(CC) $(MB2_CFLAGS) -c src/shell.c -o $(BUILD_DIR)/shell.o
	$(CC) $(MB2_CFLAGS) -c src/mouse.c -o $(BUILD_DIR)/mouse.o
	$(CC) $(MB2_CFLAGS) -c src/snake.c -o $(BUILD_DIR)/snake.o
	$(CC) $(MB2_CFLAGS) -c src/heap.c -o $(BUILD_DIR)/heap.o
	$(CC) $(MB2_CFLAGS) -c src/fs.c -o $(BUILD_DIR)/fs.o
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
	    $(BUILD_DIR)/console.o \
	    $(BUILD_DIR)/clipboard.o \
	    $(BUILD_DIR)/desktop.o \
	    $(BUILD_DIR)/wm.o \
	    $(BUILD_DIR)/af.o \
	    $(BUILD_DIR)/gpt.o \
	    $(BUILD_DIR)/shell.o \
	    $(BUILD_DIR)/mouse.o \
	    $(BUILD_DIR)/snake.o \
	    $(BUILD_DIR)/heap.o \
	    $(BUILD_DIR)/fs.o \
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
	# Verify the multiboot2 header is present + first in the binary.
	grub-file --is-x86-multiboot2 $(BUILD_DIR)/kernel_mb2.elf
	@echo "Multiboot2 kernel built: $(BUILD_DIR)/kernel_mb2.elf"

iso-grub: kernel-mb2
	@mkdir -p $(BUILD_DIR)/iso-grub/boot/grub
	cp $(BUILD_DIR)/kernel_mb2.elf $(BUILD_DIR)/iso-grub/boot/kernel_mb2.elf
	@echo 'set timeout=0'                                > $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo 'set default=0'                               >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo 'menuentry "Astrion v2.0 (multiboot2)" {'     >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo '  multiboot2 /boot/kernel_mb2.elf'           >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo '  boot'                                      >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	@echo '}'                                           >> $(BUILD_DIR)/iso-grub/boot/grub/grub.cfg
	grub-mkrescue -o $(BUILD_DIR)/astrion-grub.iso $(BUILD_DIR)/iso-grub
	@echo "GRUB ISO: $(BUILD_DIR)/astrion-grub.iso"

run-grub: iso-grub
	qemu-system-x86_64 \
	    -cdrom $(BUILD_DIR)/astrion-grub.iso \
	    -m 256M \
	    -serial stdio \
	    -display none \
	    -no-reboot

clean:
	rm -rf $(BUILD_DIR)
	rm -f $(KERNEL_OBJS)
	rm -f boot/*.o
