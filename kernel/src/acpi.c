/*
 * Astrion v2.0 — minimal ACPI table parser (see acpi.h).
 *
 * The goal is one number and one port: the SLP_TYPa value that means "off" and
 * the PM1a control register to write it to. Getting there is four hops, and
 * every hop is firmware-supplied data we do not trust:
 *
 *   1. RSDP — the root pointer. Not passed in a register; we scan the two
 *      legacy locations (the EBDA, and the BIOS ROM area 0xE0000..0xFFFFF) for
 *      the "RSD PTR " signature and a valid checksum.
 *   2. RSDT (ACPI 1.0) or XSDT (2.0+) — an array of pointers to every other
 *      table. We walk it looking for the FADT (signature "FACP").
 *   3. FADT — the fixed table. Gives us PM1a_CNT_BLK (and PM1b), plus the
 *      address of the DSDT.
 *   4. DSDT — a blob of AML bytecode. The S5 sleep type is buried in it as a
 *      \_S5_ named package; there is no struct field for it, so we pattern-match
 *      the bytecode the way every small kernel does.
 *
 * Untrusted-parser rules, enforced everywhere below:
 *   - Only the identity-mapped first 4 GiB is dereferenceable (see the boot
 *     stub's page tables). Any physical address at or above 4 GiB is skipped.
 *   - Every table's declared length is validated to fit before we read a field
 *     at a given offset — always as `a > cap - b`, never `a + b > cap`.
 *   - Multi-byte fields are assembled byte-by-byte (rd32/rd64), so table
 *     alignment is never assumed.
 *
 * If any hop fails we return "no path" rather than guessing. power.c then falls
 * back to the QEMU I/O poweroff ports, which is honest: a wrong S5 write could
 * do anything, but "I didn't find one" is safe.
 *
 * Integer only, no libc — like the rest of the kernel.
 */
#include <stdint.h>
#include "acpi.h"

/* Only the first 4 GiB is identity-mapped by the boot stub. Nothing above this
 * may be dereferenced. */
#define PHYS_LIMIT 0x100000000ULL

/* ─── port I/O ────────────────────────────────────────────────────── */
static inline void outb(uint16_t port, uint8_t v) {
    __asm__ volatile("outb %0, %1" : : "a"(v), "Nd"(port));
}
static inline void outw(uint16_t port, uint16_t v) {
    __asm__ volatile("outw %0, %1" : : "a"(v), "Nd"(port));
}
static inline uint16_t inw(uint16_t port) {
    uint16_t r;
    __asm__ volatile("inw %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

/* ─── unaligned little-endian reads ───────────────────────────────── */
static uint32_t rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t rd64(const uint8_t *p) {
    return (uint64_t)rd32(p) | ((uint64_t)rd32(p + 4) << 32);
}

/* ─── table field offsets (bytes) ─────────────────────────────────── */
#define SDT_SIG        0    /* 4 chars  */
#define SDT_LENGTH     4    /* uint32   */
#define SDT_HDR_LEN    36   /* every SDT starts with this common header */

#define RSDP_CHECKSUM  8
#define RSDP_REVISION  15
#define RSDP_RSDT      16   /* uint32 */
#define RSDP_LENGTH    20   /* uint32 (v2) */
#define RSDP_XSDT      24   /* uint64 (v2) */

#define FADT_DSDT        40    /* uint32 */
#define FADT_SMI_CMD     48    /* uint32 */
#define FADT_ACPI_ENABLE 52    /* uint8  */
#define FADT_PM1A_CNT    64    /* uint32 */
#define FADT_PM1B_CNT    68    /* uint32 */
#define FADT_X_DSDT      140   /* uint64 */
#define FADT_X_PM1A_CNT  172   /* GAS: address at +4, 8 bytes */

/* ─── parsed state ────────────────────────────────────────────────── */
static uint32_t g_pm1a_cnt   = 0;
static uint32_t g_pm1b_cnt   = 0;
static uint16_t g_slp_typ_a  = 0;
static uint16_t g_slp_typ_b  = 0;
static uint32_t g_smi_cmd    = 0;
static uint8_t  g_acpi_enable = 0;
static int      g_s5_found   = 0;

/* ─── helpers ─────────────────────────────────────────────────────── */

/* A pointer to `addr` iff the whole [addr, addr+need) range is inside the
 * identity-mapped first 4 GiB. Wrap-safe: the subtraction can't underflow
 * because addr < PHYS_LIMIT is checked first. */
static const uint8_t *phys_ptr(uint64_t addr, uint64_t need) {
    if (addr == 0 || addr >= PHYS_LIMIT) return 0;
    if (need > PHYS_LIMIT - addr) return 0;
    return (const uint8_t *)(uintptr_t)addr;
}

static int checksum_ok(const uint8_t *p, uint32_t len) {
    uint8_t sum = 0;
    for (uint32_t i = 0; i < len; i++) sum = (uint8_t)(sum + p[i]);
    return sum == 0;
}

static int sig_eq(const uint8_t *p, const char *sig, int n) {
    for (int i = 0; i < n; i++)
        if (p[i] != (uint8_t)sig[i]) return 0;
    return 1;
}

/* Map an SDT by physical address: the 36-byte header must fit, the declared
 * length must be at least a header, and the whole table must be mapped. Returns
 * the header pointer or 0. */
static const uint8_t *map_table(uint64_t addr) {
    const uint8_t *h = phys_ptr(addr, SDT_HDR_LEN);
    if (!h) return 0;
    uint32_t len = rd32(h + SDT_LENGTH);
    if (len < SDT_HDR_LEN) return 0;
    if (!phys_ptr(addr, len)) return 0;
    return h;
}

/* Scan the two legacy regions for the RSDP: the EBDA (segment word at physical
 * 0x40E, first KiB) and the BIOS ROM area. 16-byte aligned, checksum-verified
 * over the first 20 bytes. */
static const uint8_t *find_rsdp(void) {
    const uint8_t *bda = (const uint8_t *)(uintptr_t)0x40E;
    uint32_t ebda = ((uint32_t)bda[0] | ((uint32_t)bda[1] << 8)) << 4;
    if (ebda >= 0x400 && ebda < 0xA0000) {
        for (uint32_t a = ebda; a < 0xA0000 && a <= ebda + (1024 - 20); a += 16) {
            const uint8_t *p = (const uint8_t *)(uintptr_t)a;
            if (sig_eq(p, "RSD PTR ", 8) && checksum_ok(p, 20)) return p;
        }
    }
    for (uint32_t a = 0xE0000; a <= 0xFFFFF - 20; a += 16) {
        const uint8_t *p = (const uint8_t *)(uintptr_t)a;
        if (sig_eq(p, "RSD PTR ", 8) && checksum_ok(p, 20)) return p;
    }
    return 0;
}

/* Walk an RSDT (32-bit entries) or XSDT (64-bit entries) for a 4-char table
 * signature. Each candidate is length- and checksum-validated. */
static const uint8_t *find_table(const uint8_t *root, int is_xsdt, const char *sig) {
    uint32_t len = rd32(root + SDT_LENGTH);
    if (len < SDT_HDR_LEN) return 0;
    uint32_t entry_size = is_xsdt ? 8 : 4;
    uint32_t n = (len - SDT_HDR_LEN) / entry_size;
    for (uint32_t i = 0; i < n; i++) {
        const uint8_t *e = root + SDT_HDR_LEN + i * entry_size;
        uint64_t addr = is_xsdt ? rd64(e) : (uint64_t)rd32(e);
        const uint8_t *t = map_table(addr);
        if (!t) continue;
        if (sig_eq(t + SDT_SIG, sig, 4) && checksum_ok(t, rd32(t + SDT_LENGTH)))
            return t;
    }
    return 0;
}

/* Pattern-match the DSDT's AML for the \_S5_ package and pull SLP_TYPa/b out of
 * it. Shape we accept (the one every firmware emits):
 *
 *   NameOp(0x08) ['\\']  '_' 'S' '5' '_'  PackageOp(0x12)  PkgLength  NumElem
 *   [BytePrefix(0x0A)] <SLP_TYPa>  [BytePrefix(0x0A)] <SLP_TYPb>
 *
 * Small integers 0 and 1 are their own single-byte ops, so their value byte is
 * read directly; 2..7 use the 0x0A byte prefix. Returns 1 on success. */
static int parse_dsdt_s5(uint64_t dsdt_addr) {
    const uint8_t *d = map_table(dsdt_addr);
    if (!d) return 0;
    uint32_t len = rd32(d + SDT_LENGTH);

    /* Scan the AML body. We read up to a few bytes past a match, so stop while
     * the "_S5_" itself (4 bytes) still fits; every deref past it is guarded. */
    for (uint32_t i = SDT_HDR_LEN; i + 4 <= len; i++) {
        if (!(d[i] == '_' && d[i + 1] == 'S' && d[i + 2] == '5' && d[i + 3] == '_'))
            continue;

        /* A real \_S5_ object is a NameOp (0x08), optionally with a root
         * prefix '\'. Reject a stray "_S5_" that is just data. */
        int name_ok = 0;
        if (i >= 1 && d[i - 1] == 0x08) name_ok = 1;
        else if (i >= 2 && d[i - 2] == 0x08 && d[i - 1] == 0x5C) name_ok = 1;
        if (!name_ok) continue;

        uint32_t p = i + 4;                 /* past the 4-char name */
        if (p >= len || d[p] != 0x12) continue;  /* PackageOp */
        p++;

        if (p >= len) return 0;
        /* PkgLength: 1 lead byte + (top 2 bits) extra bytes. Then NumElements. */
        uint32_t extra = (uint32_t)((d[p] >> 6) & 0x3);
        if (extra > len - p - 1) return 0;  /* lead + extra must fit */
        p += 1 + extra;
        if (p >= len) return 0;
        p += 1;                             /* NumElements */
        if (p >= len) return 0;

        /* First element -> SLP_TYPa. */
        if (d[p] == 0x0A) { p++; if (p >= len) return 0; }
        g_slp_typ_a = (uint16_t)(d[p] & 0x7);
        p++;

        /* Second element -> SLP_TYPb (optional). */
        if (p < len) {
            if (d[p] == 0x0A) p++;
            if (p < len) g_slp_typ_b = (uint16_t)(d[p] & 0x7);
        }
        return 1;
    }
    return 0;
}

/* Extract the PM1 control ports + SMI/enable from the FADT, then chase the DSDT
 * for the sleep type. Returns 1 only when both halves are in hand. */
static int parse_fadt(const uint8_t *fadt) {
    uint32_t len = rd32(fadt + SDT_LENGTH);

    /* Legacy 32-bit PM1a/PM1b control ports (need through offset 71). */
    if (len < FADT_PM1B_CNT + 4) return 0;
    uint32_t pm1a = rd32(fadt + FADT_PM1A_CNT);
    uint32_t pm1b = rd32(fadt + FADT_PM1B_CNT);

    /* If the legacy field is 0, fall back to the 2.0 extended GAS (system-I/O
     * only — a memory-mapped control block is out of scope here). */
    if (pm1a == 0 && len >= FADT_X_PM1A_CNT + 12) {
        uint64_t a = rd64(fadt + FADT_X_PM1A_CNT + 4);
        if (a && a < 0x10000) pm1a = (uint32_t)a;
    }
    if (pm1a == 0) return 0;

    if (len >= FADT_ACPI_ENABLE + 1) {
        g_smi_cmd     = rd32(fadt + FADT_SMI_CMD);
        g_acpi_enable = fadt[FADT_ACPI_ENABLE];
    }

    uint64_t dsdt_addr = 0;
    if (len >= FADT_DSDT + 4) dsdt_addr = rd32(fadt + FADT_DSDT);
    if (dsdt_addr == 0 && len >= FADT_X_DSDT + 8) dsdt_addr = rd64(fadt + FADT_X_DSDT);

    g_pm1a_cnt = pm1a;
    g_pm1b_cnt = pm1b;

    /* The port alone isn't a usable path — without the sleep type we don't know
     * what to write. Require the DSDT scan too. */
    return parse_dsdt_s5(dsdt_addr);
}

/* ─── public API ──────────────────────────────────────────────────── */

int acpi_init(void) {
    const uint8_t *rsdp = find_rsdp();
    if (!rsdp) return 0;

    const uint8_t *fadt = 0;

    /* Prefer the XSDT on ACPI 2.0+ (revision >= 2), validating the extended
     * checksum over the RSDP's own declared length first. */
    if (rsdp[RSDP_REVISION] >= 2) {
        uint32_t rlen = rd32(rsdp + RSDP_LENGTH);
        if (rlen >= 33 && rlen <= 4096 && checksum_ok(rsdp, rlen)) {
            const uint8_t *xsdt = map_table(rd64(rsdp + RSDP_XSDT));
            if (xsdt && sig_eq(xsdt + SDT_SIG, "XSDT", 4) &&
                checksum_ok(xsdt, rd32(xsdt + SDT_LENGTH)))
                fadt = find_table(xsdt, 1, "FACP");
        }
    }

    /* ACPI 1.0, or the XSDT path came up empty: the 32-bit RSDT. */
    if (!fadt) {
        const uint8_t *rsdt = map_table((uint64_t)rd32(rsdp + RSDP_RSDT));
        if (rsdt && sig_eq(rsdt + SDT_SIG, "RSDT", 4) &&
            checksum_ok(rsdt, rd32(rsdt + SDT_LENGTH)))
            fadt = find_table(rsdt, 0, "FACP");
    }

    if (!fadt) return 0;

    g_s5_found = parse_fadt(fadt);
    return g_s5_found;
}

int acpi_s5_available(void) { return g_s5_found; }

void acpi_enter_s5(void) {
    if (g_pm1a_cnt == 0) return;

    /* On real hardware ACPI mode may be off (SCI_EN clear); coax it on through
     * the SMI command port. Bounded so a machine that never asserts SCI_EN
     * can't wedge us here. QEMU already has SCI_EN set, so this falls straight
     * through. */
    if (g_smi_cmd && g_acpi_enable && !(inw((uint16_t)g_pm1a_cnt) & 1)) {
        outb((uint16_t)g_smi_cmd, g_acpi_enable);
        for (int i = 0; i < 1000000; i++)
            if (inw((uint16_t)g_pm1a_cnt) & 1) break;
    }

    /* SLP_TYPx in bits 10..12, SLP_EN in bit 13 (0x2000). */
    outw((uint16_t)g_pm1a_cnt, (uint16_t)((g_slp_typ_a << 10) | (1 << 13)));
    if (g_pm1b_cnt)
        outw((uint16_t)g_pm1b_cnt, (uint16_t)((g_slp_typ_b << 10) | (1 << 13)));
}

uint32_t acpi_pm1a_cnt_port(void) { return g_pm1a_cnt; }
uint32_t acpi_pm1b_cnt_port(void) { return g_pm1b_cnt; }
uint16_t acpi_slp_typ_a(void)     { return g_slp_typ_a; }
uint16_t acpi_slp_typ_b(void)     { return g_slp_typ_b; }
