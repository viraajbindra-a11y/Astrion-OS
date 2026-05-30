/*
 * Astrion v2.0 — Multiboot2 kernel linker script
 *
 * Layout requirements:
 *   - GRUB loads us at 1 MiB (0x100000).
 *   - The multiboot2 header MUST be in the first 32 KiB of the binary,
 *     8-byte aligned, with magic 0xe85250d6. Place .multiboot_header
 *     at the very start.
 *   - Entry point is _start (defined in boot/multiboot2.S).
 *
 * Sections beyond the header use the same conventions as the gnu-efi
 * boot path so the eventual merge is mechanical.
 */

ENTRY(_start)

SECTIONS {
    . = 0x100000;

    .boot : {
        KEEP(*(.multiboot_header))
    }

    .text : ALIGN(4K) {
        *(.text*)
    }

    .rodata : ALIGN(4K) {
        *(.rodata*)
    }

    .data : ALIGN(4K) {
        *(.data*)
    }

    .bss : ALIGN(4K) {
        *(COMMON)
        *(.bss*)
    }
}
