/*
 * Astrion v2.0 — ELF64 PIE loader
 *
 * Loads a position-independent ELF64 executable (ET_DYN) from a byte
 * buffer into a fresh heap region, applies R_X86_64_RELATIVE
 * relocations, and reports the entry point. The buffer is UNTRUSTED
 * (a user can `write prog.elf <bytes>` then `exec` it) and this kernel
 * has no ring-3 / no per-process paging, so the parser is the only
 * memory-safety boundary — it is bounds-checked field-for-field, the
 * same discipline as the disk superblock parser (lesson #200).
 */

#ifndef ASTRION_ELF_H
#define ASTRION_ELF_H

#include <stdint.h>

struct elf_image {
    uint8_t *base;    /* kcalloc'd load region (caller frees when the program exits) */
    uint64_t span;    /* size of the load region in bytes */
    void    *entry;   /* absolute entry address = base + e_entry */
};

/* Returns NULL on success (and fills *out), or a static human-readable
 * reason string on failure (and frees any partial allocation). */
const char *elf_load(const uint8_t *buf, uint32_t len, struct elf_image *out);

#endif /* ASTRION_ELF_H */
