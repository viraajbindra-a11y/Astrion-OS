/*
 * Astrion v2.0 — ELF64 PIE loader
 *
 * Loads a position-independent ELF64 (ET_DYN) from an UNTRUSTED byte
 * buffer, applies R_X86_64_RELATIVE relocations, and reports the entry
 * point. Since a malformed ELF could otherwise scribble into kernel
 * memory, the parser is bounds-checked field-for-field, all size math in
 * uint64, every offset/size compared wrap-safely (`a > cap - b`).
 *
 * Two front doors over one shared, audited validate+emit core:
 *   - elf_load()    : ring-0 path — allocates a kernel buffer, relocates
 *                     the image to live at that buffer's address.
 *   - elf_probe()   : pass-1 only — returns the loaded image size so the
 *                     caller can reserve user-window frames.
 *   - elf_load_at() : ring-3 path — writes the image through a kernel
 *                     pointer `dst` but relocates it to RUN at `link_base`
 *                     (a user virtual address). dst and link_base differ
 *                     because the kernel and ring 3 see the pool at
 *                     different addresses.
 */
#ifndef ASTRION_ELF_H
#define ASTRION_ELF_H

#include <stdint.h>

struct elf_image {
    uint8_t *base;    /* kcalloc'd load region (caller frees when the program exits) */
    uint64_t span;    /* size of the load region in bytes */
    void    *entry;   /* absolute entry address = base + e_entry */
};

const char *elf_load(const uint8_t *buf, uint32_t len, struct elf_image *out);

const char *elf_probe(const uint8_t *buf, uint32_t len, uint64_t *span_out);

const char *elf_load_at(const uint8_t *buf, uint32_t len,
                        uint8_t *dst, uint64_t dst_cap, uint64_t link_base,
                        uint64_t *entry_out, uint64_t *span_out);

#endif
