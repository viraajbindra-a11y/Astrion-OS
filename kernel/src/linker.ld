/* NOVA OS Kernel Linker Script */

ENTRY(kernel_main)

SECTIONS {
    . = 0x100000;  /* Load kernel at 1MB */

    .text : {
        *(.text*)
    }

    .rodata : {
        *(.rodata*)
    }

    .data : {
        *(.data*)
    }

    .bss : {
        *(COMMON)
        *(.bss*)
    }
}
