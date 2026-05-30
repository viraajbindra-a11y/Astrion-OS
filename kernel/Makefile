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

.PHONY: all kernel boot iso clean run

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

clean:
	rm -rf $(BUILD_DIR)
	rm -f $(KERNEL_OBJS)
	rm -f boot/*.o
