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
EFI_LDFLAGS = -nostdlib -shared -Bsymbolic -T /usr/lib/elf_x86_64_efi.lds \
              /usr/lib/crt0-efi-x86_64.o -lefi -lgnuefi

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
	$(LD) $(EFI_LDFLAGS) $(BUILD_DIR)/boot.o -o $(BUILD_DIR)/boot.so
	$(OBJCOPY) -j .text -j .sdata -j .data -j .dynamic -j .dynsym \
	           -j .rel -j .rela -j .reloc --target=efi-app-x86_64 \
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

# Run in QEMU for testing
run: iso
	qemu-system-x86_64 \
	    -bios /usr/share/ovmf/OVMF.fd \
	    -cdrom $(BUILD_DIR)/nova-os.iso \
	    -m 256M \
	    -serial stdio \
	    -vga virtio

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
