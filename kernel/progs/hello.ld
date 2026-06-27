/* Astrion v2.0 — user-program PIE link script.
 *
 * Lays the image out starting at virtual address 0 so the loader can
 * place it at any kmalloc'd base and fix it up with R_X86_64_RELATIVE
 * relocations. .data.rel.ro before .data keeps any relocated read-only
 * data grouped. note/eh_frame/interp are discarded — the loader doesn't
 * read them and they'd only bloat the embedded blob. */

ENTRY(entry)

SECTIONS {
    . = 0;
    .text        : { *(.text*) }
    .rodata      : { *(.rodata*) }
    .data.rel.ro : { *(.data.rel.ro*) }
    .data        : { *(.data*) }
    .dynamic     : { *(.dynamic) }
    .rela.dyn    : { *(.rela.dyn) }
    .bss         : { *(.bss*) *(COMMON) }

    /DISCARD/ : { *(.note*) *(.eh_frame*) *(.comment) *(.interp) *(.gnu.hash) *(.hash) }
}
