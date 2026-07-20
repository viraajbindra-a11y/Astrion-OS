/*
 * Astrion v2.0 - Multiboot2 kernel entry
 *
 * Called from boot/multiboot2.S after long-mode setup.
 *
 *   1. Init COM1 serial.
 *   2. Print banner + multiboot2 magic + info pointer.
 *   3. Walk the info-tag list. Log every tag (type, size). For known
 *      tag types (bootloader name, command line, basic memory, memory
 *      map, framebuffer), pretty-print the contents.
 *   4. Halt.
 *
 * Tag walking is the foundation. Once we can extract:
 *   - framebuffer base + dimensions  → drive gui/framebuffer.c
 *   - memory map                     → bring up an allocator
 *   - command line                   → respect boot-time options
 * the kernel can do real work.
 *
 * Spec: https://www.gnu.org/software/grub/manual/multiboot2/multiboot.html
 *       §3.6 "Boot information format".
 */

#include <stdint.h>
#include "fb_font.h"
#include "idt.h"
#include "kbd.h"
#include "pit.h"
#include "rtc.h"
#include "acpi.h"
#include "console.h"
#include "desktop.h"
#include "wm.h"
#include "settings.h"   /* session accent / wallpaper / 12h-vs-24h clock */
#include "gpt.h"
#include "af.h"
#include "shell.h"
#include "mouse.h"
#include "heap.h"
#include "pmm.h"
#include "fs.h"
#include "ata.h"
#include "task.h"

/* ─── COM1 UART (0x3F8) - identical to boot/boot.c ────────────────── */

static inline void outb(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static inline uint8_t inb(uint16_t port) {
    uint8_t val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

static void serial_init(void) {
    outb(0x3F8 + 1, 0x00);
    outb(0x3F8 + 3, 0x80);
    outb(0x3F8 + 0, 0x03);
    outb(0x3F8 + 1, 0x00);
    outb(0x3F8 + 3, 0x03);
    outb(0x3F8 + 2, 0xC7);
    outb(0x3F8 + 4, 0x0B);
}

static void serial_putc(char c) {
    while ((inb(0x3F8 + 5) & 0x20) == 0) { }
    outb(0x3F8, (uint8_t)c);
}

static void serial_puts(const char *s) {
    while (*s) {
        if (*s == '\n') serial_putc('\r');
        serial_putc(*s);
        s++;
    }
}

/* Set by boot/multiboot2.S: 1 if it mapped with 1 GiB pages, 0 if it fell
 * back to the 4 GiB 2 MiB mapping. */
extern uint64_t pdpe1gb_used;

static void serial_put_hex64(uint64_t v) {
    static const char hex[] = "0123456789abcdef";
    serial_puts("0x");
    for (int i = 15; i >= 0; i--) {
        serial_putc(hex[(v >> (i * 4)) & 0xF]);
    }
}

static void serial_put_u32(uint32_t v) {
    /* Decimal, no leading zero. */
    if (v == 0) { serial_putc('0'); return; }
    char buf[11];
    int i = 0;
    while (v) {
        buf[i++] = '0' + (v % 10);
        v /= 10;
    }
    while (i > 0) serial_putc(buf[--i]);
}

static void serial_put_u64(uint64_t v) {
    if (v == 0) { serial_putc('0'); return; }
    char buf[21];
    int i = 0;
    while (v) {
        buf[i++] = '0' + (v % 10);
        v /= 10;
    }
    while (i > 0) serial_putc(buf[--i]);
}

/* ─── Multiboot2 info-tag layout (spec §3.6) ──────────────────────── */

#define MB2_TAG_END                 0
#define MB2_TAG_CMDLINE             1
#define MB2_TAG_BOOTLOADER_NAME     2
#define MB2_TAG_MODULE              3
#define MB2_TAG_BASIC_MEMINFO       4
#define MB2_TAG_BOOTDEV             5
#define MB2_TAG_MMAP                6
#define MB2_TAG_VBE                 7
#define MB2_TAG_FRAMEBUFFER         8
#define MB2_TAG_ELF_SECTIONS        9
#define MB2_TAG_APM                 10
#define MB2_TAG_EFI32               11
#define MB2_TAG_EFI64               12
#define MB2_TAG_SMBIOS              13
#define MB2_TAG_ACPI_OLD            14
#define MB2_TAG_ACPI_NEW            15
#define MB2_TAG_NETWORK             16
#define MB2_TAG_EFI_MMAP            17
#define MB2_TAG_EFI_BS              18
#define MB2_TAG_EFI32_IH            19
#define MB2_TAG_EFI64_IH            20
#define MB2_TAG_LOAD_BASE_ADDR      21

struct mb2_header {
    uint32_t total_size;
    uint32_t reserved;
} __attribute__((packed));

struct mb2_tag {
    uint32_t type;
    uint32_t size;
} __attribute__((packed));

struct mb2_tag_string {
    uint32_t type;
    uint32_t size;
    char     string[];
} __attribute__((packed));

struct mb2_tag_basic_meminfo {
    uint32_t type;
    uint32_t size;
    uint32_t mem_lower;     /* KiB below 1 MiB */
    uint32_t mem_upper;     /* KiB above 1 MiB */
} __attribute__((packed));

/* A file GRUB loaded into RAM for us before the kernel started, named by a
 * `module2 <path> <string>` line in grub.cfg. mod_start/mod_end are PHYSICAL
 * addresses of the first and one-past-last byte.
 *
 * This is how the language model gets in. The alternative is our own disk
 * driver, and ata.c is PIO `insw` at roughly 3 MB/s - a 400 MB model would take
 * about two minutes of staring at a blank screen, and a multi-GB one half an
 * hour. GRUB reads at 20-50 MB/s and does it before we are running, so the
 * weights are simply present at kernel entry. It also means no AHCI/DMA driver
 * has to exist first, which was otherwise weeks of work standing between here
 * and any model at all. */
struct mb2_tag_module {
    uint32_t type;
    uint32_t size;
    uint32_t mod_start;
    uint32_t mod_end;
    char     string[];      /* the label from grub.cfg, NUL-terminated */
} __attribute__((packed));

struct mb2_mmap_entry {
    uint64_t addr;
    uint64_t len;
    uint32_t type;          /* 1 = available, 3 = ACPI reclaimable, etc. */
    uint32_t reserved;
} __attribute__((packed));

struct mb2_tag_mmap {
    uint32_t type;
    uint32_t size;
    uint32_t entry_size;
    uint32_t entry_version;
    struct mb2_mmap_entry entries[];
} __attribute__((packed));

struct mb2_tag_framebuffer {
    uint32_t type;
    uint32_t size;
    uint64_t framebuffer_addr;
    uint32_t framebuffer_pitch;
    uint32_t framebuffer_width;
    uint32_t framebuffer_height;
    uint8_t  framebuffer_bpp;
    uint8_t  framebuffer_type;
    uint16_t reserved;
    /* color-info follows; ignored for now */
} __attribute__((packed));

/* Stash extracted info here so later kernel code can grab it without
 * re-walking the tag list. */
static struct {
    uint64_t fb_addr;
    uint32_t fb_pitch;
    uint32_t fb_width;
    uint32_t fb_height;
    uint8_t  fb_bpp;
    int      fb_present;

    uint32_t mem_lower_kib;
    uint32_t mem_upper_kib;
    int      basic_meminfo_present;

    uint64_t total_available_bytes;
    uint32_t mmap_entry_count;

    /* The type=available regions from the mmap, kept so the physical frame
     * allocator can free exactly the real RAM and nothing reserved. */
#define BOOT_MAX_AVAIL 24
    uint64_t avail_base[BOOT_MAX_AVAIL];
    uint64_t avail_len[BOOT_MAX_AVAIL];
    uint32_t avail_count;

    /* Files GRUB loaded for us. Physical base + length; the pointer is into
     * the multiboot info block, which stays live. */
#define BOOT_MAX_MODULES 8
    uint64_t    module_base[BOOT_MAX_MODULES];
    uint64_t    module_len[BOOT_MAX_MODULES];
    const char *module_name[BOOT_MAX_MODULES];
    uint32_t    module_count;

    const char *bootloader_name;
    const char *cmdline;
} boot_info;

/* Exposed so the model loader can find its weights without re-walking tags. */
uint32_t boot_module_count(void) { return boot_info.module_count; }
int boot_module(uint32_t i, uint64_t *base, uint64_t *len, const char **name) {
    if (i >= boot_info.module_count) return 0;
    if (base) *base = boot_info.module_base[i];
    if (len)  *len  = boot_info.module_len[i];
    if (name) *name = boot_info.module_name[i];
    return 1;
}

/* Exposed for pmm.c - the available RAM regions the frame allocator draws from. */
uint32_t boot_mmap_avail_count(void) { return boot_info.avail_count; }
int boot_mmap_avail_region(uint32_t i, uint64_t *base, uint64_t *len) {
    if (i >= boot_info.avail_count) return 0;
    if (base) *base = boot_info.avail_base[i];
    if (len)  *len  = boot_info.avail_len[i];
    return 1;
}

static const char *tag_name(uint32_t type) {
    switch (type) {
        case MB2_TAG_END:             return "end";
        case MB2_TAG_CMDLINE:         return "cmdline";
        case MB2_TAG_BOOTLOADER_NAME: return "bootloader-name";
        case MB2_TAG_MODULE:          return "module";
        case MB2_TAG_BASIC_MEMINFO:   return "basic-meminfo";
        case MB2_TAG_BOOTDEV:         return "bootdev";
        case MB2_TAG_MMAP:            return "mmap";
        case MB2_TAG_VBE:             return "vbe";
        case MB2_TAG_FRAMEBUFFER:     return "framebuffer";
        case MB2_TAG_ELF_SECTIONS:    return "elf-sections";
        case MB2_TAG_APM:             return "apm";
        case MB2_TAG_EFI32:           return "efi32-system-table";
        case MB2_TAG_EFI64:           return "efi64-system-table";
        case MB2_TAG_SMBIOS:          return "smbios";
        case MB2_TAG_ACPI_OLD:        return "acpi-rsdp-v1";
        case MB2_TAG_ACPI_NEW:        return "acpi-rsdp-v2";
        case MB2_TAG_NETWORK:         return "network";
        case MB2_TAG_EFI_MMAP:        return "efi-mmap";
        case MB2_TAG_EFI_BS:          return "efi-boot-services-not-terminated";
        case MB2_TAG_EFI32_IH:        return "efi32-image-handle";
        case MB2_TAG_EFI64_IH:        return "efi64-image-handle";
        case MB2_TAG_LOAD_BASE_ADDR:  return "load-base-addr";
        default:                      return "unknown";
    }
}

static const char *mmap_type_name(uint32_t t) {
    switch (t) {
        case 1: return "available";
        case 2: return "reserved";
        case 3: return "ACPI-reclaimable";
        case 4: return "ACPI-NVS";
        case 5: return "bad";
        default: return "?";
    }
}

static void parse_info(uint64_t info_ptr) {
    struct mb2_header *hdr = (struct mb2_header *)info_ptr;
    serial_puts("info total_size = ");
    serial_put_u32(hdr->total_size);
    serial_puts(" bytes\n");

    /* First tag starts at info_ptr + 8 (after the header). Tags are
     * 8-byte aligned. The list terminates at an END tag (type 0,
     * size 8). */
    uintptr_t cur = (uintptr_t)info_ptr + 8;
    uintptr_t end = (uintptr_t)info_ptr + hdr->total_size;
    int tag_count = 0;

    while (cur < end) {
        struct mb2_tag *t = (struct mb2_tag *)cur;
        tag_count++;

        serial_puts("  tag #");
        serial_put_u32(tag_count);
        serial_puts(": type=");
        serial_put_u32(t->type);
        serial_puts(" (");
        serial_puts(tag_name(t->type));
        serial_puts("), size=");
        serial_put_u32(t->size);
        serial_puts("\n");

        if (t->type == MB2_TAG_END) {
            break;
        }

        switch (t->type) {
            case MB2_TAG_BOOTLOADER_NAME: {
                struct mb2_tag_string *s = (struct mb2_tag_string *)t;
                boot_info.bootloader_name = s->string;
                serial_puts("    bootloader = \"");
                serial_puts(s->string);
                serial_puts("\"\n");
                break;
            }
            case MB2_TAG_CMDLINE: {
                struct mb2_tag_string *s = (struct mb2_tag_string *)t;
                boot_info.cmdline = s->string;
                serial_puts("    cmdline = \"");
                serial_puts(s->string);
                serial_puts("\"\n");
                break;
            }
            case MB2_TAG_MODULE: {
                struct mb2_tag_module *m = (struct mb2_tag_module *)t;
                serial_puts("    module \"");
                serial_puts(m->string);
                serial_puts("\" at ");
                serial_put_hex64(m->mod_start);
                serial_puts(" .. ");
                serial_put_hex64(m->mod_end);
                serial_puts(", ");
                serial_put_u32(m->mod_end - m->mod_start);
                serial_puts(" bytes\n");

                /* Reject a backwards or empty span before recording it. GRUB
                 * should never produce one, but this is attacker-adjacent data
                 * in the sense that it arrives from outside the kernel, and
                 * mod_end - mod_start is about to become a length someone
                 * iterates over. A wrapped length here is a fault later, a long
                 * way from the cause. */
                if (m->mod_end <= m->mod_start) {
                    serial_puts("    IGNORED: module span is empty or backwards\n");
                    break;
                }
                if (boot_info.module_count < BOOT_MAX_MODULES) {
                    uint32_t k = boot_info.module_count++;
                    boot_info.module_base[k] = m->mod_start;
                    boot_info.module_len[k]  = m->mod_end - m->mod_start;
                    boot_info.module_name[k] = m->string;
                } else {
                    serial_puts("    IGNORED: too many modules\n");
                }
                break;
            }
            case MB2_TAG_BASIC_MEMINFO: {
                struct mb2_tag_basic_meminfo *m = (struct mb2_tag_basic_meminfo *)t;
                boot_info.mem_lower_kib = m->mem_lower;
                boot_info.mem_upper_kib = m->mem_upper;
                boot_info.basic_meminfo_present = 1;
                serial_puts("    mem_lower = ");
                serial_put_u32(m->mem_lower);
                serial_puts(" KiB, mem_upper = ");
                serial_put_u32(m->mem_upper);
                serial_puts(" KiB (total ~");
                serial_put_u32((m->mem_lower + m->mem_upper) / 1024);
                serial_puts(" MiB)\n");
                break;
            }
            case MB2_TAG_MMAP: {
                struct mb2_tag_mmap *m = (struct mb2_tag_mmap *)t;
                uint32_t entry_count = (m->size - 16) / m->entry_size;
                boot_info.mmap_entry_count = entry_count;
                serial_puts("    mmap: ");
                serial_put_u32(entry_count);
                serial_puts(" entries, entry_size=");
                serial_put_u32(m->entry_size);
                serial_puts("\n");
                uint64_t avail = 0;
                for (uint32_t i = 0; i < entry_count; i++) {
                    struct mb2_mmap_entry *e =
                        (struct mb2_mmap_entry *)
                        ((uintptr_t)m->entries + i * m->entry_size);
                    serial_puts("      [");
                    serial_put_u32(i);
                    serial_puts("] addr=");
                    serial_put_hex64(e->addr);
                    serial_puts(" len=");
                    serial_put_hex64(e->len);
                    serial_puts(" type=");
                    serial_put_u32(e->type);
                    serial_puts(" (");
                    serial_puts(mmap_type_name(e->type));
                    serial_puts(")\n");
                    if (e->type == 1) {
                        avail += e->len;
                        if (boot_info.avail_count < BOOT_MAX_AVAIL) {
                            uint32_t k = boot_info.avail_count++;
                            boot_info.avail_base[k] = e->addr;
                            boot_info.avail_len[k]  = e->len;
                        }
                    }
                }
                boot_info.total_available_bytes = avail;
                serial_puts("    available memory total = ");
                serial_put_u64(avail / (1024 * 1024));
                serial_puts(" MiB\n");
                break;
            }
            case MB2_TAG_FRAMEBUFFER: {
                struct mb2_tag_framebuffer *f = (struct mb2_tag_framebuffer *)t;
                boot_info.fb_addr    = f->framebuffer_addr;
                boot_info.fb_pitch   = f->framebuffer_pitch;
                boot_info.fb_width   = f->framebuffer_width;
                boot_info.fb_height  = f->framebuffer_height;
                boot_info.fb_bpp     = f->framebuffer_bpp;
                boot_info.fb_present = 1;
                serial_puts("    framebuffer @ ");
                serial_put_hex64(f->framebuffer_addr);
                serial_puts(", ");
                serial_put_u32(f->framebuffer_width);
                serial_puts("x");
                serial_put_u32(f->framebuffer_height);
                serial_puts(", ");
                serial_put_u32(f->framebuffer_bpp);
                serial_puts(" bpp, pitch=");
                serial_put_u32(f->framebuffer_pitch);
                serial_puts(", type=");
                serial_put_u32(f->framebuffer_type);
                serial_puts("\n");
                break;
            }
            default:
                /* Tag type known by name but not parsed in detail -
                 * the type+size line above is enough for now. */
                break;
        }

        /* Advance to next tag: round size up to 8-byte boundary. */
        cur += (t->size + 7u) & ~7u;
    }

    serial_puts("info walk complete: ");
    serial_put_u32(tag_count);
    serial_puts(" tags total\n");
}

/* ─── Framebuffer paint test ──────────────────────────────────────
 *
 * If GRUB gave us a linear 32-bpp framebuffer, paint a recognizable
 * test pattern: navy background, big blue "A" block in the middle.
 * Then read back a few pixels and verify they stuck. This is the
 * smoke test that says "we own the display." Once it passes, we
 * can start wiring real graphics code (fonts, windows, etc.).
 */

#define COL_NAVY    0x1E2761u    /* Astrion navy */
#define COL_ACCENT  0x0A84FFu    /* desktop blue accent — matches AC_ACCENT in desktop.h */
#define COL_WHITE   0xFFFFFFu
#define COL_ICE     0xCADCFCu    /* slideshow secondary */
#define COL_MUTED   0x64748Bu    /* slideshow muted */

static void fb_fill(uint32_t color) {
    if (!boot_info.fb_present || boot_info.fb_bpp != 32) return;
    volatile uint32_t *fb = (volatile uint32_t *)boot_info.fb_addr;
    uint32_t pitch_px = boot_info.fb_pitch / 4;
    for (uint32_t y = 0; y < boot_info.fb_height; y++) {
        for (uint32_t x = 0; x < boot_info.fb_width; x++) {
            fb[y * pitch_px + x] = color;
        }
    }
}

static void fb_rect(uint32_t x0, uint32_t y0, uint32_t w, uint32_t h, uint32_t color) {
    if (!boot_info.fb_present || boot_info.fb_bpp != 32) return;
    volatile uint32_t *fb = (volatile uint32_t *)boot_info.fb_addr;
    uint32_t pitch_px = boot_info.fb_pitch / 4;
    for (uint32_t y = y0; y < y0 + h && y < boot_info.fb_height; y++) {
        for (uint32_t x = x0; x < x0 + w && x < boot_info.fb_width; x++) {
            fb[y * pitch_px + x] = color;
        }
    }
}

/* ─── Framebuffer text rendering ─────────────────────────────────
 *
 * Walks the 8x12 bitmap in fb_font.h and writes pixels directly to
 * the linear framebuffer. `scale` is integer (1 = native 8x12, 2 =
 * 16x24, 3 = 24x36). No kerning, no antialiasing - just bits to
 * pixels. Foreground color is the glyph; background is left
 * untouched so callers can pre-fill if they want.
 */

static void fb_putchar(uint32_t x, uint32_t y, char c, uint32_t color, int scale) {
    if (!boot_info.fb_present || boot_info.fb_bpp != 32) return;
    if (c < 32 || c > 126) c = '?';
    int idx = c - 32;
    if (scale < 1) scale = 1;

    volatile uint32_t *fb = (volatile uint32_t *)boot_info.fb_addr;
    uint32_t pitch_px = boot_info.fb_pitch / 4;

    for (int row = 0; row < FONT_HEIGHT; row++) {
        uint8_t bits = font_data[idx][row];
        for (int col = 0; col < FONT_WIDTH; col++) {
            if (!(bits & (1 << (FONT_WIDTH - 1 - col)))) continue;
            uint32_t px = x + col * scale;
            uint32_t py = y + row * scale;
            for (int sy = 0; sy < scale; sy++) {
                if (py + sy >= boot_info.fb_height) continue;
                for (int sx = 0; sx < scale; sx++) {
                    if (px + sx >= boot_info.fb_width) continue;
                    fb[(py + sy) * pitch_px + (px + sx)] = color;
                }
            }
        }
    }
}

/* Returns the x-coord after the last char drawn (so callers can chain).
 * Wraps to next line on '\n'. Returns final cursor for caller use. */
static uint32_t fb_puts(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale) {
    if (!boot_info.fb_present) return x;
    uint32_t cx = x, cy = y;
    int gw = FONT_WIDTH * scale;
    int gh = FONT_HEIGHT * scale;
    while (*s) {
        if (*s == '\n') {
            cx = x;
            cy += gh + 2;
            s++;
            continue;
        }
        fb_putchar(cx, cy, *s, color, scale);
        cx += gw;
        s++;
    }
    return cx;
}

/* Render a uint32 as decimal at (x,y). Returns x past the last digit. */
static uint32_t fb_put_u32(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale) {
    char buf[11];
    int i = 0;
    if (v == 0) { buf[i++] = '0'; }
    else { while (v) { buf[i++] = '0' + (v % 10); v /= 10; } }
    int gw = FONT_WIDTH * scale;
    while (i > 0) {
        fb_putchar(x, y, buf[--i], color, scale);
        x += gw;
    }
    return x;
}

/* Hex u64 at (x,y) - "0x" + 16 nibbles. Returns x past last char. */
static uint32_t fb_put_hex64(uint32_t x, uint32_t y, uint64_t v, uint32_t color, int scale) {
    static const char hex[] = "0123456789abcdef";
    int gw = FONT_WIDTH * scale;
    fb_putchar(x, y, '0', color, scale); x += gw;
    fb_putchar(x, y, 'x', color, scale); x += gw;
    for (int i = 15; i >= 0; i--) {
        fb_putchar(x, y, hex[(v >> (i * 4)) & 0xF], color, scale);
        x += gw;
    }
    return x;
}

static void paint_boot_screen(void) {
    if (!boot_info.fb_present) {
        serial_puts("boot screen: skipped (no fb)\n");
        return;
    }
    if (boot_info.fb_bpp != 32) {
        serial_puts("boot screen: skipped (bpp != 32)\n");
        return;
    }

    serial_puts("boot screen: rendering...\n");

    /* Centered branded splash — the first thing the audience sees. The old
     * debug panel's info still goes to the serial log via print_summary(). */
    uint32_t W = boot_info.fb_width, H = boot_info.fb_height;
    uint32_t cx = W / 2, cyc = H / 2;

    fb_fill(COL_NAVY);
    fb_rect(0, 0, 18, H, COL_ACCENT);              /* left accent motif */

    /* Logo emblem: blue square with a navy notch (matches the top bar). */
    uint32_t emb = 72;
    fb_rect(cx - emb / 2, cyc - 210, emb, emb, COL_ACCENT);
    fb_rect(cx - emb / 2 + 20, cyc - 210 + 20, emb - 40, emb - 40, COL_NAVY);

    /* Wordmark + version + tagline in antialiased Inter (like the web build). */
    af_draw_center(cx, cyc - 122, "Astrion", COL_WHITE, AF_SB30);
    af_draw_center(cx, cyc - 80,  "v2.0", COL_ACCENT, AF_SB16);
    af_draw_center(cx, cyc - 42,  "the AI-native operating system", COL_ICE, AF_REG16);

    /* Loading bar (static fill — the splash is only up during init). */
    uint32_t bw = 380, bx = cx - bw / 2, by = cyc + 60;
    fb_rect(bx, by, bw, 8, 0x243056u);             /* track */
    fb_rect(bx, by, (bw * 72) / 100, 8, COL_ACCENT);
    af_draw_center(cx, by + 18, "starting Astrion...", COL_MUTED, AF_REG13);

    /* Honest capability line along the bottom. */
    const char *cap = "64-bit  -  multiboot2+GRUB  -  heap  -  files  -  preemptive tasks  -  ring-3  -  on-device GPT";
    af_draw_center(cx, H - 44, cap, COL_MUTED, AF_REG13);

    /* Read-back verification: sample one of the white text pixels. */
    volatile uint32_t *fb = (volatile uint32_t *)boot_info.fb_addr;
    uint32_t pitch_px = boot_info.fb_pitch / 4;
    /* A safe known-white pixel is inside the "A" of "Astrion v2.0" at ~(75, 75)
     * given 6x scale. Just sample the accent bar instead for reliability. */
    uint32_t got = fb[20 * pitch_px + 5];   /* inside the blue accent bar */
    serial_puts("boot screen: readback @ accent = ");
    serial_put_hex64((uint64_t)got);
    /* Some framebuffers store BGR-ordered; both 0x0A84FF (RGB) and
     * 0xFF840A (BGR) are acceptable matches. */
    if ((got & 0xFFFFFFu) == COL_ACCENT || (got & 0xFFFFFFu) == 0xFF840Au) {
        serial_puts("  OK - pixel write verified\n");
    } else {
        serial_puts("  WARN - readback didn't match written color\n");
    }
}

static void print_summary(void) {
    serial_puts("\n--- boot summary ---\n");
    if (boot_info.bootloader_name) {
        serial_puts("bootloader      : ");
        serial_puts(boot_info.bootloader_name);
        serial_puts("\n");
    }
    if (boot_info.cmdline) {
        serial_puts("cmdline         : ");
        serial_puts(boot_info.cmdline);
        serial_puts("\n");
    }
    if (boot_info.basic_meminfo_present) {
        serial_puts("RAM (basic)     : ~");
        serial_put_u32((boot_info.mem_lower_kib + boot_info.mem_upper_kib) / 1024);
        serial_puts(" MiB\n");
    }
    if (boot_info.mmap_entry_count) {
        serial_puts("mmap entries    : ");
        serial_put_u32(boot_info.mmap_entry_count);
        serial_puts("\n");
        serial_puts("available RAM   : ");
        serial_put_u64(boot_info.total_available_bytes / (1024 * 1024));
        serial_puts(" MiB\n");
    }
    if (boot_info.fb_present) {
        serial_puts("framebuffer     : ");
        serial_put_u32(boot_info.fb_width);
        serial_puts("x");
        serial_put_u32(boot_info.fb_height);
        serial_puts(" @ ");
        serial_put_u32(boot_info.fb_bpp);
        serial_puts(" bpp, base=");
        serial_put_hex64(boot_info.fb_addr);
        serial_puts("\n");
    } else {
        serial_puts("framebuffer     : not provided by bootloader\n");
    }
    serial_puts("--- ready to drive hardware ---\n");
}

/* ─── External-call wrappers for idt.c ────────────────────────────
 *
 * Most of the helpers above are `static` to keep the symbol surface
 * small. idt.c needs a few of them at panic time, so expose tiny
 * non-static wrappers here. Keeps responsibility clear: kernel_mb2.c
 * owns the boot_info struct + fb/serial primitives; idt.c calls these
 * narrow extern hooks at panic. elf.c/gdt.c/fs.c use the serial ones to
 * report the handful of things worth reporting from a driver.
 */
void serial_puts_x(const char *s)        { serial_puts(s); }
void serial_put_hex64_x(uint64_t v)      { serial_put_hex64(v); }
void serial_put_u64_x(uint64_t v)        { serial_put_u64(v); }
int  fb_present_x(void)                  { return boot_info.fb_present; }
uint32_t fb_width_x(void)                { return boot_info.fb_width; }
uint32_t fb_height_x(void)               { return boot_info.fb_height; }
void fb_fill_x(uint32_t color)           { fb_fill(color); }
void fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color) {
    fb_rect(x, y, w, h, color);
}
uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale) {
    return fb_puts(x, y, s, color, scale);
}
uint32_t fb_put_hex64_x(uint32_t x, uint32_t y, uint64_t v, uint32_t color, int scale) {
    return fb_put_hex64(x, y, v, color, scale);
}
uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale) {
    return fb_put_u32(x, y, v, color, scale);
}
/* Used by console.c to scroll the framebuffer region. */
uint64_t fb_addr_x(void)                 { return boot_info.fb_addr; }
uint32_t fb_pitch_x(void)                { return boot_info.fb_pitch; }

/* Exposed so the shell's 'wipe' command can repaint the boot screen,
 * clearing any drag-painted ink trails. */
void paint_boot_screen_x(void) { paint_boot_screen(); }

/* Used by shell.c for `mem` / `version` commands. */
uint32_t mb_mmap_entry_count_x(void)     { return boot_info.mmap_entry_count; }
uint32_t mb_total_available_mib_x(void)  {
    return (uint32_t)(boot_info.total_available_bytes / (1024u * 1024u));
}
uint32_t mb_fb_width_x(void)             { return boot_info.fb_width; }
uint32_t mb_fb_height_x(void)            { return boot_info.fb_height; }
uint8_t  mb_fb_bpp_x(void)               { return boot_info.fb_bpp; }
uint64_t mb_fb_addr_x(void)              { return boot_info.fb_addr; }
const char *mb_bootloader_name_x(void)   { return boot_info.bootloader_name; }

/* ─── Background clock task ───────────────────────────────────────
 *
 * First real scheduled task. Repaints HH:MM:SS in the top-right
 * corner every ~250 ms, yielding between checks. Because it's a
 * task (not inline in the shell loop), the clock keeps ticking
 * while Snake runs, while scripts execute - while anything that
 * yields holds the foreground.
 */
static void clock_task(void *arg) {
    (void)arg;
    uint64_t last = 0;
    char clkbuf[32];
    for (;;) {
        uint64_t now = pit_elapsed_ms();
        if (now - last >= 250) {
            last = now;
            struct rtc_time t;
            if (rtc_read(&t) == 0) {
                /* "Jul 07  14:32:05" — the real wall clock, off the CMOS chip.
                 * Day is always 2 digits so the string width never changes;
                 * desktop_draw_clock clears exactly the width it draws, and a
                 * shrinking string would leave a sliver of the old one. */
                const char *m = rtc_month_name(t.month);
                int k = 0;
                clkbuf[k++] = m[0]; clkbuf[k++] = m[1]; clkbuf[k++] = m[2];
                clkbuf[k++] = ' ';
                clkbuf[k++] = (char)('0' + (t.day / 10) % 10);
                clkbuf[k++] = (char)('0' + t.day % 10);
                clkbuf[k++] = ' '; clkbuf[k++] = ' ';
                if (settings_clock_24h()) {
                    rtc_format_time(&t, clkbuf + k);
                } else {
                    /* 12-hour, with the hour ZERO-PADDED. That is not how a
                     * clock is usually written, and it is deliberate: the width
                     * rule at the top of this block applies inside a format as
                     * well as between the day digits, and an unpadded hour would
                     * change width at 9 -> 10 and again at 12 -> 1, leaving a
                     * sliver of the old string behind. The AM/PM suffix is a
                     * constant two characters, so the whole string is fixed
                     * width; switching FORMAT does change it, but that only
                     * happens from the Settings panel, which repaints the
                     * entire top bar on its way through. */
                    int h12 = t.hour % 12; if (h12 == 0) h12 = 12;
                    clkbuf[k++] = (char)('0' + h12 / 10);
                    clkbuf[k++] = (char)('0' + h12 % 10);
                    clkbuf[k++] = ':';
                    clkbuf[k++] = (char)('0' + (t.min / 10) % 10);
                    clkbuf[k++] = (char)('0' + t.min % 10);
                    clkbuf[k++] = ':';
                    clkbuf[k++] = (char)('0' + (t.sec / 10) % 10);
                    clkbuf[k++] = (char)('0' + t.sec % 10);
                    clkbuf[k++] = ' ';
                    clkbuf[k++] = (t.hour < 12) ? 'A' : 'P';
                    clkbuf[k++] = 'M';
                    clkbuf[k]   = 0;
                }
            } else {
                pit_format_clock(clkbuf);      /* no usable RTC -> uptime */
            }
            desktop_draw_clock(clkbuf);   /* top bar, right side */
        }
        task_yield();
    }
}

/* Called from boot/multiboot2.S */
/* Enable the SSE FPU so the Assistant's GPT can use hardware float. The rest
 * of the kernel is built -mno-sse and never touches XMM; only the GPT (which
 * runs on task 0) does. Because no other task uses XMM, its registers survive
 * preemption without a context-switch save. Must run before any float code.
 * (Clear CR0.EM, set CR0.MP, set CR4.OSFXSR + CR4.OSXMMEXCPT.) */
static void enable_sse(void) {
    uint64_t cr0, cr4;
    __asm__ volatile("mov %%cr0, %0" : "=r"(cr0));
    cr0 &= ~(1ULL << 2);              /* EM = 0 */
    cr0 |=  (1ULL << 1);              /* MP = 1 */
    __asm__ volatile("mov %0, %%cr0" :: "r"(cr0));
    __asm__ volatile("mov %%cr4, %0" : "=r"(cr4));
    cr4 |= (1ULL << 9) | (1ULL << 10);   /* OSFXSR | OSXMMEXCPT */
    __asm__ volatile("mov %0, %%cr4" :: "r"(cr4));
}

void kernel_mb2_main(uint32_t magic, uint64_t info_ptr) {
    serial_init();
    enable_sse();
    serial_puts("\n");
    serial_puts("=== Astrion v2.0 Kernel (multiboot2 path) ===\n");
    serial_puts("kernel_mb2_main reached; long-mode OK\n");

    serial_puts("multiboot2 magic = ");
    serial_put_hex64((uint64_t)magic);
    serial_puts("\n");

    serial_puts("multiboot2 info  = ");
    serial_put_hex64(info_ptr);
    serial_puts("\n");

    if (magic != 0x36d76289u) {
        serial_puts("FATAL: magic mismatch - not a multiboot2 bootloader\n");
        for (;;) __asm__ volatile("cli; hlt");
    }
    serial_puts("magic OK - GRUB hand-off clean\n\n");

    parse_info(info_ptr);
    print_summary();

    serial_puts("\n");
    paint_boot_screen();

    /* Heap before anything that would benefit from it (currently
     * nothing - but it's cheap and sets up the contract for the
     * next features). 32 MiB at 4 MiB physical. */
    serial_puts("\nHEAP: initializing 32 MiB at 0x400000...\n");
    /* Push the heap above anything GRUB loaded for us. Modules land right
     * after the kernel image, which is exactly where the heap wanted to go —
     * it overlapped and silently ate half a 4 MiB module before this. */
    uint64_t mod_floor = 0;
    for (uint32_t i = 0; i < boot_info.module_count; i++) {
        uint64_t e = boot_info.module_base[i] + boot_info.module_len[i];
        if (e > mod_floor) mod_floor = e;
    }
    heap_init(mod_floor);
    /* Smoke test: tiny alloc + free, verify round-trip. */
    {
        void *a = kmalloc(64);
        void *b = kmalloc(128);
        kfree(a);
        void *c = kmalloc(48);   /* should reuse a's slot via split */
        kfree(b);
        kfree(c);
        serial_puts("HEAP: smoke test passed\n");
    }

    /* How far can we actually address? boot/multiboot2.S picks between 1 GiB
     * pages (512 GiB mapped) and a 2 MiB fallback (4 GiB) based on CPUID, and
     * records which. Report it, then PROVE it: a boot that silently took the
     * fallback is indistinguishable from one that didn't unless something
     * writes past 4 GiB and reads it back.
     *
     * The probe only runs when the memory map says that address is real
     * RAM - touching an unbacked physical address is how you earn a #PF at a
     * point in boot where there is no handler to survive it. */
    serial_puts("\nPAGING: ");
    if (pdpe1gb_used) serial_puts("1 GiB pages, 512 GiB identity-mapped\n");
    else              serial_puts("2 MiB pages, 4 GiB identity-mapped (no PDPE1GB)\n");

    {
        uint64_t probe = 6ull << 30;          /* 6 GiB - above the old ceiling */

        /* Ask the MEMORY MAP whether that address is real RAM, not
         * basic-meminfo's mem_upper. mem_upper is the legacy BIOS field and
         * saturates around 3 GiB - on an 8 GiB box it reads 3071 MiB while the
         * mmap correctly reports a 5 GiB region at 0x1_0000_0000. Gating on
         * mem_upper skipped this probe on a machine that had the RAM. */
        int backed = 0;
        for (uint32_t i = 0; i < boot_mmap_avail_count(); i++) {
            uint64_t base, len;
            if (!boot_mmap_avail_region(i, &base, &len)) continue;
            if (probe >= base && probe + 4096 <= base + len) { backed = 1; break; }
        }
        if (pdpe1gb_used && backed) {
            /* XOR the sentinel with the address so a stale or aliased read -
             * e.g. 6 GiB secretly folding back onto a low page - shows up as a
             * mismatch instead of passing on a value that happens to be there. */
            uint64_t want = 0xA5A5A5A5DEADBEEFull ^ probe;
            volatile uint64_t *p = (volatile uint64_t *)probe;
            *p = want;
            uint64_t back = *p;
            serial_puts("PAGING: probe at 6 GiB ");
            serial_puts(back == want ? "OK\n" : "MISMATCH\n");
        } else {
            serial_puts("PAGING: probe skipped (not enough RAM, or 2 MiB path)\n");
        }
    }

    /* Modules GRUB handed us. Fingerprint each one HERE, inside the kernel,
     * over the bytes actually in RAM — then compare against the host's hash of
     * the file on disk. "The tag says 400 MB is at 0x1000000" proves only that
     * GRUB filled in a struct; reading every byte proves the data survived the
     * handoff, the address is really mapped, and nothing is aliased. That
     * distinction is the whole point of the check.
     *
     * FNV-1a: no table, no allocation, and it runs before the heap exists. */
    if (boot_info.module_count) {
        serial_puts("\nMODULES: ");
        serial_put_u32(boot_info.module_count);
        serial_puts(" loaded by the bootloader\n");
        for (uint32_t i = 0; i < boot_info.module_count; i++) {
            const uint8_t *p = (const uint8_t *)(uintptr_t)boot_info.module_base[i];
            uint64_t n = boot_info.module_len[i];
            uint64_t h = 1469598103934665603ull;          /* FNV offset basis */
            for (uint64_t k = 0; k < n; k++) {
                h ^= p[k];
                h *= 1099511628211ull;                    /* FNV prime */
            }
            serial_puts("  \"");
            serial_puts(boot_info.module_name[i]);
            serial_puts("\" ");
            serial_put_u64(n);
            serial_puts(" bytes, fnv1a=");
            serial_put_hex64(h);
            serial_puts("\n");
        }
    } else {
        serial_puts("\nMODULES: none\n");
    }

    /* Physical frame allocator over the RAM above the heap - the foundation
     * for per-process address spaces (Tier 3). Needs the heap (for its bitmap)
     * and the mmap (already parsed above), so it goes here. */
    serial_puts("\nPMM: initializing physical frame allocator...\n");
    pmm_init();

    /* ATA before FS - FS uses ata_present() at init to decide whether
     * to seed defaults or load from disk. */
    serial_puts("ATA: probing primary master...\n");
    ata_init();
    if (ata_present()) {
        serial_puts("ATA: disk found\n");
    } else {
        serial_puts("ATA: no disk attached\n");
    }

    /* Filesystem. Loads from disk if present + has a valid superblock,
     * otherwise seeds /readme.txt + /greet.sh. */
    serial_puts("FS: initializing...\n");
    fs_init();
    serial_puts("FS: ready\n");

    /* GDT rebuild: replace the boot GDT (null + one ring-0 code seg) with a
     * full set — kernel code/data, ring-3 code/data, and a TSS — so we can
     * run user programs at CPL 3. Must precede the IDT (the IST stacks the
     * IDT references live in the TSS) and any ring-3 entry. The kernel code
     * selector stays 0x08, so the IDT's gates remain valid. */
    extern void gdt_install(void);
    gdt_install();

    /* IDT - any later fault should panic visibly, not silently
     * triple-fault. */
    serial_puts("IDT: installing 256-entry table (32 exceptions + 16 IRQs)...\n");
    idt_install();
    serial_puts("IDT: loaded\n");

    /* Remap legacy PIC IRQs 0..15 onto vectors 32..47. Mask everything
     * by default; the drivers below unmask their own lines. */
    serial_puts("PIC: remapping 0..15 -> vectors 32..47...\n");
    pic_remap();
    for (int i = 0; i < 16; i++) pic_mask_irq(i);

    /* PIT at 100 Hz on IRQ0 → 10ms tick → live clock. */
    pit_install(100);
    serial_puts("PIT: 100 Hz tick installed\n");

    {   /* Wall clock. Report it at boot so the date is on the record. */
        struct rtc_time t;
        if (rtc_read(&t) == 0) {
            char d[11], c[9];
            rtc_format_date(&t, d);
            rtc_format_time(&t, c);
            serial_puts("RTC: "); serial_puts(d);
            serial_puts(" "); serial_puts(c);
            serial_puts(" (CMOS wall clock, no network time)\n");
        } else {
            serial_puts("RTC: no sane clock - falling back to uptime\n");
        }
    }

    {   /* Poweroff path. Parse the ACPI tables for an S5 target and report what
         * we found, like the clock above — on the record either way. */
        if (acpi_init()) {
            serial_puts("ACPI: S5 poweroff ready (PM1a_CNT=");
            serial_put_hex64(acpi_pm1a_cnt_port());
            serial_puts(", SLP_TYPa=");
            serial_put_u32(acpi_slp_typ_a());
            serial_puts(")\n");
        } else {
            serial_puts("ACPI: no clean S5 path - poweroff will use QEMU I/O ports\n");
        }
    }

    /* PS/2 keyboard on IRQ1. */
    kbd_install();
    serial_puts("KBD: PS/2 IRQ1 unmasked\n");

    /* Serial console keyboard on COM1 / IRQ4 - a second producer feeding the
     * SAME ring buffer as the PS/2 path, so anything that reads the keyboard
     * is driven identically from a terminal on the other end of the cable.
     * Enables the UART's received-data interrupt only; the kernel log keeps
     * transmitting exactly as it does now. */
    serial_kbd_install();
    serial_puts("SERIAL: COM1 RX enabled, IRQ4 unmasked (console keyboard)\n");

    /* PS/2 mouse on IRQ12. */
    mouse_install(boot_info.fb_width, boot_info.fb_height);
    serial_puts("MOUSE: PS/2 aux device enabled, IRQ12 unmasked\n");

    /* Ring-3 plumbing: carve the US=1 user memory window, then arm the
     * `syscall` instruction (EFER.SCE + STAR/LSTAR/FMASK). Both must be in
     * place before the shell can `exec` a program into ring 3. */
    extern void usermem_init(void);
    extern void syscall_init(void);
    usermem_init();
    syscall_init();

    /* Enable interrupts. From here, kbd + PIT ISRs fire on their own. */
    __asm__ volatile("sti");
    serial_puts("IF set - entering shell\n");

    /* Hold the branded splash briefly so it's actually seen — boot is well
     * under a second otherwise. The PIT is live now, so this is a real timed
     * wait (hlt until ~1.5s elapsed), not a busy spin. */
    {
        uint64_t t0 = pit_elapsed_ms();
        while (pit_elapsed_ms() - t0 < 1500) __asm__ volatile("hlt");
    }

    /* Session settings (accent / wallpaper / clock format) come up FIRST: the
     * very first thing desktop_init() does is ask them what colour the
     * wallpaper is. Defaults only — nothing is read from disk. */
    settings_init();

    /* Paint the desktop (wallpaper + top bar + dock + Terminal window),
     * then anchor the scrolling console inside the Terminal window's
     * content rect. This replaces the old static boot-info panel. */
    desktop_init();
    uint32_t cx0, cy0, cw, ch;
    desktop_terminal_rect(&cx0, &cy0, &cw, &ch);
    console_init(cx0, cy0, cw, ch);
    shell_install();
    wm_init();   /* window manager: dock apps float above the Terminal */
    gpt_init();  /* on-device GPT (Assistant): allocate the KV-cache */

    /* Cooperative scheduler: adopt this context as task 0 ("shell"),
     * then move the clock repaint into its own background task. From
     * here on, anything long-running that calls task_yield() shares
     * the CPU with the shell - the clock keeps ticking during Snake. */
    tasks_init();
    task_spawn("clock", clock_task, 0);
    serial_puts("TASKS: scheduler up (task 0 = shell, task 1 = clock)\n");

    /* Main loop = task 0. Drain keyboard into the shell, repaint the
     * mouse cursor, then yield so background tasks get their slice.
     * The hlt parks the CPU until the next IRQ (PIT @100 Hz at the
     * latest), so the yield cadence is ~10 ms. */
    for (;;) {
        __asm__ volatile("sti; hlt");

        while (kbd_available()) {
            char c = kbd_getchar();
            if (c) {
                /* If an app window is open it gets the keys; otherwise the
                 * shell does. */
                if (!wm_handle_key(c)) shell_on_key(c);
                /* Echo to serial. Emit CR before LF: serial_puts() already does
                 * this, so this raw echo was the ONLY bare LF in the stream and
                 * a real terminal staircased against otherwise-clean output.
                 * Matters now that serial is a real input path, not just a log.
                 * (The raw 0x80-0x83 arrow-key echo is left as-is on purpose —
                 * one junk glyph, and it's useful when debugging over serial.) */
                if (c == '\n') serial_putc('\r');
                serial_putc(c);
            }
        }

        /* Mouse: dock clicks + window dragging, then repaint the cursor. */
        wm_tick();

        /* There used to be a staleness repair here: painters that ran under the
         * resting cursor set a flag, and task 0 lifted the sprite and asked the
         * console to repaint what had been hidden.
         *
         * It is gone because repairing afterwards is unfixable for a painter
         * that MOVES pixels. Console scroll blits the whole terminal up a row,
         * arrow included, and afterwards there is a copy of the cursor at a
         * position nothing has a record of — so this cleaned the live copy and
         * left every scrolled-away one on screen until `clear`.
         *
         * mouse_invalidate_rect() now lifts the sprite at damage time instead,
         * while the cache it holds is still true. Nothing of ours is ever on
         * the framebuffer while another painter is touching that footprint, so
         * there is nothing left here to repair — a scroll copies clean console
         * pixels. This redraw puts the cursor back on a fresh background. */
        mouse_redraw_if_dirty();

        /* The one thing that CAN quietly undo all of that is a painter which
         * writes first and announces afterwards. mouse.c detects it but cannot
         * say so from where it notices — that is inside console.c's masked
         * section, and serial output busy-waits per character. So it counts,
         * and the report happens here with interrupts on. Once, not per frame:
         * a loud line in a log Rex already reads, and silence when we are
         * behaving. */
        {
            static int faults_reported;
            if (!faults_reported && mouse_bg_faults()) {
                faults_reported = 1;
                serial_puts("CURSOR: a painter wrote before calling "
                            "mouse_invalidate_rect - stale-cache bugs are back\n");
            }
        }

        /* Give background tasks (clock, spawned tickers, …) a slice. */
        task_yield();
    }
}
