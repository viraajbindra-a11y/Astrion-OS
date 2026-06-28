/*
 * Astrion v2.0 — ELF64 PIE loader (hardened two-pass; see elf.h).
 *
 * Pass 1 (elf_validate) reads nothing into memory it allocates — it only
 * validates the headers and computes the loaded image size + entry + the
 * PT_DYNAMIC location. Pass 2 (elf_emit) zero-fills the destination, copies
 * PT_LOAD bytes, and applies R_X86_64_RELATIVE relocations, re-checking
 * every bound before each write. The two callers (ring-0 kernel buffer vs.
 * ring-3 user window) share BOTH passes; only the destination pointer and
 * the relocation base differ. One validation path = one thing to audit.
 *
 * Wrap-safety rule throughout: an attacker-controlled offset is bounded
 * against the cap FIRST, then the size is compared against the remaining
 * space (`a > cap - b`) — never `a + b > cap`, which wraps (lesson #200/#202).
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

/* Validated plan handed from pass 1 to pass 2. */
struct elf_plan {
    uint64_t image_hi;     /* loaded image size = max(p_vaddr + p_memsz) */
    uint64_t e_entry;
    uint64_t e_phoff;
    uint16_t e_phnum;
    uint64_t dyn_vaddr;
    int      have_dyn;
};

/* ── PASS 1: validate headers + every segment, compute image size. No writes. ── */
static const char *elf_validate(const uint8_t *buf, uint32_t len, struct elf_plan *plan) {
    if (len < sizeof(Elf64_Ehdr)) return "too small";
    if (len > ELF_MAX_FILE)       return "too large";

    if (buf[0] != 0x7f || buf[1] != 'E' || buf[2] != 'L' || buf[3] != 'F')
        return "bad magic";
    if (buf[4] != 2) return "not 64-bit";          /* EI_CLASS = ELFCLASS64 */
    if (buf[5] != 1) return "not little-endian";   /* EI_DATA  = ELFDATA2LSB */
    if (buf[6] != 1) return "bad ELF version";     /* EI_VERSION */

    Elf64_Ehdr eh;
    mcpy((uint8_t *)&eh, buf, sizeof(eh));

    if (eh.e_type != ET_DYN)         return "not a PIE (need ET_DYN)";
    if (eh.e_machine != EM_X86_64)   return "not x86-64";
    if (eh.e_phentsize != PHENTSIZE) return "bad phentsize";
    if (eh.e_phnum < 1 || eh.e_phnum > ELF_MAX_PHNUM) return "bad phnum";

    uint64_t ph_bytes = (uint64_t)eh.e_phnum * PHENTSIZE;   /* <= 16*56 */
    if (eh.e_phoff < sizeof(Elf64_Ehdr) ||
        eh.e_phoff > len || ph_bytes > len - eh.e_phoff)
        return "phnum past EOF";

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
        if (ph.p_offset > len || ph.p_filesz > len - ph.p_offset)
            return "segment past EOF";
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

    int entry_ok = 0;
    for (int j = 0; j < nseg; j++)
        if (eh.e_entry >= seg[j].lo && eh.e_entry < seg[j].hi && (seg[j].flags & PF_X))
            entry_ok = 1;
    if (!entry_ok) return "entry not in an executable segment";

    plan->image_hi  = image_hi;
    plan->e_entry   = eh.e_entry;
    plan->e_phoff   = eh.e_phoff;
    plan->e_phnum   = eh.e_phnum;
    plan->dyn_vaddr = dyn_vaddr;
    plan->have_dyn  = have_dyn;
    return 0;
}

/* ── PASS 2: zero dst, copy PT_LOAD bytes, apply RELATIVE relocations. ──
 * Writes go to dst+offset (bounded by image_hi, which the caller has already
 * confirmed fits the destination). Relocation VALUES are write_base+addend —
 * for ring 3 that is the user virtual address, NOT the kernel pointer, or the
 * relocated pointers would aim a ring-3 program at kernel space. */
static const char *elf_emit(const uint8_t *buf, uint32_t len, const struct elf_plan *plan,
                            uint8_t *dst, uint64_t write_base) {
    uint64_t image_hi = plan->image_hi;

    for (uint64_t i = 0; i < image_hi; i++) dst[i] = 0;   /* .bss / gaps = 0 */

    for (uint16_t i = 0; i < plan->e_phnum; i++) {
        Elf64_Phdr ph;
        mcpy((uint8_t *)&ph, buf + plan->e_phoff + (uint64_t)i * PHENTSIZE, PHENTSIZE);
        if (ph.p_type != PT_LOAD) continue;
        if (ph.p_offset > len || ph.p_filesz > len - ph.p_offset ||
            ph.p_vaddr > image_hi || ph.p_memsz > image_hi - ph.p_vaddr)
            return "segment moved between passes";   /* should be impossible */
        if (ph.p_filesz)
            mcpy(dst + ph.p_vaddr, buf + ph.p_offset, ph.p_filesz);
    }

    if (plan->have_dyn) {
        if (image_hi < sizeof(Elf64_Dyn) || plan->dyn_vaddr > image_hi - sizeof(Elf64_Dyn))
            return "bad PT_DYNAMIC";

        uint64_t rela = 0, relasz = 0, relaent = 0;
        uint8_t *dp = dst + plan->dyn_vaddr;
        while (dp + sizeof(Elf64_Dyn) <= dst + image_hi) {
            Elf64_Dyn d;
            mcpy((uint8_t *)&d, dp, sizeof(d));
            if (d.d_tag == DT_NULL) break;
            else if (d.d_tag == DT_RELA)    rela    = d.d_un;
            else if (d.d_tag == DT_RELASZ)  relasz  = d.d_un;
            else if (d.d_tag == DT_RELAENT) relaent = d.d_un;
            dp += sizeof(Elf64_Dyn);
        }

        if (relasz > 0) {
            if (relaent != RELAENT) return "bad RELAENT";
            if (relasz % RELAENT)   return "bad RELASZ";
            uint64_t count = relasz / RELAENT;
            if (count > ELF_MAX_RELA) return "too many relocs";
            if (rela > image_hi || count > (image_hi - rela) / RELAENT)
                return "rela table past image";

            for (uint64_t c = 0; c < count; c++) {
                Elf64_Rela r;
                mcpy((uint8_t *)&r, dst + rela + c * RELAENT, RELAENT);
                uint32_t type = ELF64_R_TYPE(r.r_info);
                if (type == R_X86_64_NONE) continue;
                if (type != R_X86_64_RELATIVE) return "unsupported reloc type";
                if ((r.r_offset & 7) != 0 || image_hi < 8 || r.r_offset > image_hi - 8)
                    return "reloc offset out of range";
                if (r.r_addend < 0 || (uint64_t)r.r_addend >= image_hi)
                    return "reloc addend out of range";
                uint64_t val = write_base + (uint64_t)r.r_addend;
                mcpy(dst + r.r_offset, (uint8_t *)&val, 8);
            }
        }
    }
    return 0;
}

const char *elf_probe(const uint8_t *buf, uint32_t len, uint64_t *span_out) {
    struct elf_plan plan;
    const char *e = elf_validate(buf, len, &plan);
    if (e) return e;
    if (span_out) *span_out = plan.image_hi;
    return 0;
}

const char *elf_load_at(const uint8_t *buf, uint32_t len,
                        uint8_t *dst, uint64_t dst_cap, uint64_t link_base,
                        uint64_t *entry_out, uint64_t *span_out) {
    struct elf_plan plan;
    const char *e = elf_validate(buf, len, &plan);
    if (e) return e;
    if (plan.image_hi > dst_cap) return "image exceeds user region";
    e = elf_emit(buf, len, &plan, dst, link_base);
    if (e) return e;
    if (entry_out) *entry_out = link_base + plan.e_entry;
    if (span_out)  *span_out  = plan.image_hi;
    serial_puts_x("elf: loaded into ring-3 window ok\n");
    return 0;
}

const char *elf_load(const uint8_t *buf, uint32_t len, struct elf_image *out) {
    struct elf_plan plan;
    const char *e = elf_validate(buf, len, &plan);
    if (e) return e;

    uint8_t *base = (uint8_t *)kcalloc(1, plan.image_hi);
    if (!base) return "out of memory";

    e = elf_emit(buf, len, &plan, base, (uint64_t)(uintptr_t)base);
    if (e) { kfree(base); return e; }

    out->base  = base;
    out->span  = plan.image_hi;
    out->entry = (void *)(base + plan.e_entry);
    return 0;
}
