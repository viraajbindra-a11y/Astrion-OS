/*
 * Astrion v2.0 — Multiboot2 kernel entry
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

/* ─── COM1 UART (0x3F8) — identical to boot/boot.c ────────────────── */

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

    const char *bootloader_name;
    const char *cmdline;
} boot_info;

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
                    if (e->type == 1) avail += e->len;
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
                /* Tag type known by name but not parsed in detail —
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

/* Called from boot/multiboot2.S */
void kernel_mb2_main(uint32_t magic, uint64_t info_ptr) {
    serial_init();
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
        serial_puts("FATAL: magic mismatch — not a multiboot2 bootloader\n");
        for (;;) __asm__ volatile("cli; hlt");
    }
    serial_puts("magic OK — GRUB hand-off clean\n\n");

    parse_info(info_ptr);
    print_summary();

    serial_puts("\nkernel halt (next: page allocator + framebuffer driver)\n");

    /* Halt forever. */
    for (;;) {
        __asm__ volatile("cli; hlt");
    }
}
