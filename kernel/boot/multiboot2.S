/*
 * Astrion v2.0 — Multiboot2 entry stub
 *
 * 2026-05-26: alternative to the gnu-efi UEFI bootloader. The UEFI path
 * (boot/boot.c) hit two stacked firmware bugs in OVMF (Homebrew + retrage)
 * that we can't work around at the bootloader level — see lesson #194.
 *
 * This path uses GRUB as the bootloader. GRUB:
 *   - Reads the multiboot2 header below.
 *   - Loads the kernel binary into memory at 1MiB.
 *   - Enters protected mode (32-bit), sets up a basic GDT, jumps to _start
 *     in EAX = multiboot2 magic (0x36d76289), EBX = info struct address.
 *
 * Our job here:
 *   1. Set up a stack.
 *   2. Build minimal page tables (identity-map first 1 GiB via 2MiB pages).
 *   3. Enable PAE + long mode + paging.
 *   4. Load a 64-bit GDT.
 *   5. Far-jump into 64-bit code, then call kernel_mb2_main(magic, info).
 *
 * Anything that needs printing before we're in long mode goes through the
 * COM1 serial port (0x3F8) directly — same approach as boot/boot.c.
 *
 * Read order: this file -> src/kernel_mb2.c (the 64-bit entry).
 */

/* 2026-06-07: section flags MUST be "a", @progbits so the linker
 * marks it ALLOC + LOAD. Without flags, ld treats the section as
 * non-loadable and puts it past the end of all real load segments
 * — landed at file offset 0x8010 once .text + .rodata + .data grew,
 * and grub-file failed the < 32 KiB check. Same gotcha as lesson #196:
 * silent linker behavior, the symptom is in CI not the source. */
.section .multiboot_header, "a", @progbits
.align 8

multiboot_header_start:
    /* Magic, architecture (i386), header length, checksum. */
    .long 0xe85250d6                        /* magic */
    .long 0                                 /* architecture: 0 = i386 */
    .long multiboot_header_end - multiboot_header_start /* header length */
    .long -(0xe85250d6 + 0 + (multiboot_header_end - multiboot_header_start))

    /* Framebuffer request tag (type 5). Asks GRUB for a linear graphical
     * framebuffer instead of text mode. Width/height/depth = 0 means
     * "any reasonable mode" — GRUB picks. With this, GRUB will include
     * a type-8 framebuffer info tag pointing at the actual base address.
     * 8-byte aligned. */
    .align 8
    .word 5                                 /* type: framebuffer request */
    .word 1                                 /* flags: 1 = optional */
    .long 20                                /* size */
    .long 0                                 /* preferred width */
    .long 0                                 /* preferred height */
    .long 0                                 /* preferred depth */

    /* End tag (required). 8-byte aligned. */
    .align 8
    .word 0                                 /* type */
    .word 0                                 /* flags */
    .long 8                                 /* size */
multiboot_header_end:


.section .bss
.align 4096

    /* Page tables.
     * PML4 -> PDPT -> 4x PD (2 MiB huge pages each). 4 PDs cover 4 GiB
     * which is enough to reach the QEMU framebuffer at 0xfd000000.
     * (2026-05-31: prev 1-GiB mapping caused a #PF when paint_test_pattern
     * touched fb addr; extended here.) */
p4_table:
    .skip 4096
p3_table:
    .skip 4096
p2_table_0:                                 /* maps 0x0_0000_0000 .. 0x0_4000_0000 */
    .skip 4096
p2_table_1:                                 /* maps 0x0_4000_0000 .. 0x0_8000_0000 */
    .skip 4096
p2_table_2:                                 /* maps 0x0_8000_0000 .. 0x0_C000_0000 */
    .skip 4096
p2_table_3:                                 /* maps 0x0_C000_0000 .. 0x1_0000_0000 */
    .skip 4096

    /* 16 KiB stack — plenty for early boot. */
stack_bottom:
    .skip 16384
stack_top:


.section .rodata

gdt64:
    .quad 0                                 /* null descriptor */
gdt64_code = . - gdt64
    /* 64-bit code segment: present, ring 0, executable, 64-bit. */
    .quad (1<<43) | (1<<44) | (1<<47) | (1<<53)
gdt64_pointer:
    .word . - gdt64 - 1
    .quad gdt64


.section .text
.code32                                     /* GRUB enters in 32-bit protected mode */
.global _start
.type _start, @function

_start:
    /* Set up our stack. */
    mov $stack_top, %esp

    /* Stash multiboot2 magic + info pointer where 64-bit code can read them.
     * EAX = magic, EBX = info ptr (per multiboot2 spec). */
    mov %eax, mb_magic
    mov %ebx, mb_info_ptr

    /* Sanity-check: multiboot2 magic should be 0x36d76289. If not, halt
     * loudly via serial port "BAD". (No assumptions about output here —
     * we haven't init'd serial properly yet; this is a fallback so we
     * don't silently run garbage.) */
    cmp $0x36d76289, %eax
    jne hang32

    /* Build page tables. Identity-map the first 4 GiB via 4 PDs of
     * 512 x 2 MiB huge pages each. Reaches the QEMU framebuffer
     * at 0xfd000000. */

    /* PML4[0] -> PDPT (present + writable). */
    mov $p3_table, %eax
    or $0b11, %eax
    mov %eax, p4_table

    /* PDPT[0..3] -> the 4 PDs. */
    mov $p2_table_0, %eax
    or $0b11, %eax
    mov %eax, p3_table + 0
    mov $p2_table_1, %eax
    or $0b11, %eax
    mov %eax, p3_table + 8
    mov $p2_table_2, %eax
    or $0b11, %eax
    mov %eax, p3_table + 16
    mov $p2_table_3, %eax
    or $0b11, %eax
    mov %eax, p3_table + 24

    /* PD[i][0..511] -> 2 MiB pages, identity-mapped, present + writable
     * + huge-page flag (bit 7). 4 PDs × 512 entries = 2048 entries
     * covering 4 GiB. ECX = global entry index 0..2047. */
    xor %ecx, %ecx
1:  mov $0x200000, %eax
    mul %ecx                                /* edx:eax = ecx * 2 MiB (phys addr) */
    or $0b10000011, %eax                    /* present + writable + huge */
    /* Lower half of address goes in eax, top byte in dl (= bit 32..39 of phys).
     * For 4 GiB max, edx is 0 or 1 — we write it into the high half of the
     * 8-byte PTE so addresses above 4 GiB would still work later. */
    mov %eax, p2_table_0(, %ecx, 8)         /* low 32 bits */
    mov %edx, p2_table_0 + 4(, %ecx, 8)     /* high 32 bits */
    inc %ecx
    cmp $2048, %ecx
    jne 1b

    /* Load PML4 into CR3. */
    mov $p4_table, %eax
    mov %eax, %cr3

    /* Enable PAE (CR4.PAE = bit 5). */
    mov %cr4, %eax
    or $(1 << 5), %eax
    mov %eax, %cr4

    /* Set LME in EFER (long-mode-enable, IA32_EFER MSR bit 8). */
    mov $0xC0000080, %ecx
    rdmsr
    or $(1 << 8), %eax
    wrmsr

    /* Enable paging (CR0.PG = bit 31). After this we're in compatibility
     * mode (long mode but still 32-bit code segment). The far-jump to a
     * 64-bit code descriptor finishes the transition. */
    mov %cr0, %eax
    or $(1 << 31), %eax
    mov %eax, %cr0

    /* Load 64-bit GDT + far-jump to long mode. */
    lgdt gdt64_pointer
    ljmp $gdt64_code, $long_mode_start

hang32:
    cli
    hlt
    jmp hang32


.code64

long_mode_start:
    /* Now in 64-bit mode. Re-set segment registers to null (long mode
     * mostly ignores them, but the assembler complains if they hold
     * 32-bit selectors). */
    xor %ax, %ax
    mov %ax, %ss
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %fs
    mov %ax, %gs

    /* Call C kernel entry with SysV ABI:
     *   RDI = multiboot2 magic
     *   RSI = multiboot2 info pointer
     * Both were stashed in .data by the 32-bit code above. */
    mov mb_magic, %edi
    mov mb_info_ptr, %esi
    call kernel_mb2_main

    /* If kernel_mb2_main returns, halt. */
hang64:
    cli
    hlt
    jmp hang64


.section .data
.align 8
mb_magic:
    .long 0
mb_info_ptr:
    .long 0
