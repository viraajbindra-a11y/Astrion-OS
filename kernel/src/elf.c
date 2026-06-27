/*
 * Astrion v2.0 — ELF64 PIE loader (hardened two-pass)
 *
 * Parses a position-independent ELF64 (ET_DYN), loads its PT_LOAD
 * segments into a fresh zero-filled region, applies R_X86_64_RELATIVE
 * relocations, and returns the entry address. Everything the loader
 * reads comes from an UNTRUSTED buffer, and on this kernel a single
 * unchecked offset writes straight into kernel memory (no ring-3, no
 * paging isolation — all RAM is one RWX identity map). So every field
 * is validated:
 *   - all size math in uint64 (no uint32 wrap, lesson #200),
 *   - hard caps on file size, image size, phnum, reloc count,
 *   - two passes: validate-only, then copy (re-verifying before each write),
 *   - entry point must land inside an executable PT_LOAD,
 *   - ONLY R_X86_64_RELATIVE relocs accepted — any symbol/GOT/PLT reloc
 *     is rejected, never silently skipped,
 *   - on any failure the partial allocation is freed; no partial state
 *     escapes.
 */

#include <stdint.h>
#include "elf.h"
#include "heap.h"

extern void serial_puts_x(const char *s);

/* ─── ELF64 on-disk structures (packed; offsets asserted in comments) ── */

typedef struct {
    uint8_t  e_ident[16];
    uint16_t e_type;        /* @16 */
    uint16_t e_machine;     /* @18 */
    uint32_t e_version;     /* @20 */
    uint64_t e_entry;       /* @24 */
    uint64_t e_phoff;       /* @32 */
    uint64_t e_shoff;       /* @40 */
    uint32_t e_flags;       /* @48 */
    uint16_t e_ehsize;      /* @52 */
    uint16_t e_phentsize;   /* @54 */
    uint16_t e_phnum;       /* @56 */
    uint16_t e_shentsize;   /* @58 */
    uint16_t e_shnum;       /* @60 */
    uint16_t e_shstrndx;    /* @62 */
} __attribute__((packed)) Elf64_Ehdr;   /* sizeof == 64 */

typedef struct {
    uint32_t p_type;        /* @0  */
    uint32_t p_flags;       /* @4  */
    uint64_t p_offset;      /* @8  */
    uint64_t p_vaddr;       /* @16 */
    uint64_t p_paddr;       /* @24 */
    uint64_t p_filesz;      /* @32 */
    uint64_t p_memsz;       /* @40 */
    uint64_t p_align;       /* @48 */
} __attribute__((packed)) Elf64_Phdr;   /* sizeof == 56 */

typedef struct {
    int64_t  d_tag;         /* @0 */
    uint64_t d_un;          /* @8 */
} __attribute__((packed)) Elf64_Dyn;    /* sizeof == 16 */

typedef struct {
    uint64_t r_offset;      /* @0  */
    uint64_t r_info;        /* @8  */
    int64_t  r_addend;      /* @16 */
} __attribute__((packed)) Elf64_Rela;   /* sizeof == 24 */

#define ET_DYN              3
#define EM_X86_64           0x3e
#define PT_LOAD             1
#define PT_DYNAMIC          2
#define PF_X                0x1
#define DT_NULL             0
#define DT_RELA             7
#define DT_RELASZ           8
#define DT_RELAENT          9
#define R_X86_64_NONE       0
#define R_X86_64_RELATIVE   8
#define ELF64_R_TYPE(i)     ((uint32_t)((i) & 0xffffffffu))

/* Hard caps — far larger than any real sample, small enough to bound work. */
#define ELF_MAX_FILE   (1u << 20)   /* 1 MiB input */
#define ELF_MAX_IMAGE  (4u << 20)   /* 4 MiB loaded image */
#define ELF_MAX_PHNUM  16u
#define ELF_MAX_RELA   4096u
#define PHENTSIZE      56u
#define RELAENT        24u

static void mcpy(uint8_t *d, const uint8_t *s, uint64_t n) {
    for (uint64_t i = 0; i < n; i++) d[i] = s[i];
}

const char *elf_load(const uint8_t *buf, uint32_t len, struct elf_image *out) {
    /* 1. size */
    if (len < sizeof(Elf64_Ehdr)) return "too small";
    if (len > ELF_MAX_FILE)       return "too large";

    /* 2. magic + identity */
    if (buf[0] != 0x7f || buf[1] != 'E' || buf[2] != 'L' || buf[3] != 'F')
        return "bad magic";
    if (buf[4] != 2) return "not 64-bit";          /* EI_CLASS = ELFCLASS64 */
    if (buf[5] != 1) return "not little-endian";   /* EI_DATA  = ELFDATA2LSB */
    if (buf[6] != 1) return "bad ELF version";     /* EI_VERSION */
    serial_puts_x("elf: magic ok\n");

    Elf64_Ehdr eh;
    mcpy((uint8_t *)&eh, buf, sizeof(eh));

    /* 3. header semantics */
    if (eh.e_type != ET_DYN)        return "not a PIE (need ET_DYN)";
    if (eh.e_machine != EM_X86_64)  return "not x86-64";
    if (eh.e_phentsize != PHENTSIZE) return "bad phentsize";
    serial_puts_x("elf: type DYN ok\n");

    /* 4. program-header table within the file */
    if (eh.e_phnum < 1 || eh.e_phnum > ELF_MAX_PHNUM) return "bad phnum";
    /* Wrap-safe: e_phoff is unbounded attacker input, so check it against
     * len BEFORE adding the table size (never `a + b > len`, which wraps). */
    uint64_t ph_bytes = (uint64_t)eh.e_phnum * PHENTSIZE;   /* <= 16*56 */
    if (eh.e_phoff < sizeof(Elf64_Ehdr) ||
        eh.e_phoff > len || ph_bytes > len - eh.e_phoff)
        return "phnum past EOF";

    /* ── PASS 1: validate every segment, compute image size, no writes ── */
    struct { uint64_t lo, hi; uint32_t flags; } seg[ELF_MAX_PHNUM];
    int      nseg = 0;
    uint64_t image_hi = 0;
    uint64_t dyn_vaddr = 0;
    int      have_dyn = 0;

    for (uint16_t i = 0; i < eh.e_phnum; i++) {
        Elf64_Phdr ph;
        mcpy((uint8_t *)&ph, buf + eh.e_phoff + (uint64_t)i * PHENTSIZE, PHENTSIZE);

        if (ph.p_type == PT_DYNAMIC) { dyn_vaddr = ph.p_vaddr; have_dyn = 1; continue; }
        if (ph.p_type != PT_LOAD) continue;   /* ignore INTERP/GNU_* etc. */

        if (ph.p_align != 0 &&
            (ph.p_align > 0x200000 || (ph.p_align & (ph.p_align - 1)) != 0))
            return "bad p_align";
        if (ph.p_filesz > ph.p_memsz) return "filesz > memsz";
        if (ph.p_memsz > ELF_MAX_IMAGE) return "segment too big";
        /* Wrap-safe file bound: p_offset is unbounded, so compare against
         * len before adding p_filesz. */
        if (ph.p_offset > len || ph.p_filesz > len - ph.p_offset)
            return "segment past EOF";
        /* Wrap-safe image bound: p_vaddr is unbounded — bound it first so
         * (p_vaddr + p_memsz) can't wrap below ELF_MAX_IMAGE. */
        if (ph.p_vaddr > ELF_MAX_IMAGE) return "vaddr too high";

        uint64_t lo = ph.p_vaddr;
        uint64_t hi = ph.p_vaddr + ph.p_memsz;   /* both <= 4 MiB now, no wrap */
        if (hi > ELF_MAX_IMAGE) return "image too big";

        for (int j = 0; j < nseg; j++)           /* pairwise overlap reject */
            if (lo < seg[j].hi && seg[j].lo < hi) return "overlapping segments";

        seg[nseg].lo = lo; seg[nseg].hi = hi; seg[nseg].flags = ph.p_flags;
        nseg++;
        if (hi > image_hi) image_hi = hi;
    }
    if (nseg == 0)                  return "no loadable segments";
    if (image_hi == 0 || image_hi > ELF_MAX_IMAGE) return "bad image size";

    /* entry must land inside an EXECUTABLE loaded segment */
    int entry_ok = 0;
    for (int j = 0; j < nseg; j++)
        if (eh.e_entry >= seg[j].lo && eh.e_entry < seg[j].hi && (seg[j].flags & PF_X))
            entry_ok = 1;
    if (!entry_ok) return "entry not in an executable segment";

    serial_puts_x("elf: segments + entry ok\n");

    /* ── allocate the load region (kcalloc zero-fills bss for free) ── */
    uint8_t *base = (uint8_t *)kcalloc(1, image_hi);
    if (!base) return "out of memory";

    /* ── PASS 2: copy file bytes, re-verifying before each write ── */
    for (uint16_t i = 0; i < eh.e_phnum; i++) {
        Elf64_Phdr ph;
        mcpy((uint8_t *)&ph, buf + eh.e_phoff + (uint64_t)i * PHENTSIZE, PHENTSIZE);
        if (ph.p_type != PT_LOAD) continue;
        /* Re-verify wrap-safely before writing (pass-1 used the same eh
         * stack copy, so this can't actually differ — defense in depth). */
        if (ph.p_offset > len || ph.p_filesz > len - ph.p_offset ||
            ph.p_vaddr > image_hi || ph.p_memsz > image_hi - ph.p_vaddr) {
            kfree(base);
            return "segment moved between passes";   /* should be impossible */
        }
        if (ph.p_filesz)
            mcpy(base + ph.p_vaddr, buf + ph.p_offset, ph.p_filesz);
    }

    /* ── relocations: R_X86_64_RELATIVE only ── */
    if (have_dyn) {
        /* Wrap-safe: dyn_vaddr is the unbounded p_vaddr of PT_DYNAMIC. */
        if (image_hi < sizeof(Elf64_Dyn) || dyn_vaddr > image_hi - sizeof(Elf64_Dyn)) {
            kfree(base); return "bad PT_DYNAMIC";
        }

        uint64_t rela = 0, relasz = 0, relaent = 0;
        uint8_t *dp = base + dyn_vaddr;
        while (dp + sizeof(Elf64_Dyn) <= base + image_hi) {
            Elf64_Dyn d;
            mcpy((uint8_t *)&d, dp, sizeof(d));
            if (d.d_tag == DT_NULL) break;
            else if (d.d_tag == DT_RELA)    rela    = d.d_un;
            else if (d.d_tag == DT_RELASZ)  relasz  = d.d_un;
            else if (d.d_tag == DT_RELAENT) relaent = d.d_un;
            dp += sizeof(Elf64_Dyn);
        }

        if (relasz > 0) {
            if (relaent != RELAENT) { kfree(base); return "bad RELAENT"; }
            if (relasz % RELAENT)   { kfree(base); return "bad RELASZ"; }
            uint64_t count = relasz / RELAENT;
            if (count > ELF_MAX_RELA) { kfree(base); return "too many relocs"; }
            /* Wrap-safe: rela (DT_RELA, attacker-controlled) bounded first,
             * then the table size, so `rela + count*24` can never wrap past
             * the cap (lesson #200 — the disk parser had the same shape). */
            if (rela > image_hi || count > (image_hi - rela) / RELAENT) {
                kfree(base); return "rela table past image";
            }

            for (uint64_t c = 0; c < count; c++) {
                Elf64_Rela r;
                mcpy((uint8_t *)&r, base + rela + c * RELAENT, RELAENT);
                uint32_t type = ELF64_R_TYPE(r.r_info);
                if (type == R_X86_64_NONE) continue;
                if (type != R_X86_64_RELATIVE) { kfree(base); return "unsupported reloc type"; }
                /* Wrap-safe: r_offset is the write target; never `r_offset+8`. */
                if ((r.r_offset & 7) != 0 || image_hi < 8 || r.r_offset > image_hi - 8) {
                    kfree(base); return "reloc offset out of range";
                }
                /* r_addend is the in-image value written (base+addend); must
                 * point strictly inside the image. */
                if (r.r_addend < 0 || (uint64_t)r.r_addend >= image_hi) {
                    kfree(base); return "reloc addend out of range";
                }
                uint64_t val = (uint64_t)(uintptr_t)base + (uint64_t)r.r_addend;
                mcpy(base + r.r_offset, (uint8_t *)&val, 8);
            }
            serial_puts_x("elf: relocations applied\n");
        }
    }

    out->base  = base;
    out->span  = image_hi;
    out->entry = (void *)(base + eh.e_entry);
    serial_puts_x("elf: loaded ok\n");
    return 0;   /* success */
}
