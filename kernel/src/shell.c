/*
 * Astrion v2.0 — In-kernel shell
 *
 * Reads chars via shell_on_key() (called from kernel_mb2_main's
 * keyboard drain loop), echoes them through the console module,
 * and on Enter dispatches to a built-in command table.
 *
 * Commands:
 *   help              — list commands.
 *   version           — kernel + build banner.
 *   clear             — clear the console region.
 *   echo <text>       — print arguments verbatim.
 *   mem               — dump the multiboot2 memory map.
 *   regs              — dump CR0/CR2/CR3/CR4 + RFLAGS + RSP.
 *   tick              — print current PIT tick count + elapsed time.
 *   panic             — trigger int $3 for fun (panic-screen demo).
 *   halt              — cli + hlt forever.
 *   art               — print an ASCII-art Astrion banner.
 *
 * Each command is just a function taking (argc, argv). argv is
 * carved out of a single input line in place — no malloc, no copy.
 */

#include <stdint.h>
#include "shell.h"
#include "console.h"
#include "pit.h"
#include "idt.h"
#include "snake.h"
#include "heap.h"
#include "fs.h"
#include "ata.h"
#include "task.h"

#define COL_PROMPT 0xFF7A00u     /* Astrion orange */
#define COL_OK     0x4ADE80u     /* green for success-ish */
#define COL_MUTED  0x94A3B8u
#define COL_WHITE  0xFFFFFFu

/* Boot-info accessors exposed by kernel_mb2.c. */
extern uint32_t mb_mmap_entry_count_x(void);
extern uint32_t mb_total_available_mib_x(void);
extern uint32_t mb_fb_width_x(void);
extern uint32_t mb_fb_height_x(void);
extern uint8_t  mb_fb_bpp_x(void);
extern uint64_t mb_fb_addr_x(void);
extern const char *mb_bootloader_name_x(void);

#define LINE_MAX 80
static char line[LINE_MAX];
static int  line_len;

static int streq(const char *a, const char *b) {
    while (*a && *b && *a == *b) { a++; b++; }
    return *a == 0 && *b == 0;
}

static int starts_with(const char *s, const char *p) {
    while (*p) { if (*s++ != *p++) return 0; }
    return 1;
}

static void print_prompt(void) {
    console_set_color(COL_PROMPT);
    console_puts("astrion> ");
    console_set_color(COL_WHITE);
}

/* ─── Commands ─────────────────────────────────────────────── */

typedef void (*cmd_fn)(int argc, char **argv);

struct cmd {
    const char *name;
    const char *help;
    cmd_fn      fn;
};

static void cmd_help(int argc, char **argv);
static void cmd_version(int argc, char **argv);
static void cmd_clear(int argc, char **argv);
static void cmd_echo(int argc, char **argv);
static void cmd_mem(int argc, char **argv);
static void cmd_regs(int argc, char **argv);
static void cmd_tick(int argc, char **argv);
static void cmd_panic(int argc, char **argv);
static void cmd_halt(int argc, char **argv);
static void cmd_art(int argc, char **argv);
static void cmd_cpuid(int argc, char **argv);
static void cmd_uptime(int argc, char **argv);
static void cmd_guess(int argc, char **argv);
static void cmd_wipe(int argc, char **argv);
static void cmd_paint(int argc, char **argv);
static void cmd_snake(int argc, char **argv);
static void cmd_heap(int argc, char **argv);
static void cmd_ls(int argc, char **argv);
static void cmd_cat(int argc, char **argv);
static void cmd_write(int argc, char **argv);
static void cmd_append(int argc, char **argv);
static void cmd_rm(int argc, char **argv);
static void cmd_touch(int argc, char **argv);
static void cmd_mkdir(int argc, char **argv);
static void cmd_sync(int argc, char **argv);
static void cmd_disk(int argc, char **argv);
static void cmd_run(int argc, char **argv);
static void cmd_ps(int argc, char **argv);
static void cmd_spawn(int argc, char **argv);
static void cmd_kill(int argc, char **argv);

static const struct cmd CMDS[] = {
    { "help",    "list available commands",          cmd_help },
    { "version", "kernel + build banner",            cmd_version },
    { "clear",   "clear the console",                cmd_clear },
    { "echo",    "echo <text>",                      cmd_echo },
    { "mem",     "show memory map summary",          cmd_mem },
    { "regs",    "dump CR0/CR2/CR3/CR4 + RFLAGS",    cmd_regs },
    { "cpuid",   "CPU vendor + feature flags",       cmd_cpuid },
    { "tick",    "current PIT tick count + uptime",  cmd_tick },
    { "uptime",  "human-readable uptime",            cmd_uptime },
    { "guess",   "play: guess my number 1..100",     cmd_guess },
    { "paint",   "drag mouse to draw ink trails",    cmd_paint },
    { "wipe",    "clear any ink trails / repaint",   cmd_wipe },
    { "snake",   "play classic Snake (arrows steer)", cmd_snake },
    { "heap",    "kernel heap stats",                cmd_heap },
    { "ls",      "list files in /",                  cmd_ls },
    { "cat",     "print file contents",              cmd_cat },
    { "write",   "write <file> <text...>",           cmd_write },
    { "append",  "append <file> <text...>",          cmd_append },
    { "rm",      "remove a file",                    cmd_rm },
    { "touch",   "create an empty file",             cmd_touch },
    { "mkdir",   "create a directory entry",         cmd_mkdir },
    { "sync",    "write all files to disk",          cmd_sync },
    { "disk",    "show ATA disk info",               cmd_disk },
    { "run",     "run a script (one cmd per line)",  cmd_run },
    { "ps",      "list scheduler tasks",             cmd_ps },
    { "spawn",   "spawn ticker — background counter", cmd_spawn },
    { "kill",    "kill <tid> — stop a task",         cmd_kill },
    { "panic",   "trigger int $3 (panic-screen demo)", cmd_panic },
    { "halt",    "stop the CPU forever",             cmd_halt },
    { "art",     "print Astrion ASCII banner",       cmd_art },
    { 0, 0, 0 },
};

static void cmd_help(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_OK);
    console_puts("available commands:\n");
    console_set_color(COL_WHITE);
    for (const struct cmd *c = CMDS; c->name; c++) {
        console_puts("  ");
        console_set_color(COL_PROMPT);
        console_puts(c->name);
        console_set_color(COL_MUTED);
        /* pad to col 14 */
        int pad = 14 - 0;
        for (int i = 0; c->name[i]; i++) pad--;
        while (pad-- > 0) console_putchar(' ');
        console_puts(c->help);
        console_putchar('\n');
    }
    console_set_color(COL_WHITE);
}

static void cmd_version(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_OK);
    console_puts("Astrion Kernel v2.0-stub\n");
    console_set_color(COL_WHITE);
    console_puts("  boot:       multiboot2 + GRUB\n");
    console_puts("  bootloader: ");
    const char *bl = mb_bootloader_name_x();
    console_puts(bl ? bl : "(unknown)");
    console_putchar('\n');
    console_puts("  arch:       x86_64 long mode\n");
    console_puts("  build date: " __DATE__ " " __TIME__ "\n");
}

static void cmd_clear(int argc, char **argv) {
    (void)argc; (void)argv;
    console_clear();
}

static void cmd_echo(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        console_puts(argv[i]);
        if (i + 1 < argc) console_putchar(' ');
    }
    console_putchar('\n');
}

static void cmd_mem(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_OK);
    console_puts("memory map:\n");
    console_set_color(COL_WHITE);
    console_puts("  entries:   ");
    console_put_u32(mb_mmap_entry_count_x());
    console_putchar('\n');
    console_puts("  available: ");
    console_put_u32(mb_total_available_mib_x());
    console_puts(" MiB\n");
    console_puts("  fb:        ");
    console_put_u32(mb_fb_width_x());
    console_putchar('x');
    console_put_u32(mb_fb_height_x());
    console_puts(" @ ");
    console_put_u32(mb_fb_bpp_x());
    console_puts(" bpp\n");
    console_puts("  fb addr:   ");
    console_put_hex64(mb_fb_addr_x());
    console_putchar('\n');
}

static inline uint64_t read_cr(int which) {
    uint64_t v;
    switch (which) {
        case 0: __asm__ volatile("mov %%cr0, %0" : "=r"(v)); return v;
        case 2: __asm__ volatile("mov %%cr2, %0" : "=r"(v)); return v;
        case 3: __asm__ volatile("mov %%cr3, %0" : "=r"(v)); return v;
        case 4: __asm__ volatile("mov %%cr4, %0" : "=r"(v)); return v;
    }
    return 0;
}

static void cmd_regs(int argc, char **argv) {
    (void)argc; (void)argv;
    uint64_t rsp, rflags;
    __asm__ volatile("mov %%rsp, %0" : "=r"(rsp));
    __asm__ volatile("pushfq; pop %0" : "=r"(rflags));

    console_set_color(COL_OK);
    console_puts("control + flag registers:\n");
    console_set_color(COL_WHITE);
    console_puts("  CR0    = "); console_put_hex64(read_cr(0)); console_putchar('\n');
    console_puts("  CR2    = "); console_put_hex64(read_cr(2)); console_putchar('\n');
    console_puts("  CR3    = "); console_put_hex64(read_cr(3)); console_putchar('\n');
    console_puts("  CR4    = "); console_put_hex64(read_cr(4)); console_putchar('\n');
    console_puts("  RFLAGS = "); console_put_hex64(rflags);     console_putchar('\n');
    console_puts("  RSP    = "); console_put_hex64(rsp);        console_putchar('\n');
}

static void cmd_tick(int argc, char **argv) {
    (void)argc; (void)argv;
    char buf[9]; pit_format_clock(buf);
    console_set_color(COL_OK);
    console_puts("PIT status:\n");
    console_set_color(COL_WHITE);
    console_puts("  ticks:   ");
    console_put_u64(pit_ticks());
    console_putchar('\n');
    console_puts("  elapsed: ");
    console_put_u64(pit_elapsed_ms());
    console_puts(" ms (");
    console_puts(buf);
    console_puts(")\n");
}

static void cmd_panic(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("triggering int $3 — see panic screen...\n");
    __asm__ volatile("int $3");
}

static void cmd_halt(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("halting — power-cycle to reboot.\n");
    for (;;) __asm__ volatile("cli; hlt");
}

static void cmd_art(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("  /\\___   ___________ _____ ___  _  _\n");
    console_puts(" /  _  \\ /  _____/_  __\\_   _\\   \\| \\| |\n");
    console_puts("/   /_\\  \\ ____\\__) | |   |  | |  |     |\n");
    console_puts("\\  /  / | (   |\\_   |  |   |  | |  |  |\\ |\n");
    console_puts(" \\/__\\_|/\\___|  __/_______|__|/__/|__|_\\|\n");
    console_set_color(COL_WHITE);
    console_puts("  the AI-native operating system\n");
}

/* ─── cpuid ──────────────────────────────────────────────── */

static void cpuid_raw(uint32_t leaf, uint32_t *a, uint32_t *b, uint32_t *c, uint32_t *d) {
    __asm__ volatile("cpuid"
        : "=a"(*a), "=b"(*b), "=c"(*c), "=d"(*d)
        : "a"(leaf), "c"(0));
}

static void emit_flag(const char *name, int present) {
    console_putchar(' ');
    console_set_color(present ? COL_OK : COL_MUTED);
    if (!present) console_putchar('!');
    console_puts(name);
    console_set_color(COL_WHITE);
}

static void cmd_cpuid(int argc, char **argv) {
    (void)argc; (void)argv;
    uint32_t a, b, c, d;

    /* Leaf 0: vendor string in EBX,EDX,ECX (12 ASCII bytes). */
    cpuid_raw(0, &a, &b, &c, &d);
    char vendor[13];
    *(uint32_t *)&vendor[0] = b;
    *(uint32_t *)&vendor[4] = d;
    *(uint32_t *)&vendor[8] = c;
    vendor[12] = 0;

    console_set_color(COL_OK);
    console_puts("CPUID:\n");
    console_set_color(COL_WHITE);
    console_puts("  vendor:    ");
    console_puts(vendor);
    console_puts(" (max leaf ");
    console_put_u32(a);
    console_puts(")\n");

    /* Leaf 1: family/model + feature flags in EDX/ECX. */
    cpuid_raw(1, &a, &b, &c, &d);
    uint32_t family = (a >> 8) & 0xF;
    uint32_t model  = (a >> 4) & 0xF;
    uint32_t stepping = a & 0xF;
    if (family == 0xF) family += (a >> 20) & 0xFF;
    if (family >= 6)   model  += ((a >> 16) & 0xF) << 4;

    console_puts("  family:    ");
    console_put_u32(family);
    console_puts("  model: ");
    console_put_u32(model);
    console_puts("  stepping: ");
    console_put_u32(stepping);
    console_putchar('\n');

    /* Brand string from extended leaves 0x80000002..4. */
    cpuid_raw(0x80000000, &a, &b, &c, &d);
    if (a >= 0x80000004) {
        char brand[49] = {0};
        uint32_t *bp = (uint32_t *)brand;
        for (uint32_t leaf = 0x80000002; leaf <= 0x80000004; leaf++) {
            cpuid_raw(leaf, &a, &b, &c, &d);
            *bp++ = a; *bp++ = b; *bp++ = c; *bp++ = d;
        }
        /* Strip leading spaces. */
        char *p = brand; while (*p == ' ') p++;
        console_puts("  brand:     ");
        console_puts(p);
        console_putchar('\n');
    }

    /* Re-fetch leaf 1 since the brand-leaf calls clobbered ECX/EDX. */
    cpuid_raw(1, &a, &b, &c, &d);
    console_puts("  features: ");
    emit_flag("fpu",    d & (1u <<  0));
    emit_flag("tsc",    d & (1u <<  4));
    emit_flag("msr",    d & (1u <<  5));
    emit_flag("pae",    d & (1u <<  6));
    emit_flag("apic",   d & (1u <<  9));
    emit_flag("sse",    d & (1u << 25));
    emit_flag("sse2",   d & (1u << 26));
    console_putchar('\n');
    console_puts("           ");
    emit_flag("sse3",   c & (1u <<  0));
    emit_flag("ssse3",  c & (1u <<  9));
    emit_flag("sse4.1", c & (1u << 19));
    emit_flag("sse4.2", c & (1u << 20));
    emit_flag("aes",    c & (1u << 25));
    emit_flag("avx",    c & (1u << 28));
    emit_flag("rdrand", c & (1u << 30));
    console_putchar('\n');
}

/* ─── uptime ─────────────────────────────────────────────── */

static void cmd_uptime(int argc, char **argv) {
    (void)argc; (void)argv;
    char buf[9];
    pit_format_clock(buf);
    console_set_color(COL_OK);
    console_puts("up ");
    console_set_color(COL_WHITE);
    console_puts(buf);
    console_puts(" — ");
    console_put_u64(pit_ticks());
    console_puts(" ticks, ");
    console_put_u64(pit_elapsed_ms());
    console_puts(" ms\n");
}

/* ─── guess game ─────────────────────────────────────────── */

/* Simple LCG seeded from PIT ticks — not crypto, just enough for fun. */
static uint64_t lcg_state = 0;
static uint32_t target;
static int guess_active;
static int guess_attempts;

static uint32_t rand_in_range(uint32_t lo, uint32_t hi) {
    /* Knuth LCG. */
    lcg_state = lcg_state * 6364136223846793005ULL + 1442695040888963407ULL;
    uint32_t r = (uint32_t)(lcg_state >> 33);
    return lo + (r % (hi - lo + 1));
}

static int parse_u32(const char *s, uint32_t *out) {
    uint32_t v = 0;
    int any = 0;
    while (*s >= '0' && *s <= '9') {
        v = v * 10 + (uint32_t)(*s - '0');
        s++; any = 1;
    }
    if (!any || *s) return 0;
    *out = v;
    return 1;
}

static void cmd_guess(int argc, char **argv) {
    if (!guess_active) {
        /* New game. Seed from current ticks. */
        lcg_state ^= pit_ticks() * 0x9E3779B97F4A7C15ULL;
        target = rand_in_range(1, 100);
        guess_attempts = 0;
        guess_active = 1;
        console_set_color(COL_PROMPT);
        console_puts("guess: ");
        console_set_color(COL_WHITE);
        console_puts("I'm thinking of a number 1..100. Type 'guess <n>'.\n");
        return;
    }
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: guess <n>   (or 'guess give' to give up)\n");
        console_set_color(COL_WHITE);
        return;
    }
    if (streq(argv[1], "give")) {
        console_set_color(COL_PROMPT);
        console_puts("number was: ");
        console_put_u32(target);
        console_puts(". game ended.\n");
        console_set_color(COL_WHITE);
        guess_active = 0;
        return;
    }
    uint32_t g;
    if (!parse_u32(argv[1], &g)) {
        console_set_color(COL_MUTED);
        console_puts("not a number — try 'guess 42'\n");
        console_set_color(COL_WHITE);
        return;
    }
    guess_attempts++;
    if (g == target) {
        console_set_color(COL_OK);
        console_puts("YES! ");
        console_set_color(COL_WHITE);
        console_puts("found it in ");
        console_put_u32(guess_attempts);
        console_puts(" tr");
        console_puts(guess_attempts == 1 ? "y.\n" : "ies.\n");
        guess_active = 0;
        return;
    }
    console_set_color(COL_MUTED);
    console_puts(g < target ? "higher\n" : "lower\n");
    console_set_color(COL_WHITE);
}

/* ─── wipe + paint help ─────────────────────────────────── */

extern void paint_boot_screen_x(void);

static void cmd_wipe(int argc, char **argv) {
    (void)argc; (void)argv;
    paint_boot_screen_x();   /* repaint static boot screen */
    console_clear();         /* clear the shell region */
    console_set_color(COL_OK);
    console_puts("wiped.\n");
    console_set_color(COL_WHITE);
}

static void cmd_paint(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("paint mode:\n");
    console_set_color(COL_WHITE);
    console_puts("  - drag mouse with LEFT button to leave ink\n");
    console_puts("  - cursor turns orange while drawing\n");
    console_puts("  - type 'wipe' to clear and start over\n");
}

static void cmd_snake(int argc, char **argv) {
    (void)argc; (void)argv;
    int score = snake_play();
    /* Game took over the screen; repaint everything. */
    extern void paint_boot_screen_x(void);
    paint_boot_screen_x();
    console_clear();
    console_set_color(COL_PROMPT);
    console_puts("snake:");
    console_set_color(COL_WHITE);
    console_puts(" final score = ");
    console_put_u32((uint32_t)score);
    console_puts("\n");
}

static void cmd_heap(int argc, char **argv) {
    (void)argc; (void)argv;
    /* Live test: allocate something, free it, show stats reflect the activity. */
    if (argc >= 2 && streq(argv[1], "test")) {
        console_set_color(COL_PROMPT);
        console_puts("heap test:\n");
        console_set_color(COL_WHITE);
        void *blocks[8];
        for (int i = 0; i < 8; i++) {
            blocks[i] = kmalloc((i + 1) * 256);
            console_puts("  alloc ");
            console_put_u32((uint32_t)(i + 1) * 256);
            console_puts(" -> ");
            console_put_hex64((uint64_t)(uintptr_t)blocks[i]);
            console_putchar('\n');
        }
        for (int i = 0; i < 8; i++) kfree(blocks[i]);
        console_puts("  all freed\n");
    }
    console_set_color(COL_OK);
    console_puts("kernel heap:\n");
    console_set_color(COL_WHITE);
    console_puts("  total:  ");
    console_put_u64(heap_total() / 1024);
    console_puts(" KiB\n");
    console_puts("  used:   ");
    console_put_u64(heap_used() / 1024);
    console_puts(" KiB\n");
    console_puts("  free:   ");
    console_put_u64(heap_free() / 1024);
    console_puts(" KiB\n");
    console_puts("  peak:   ");
    console_put_u64(heap_peak() / 1024);
    console_puts(" KiB\n");
    console_puts("  blocks: ");
    console_put_u32(heap_block_count());
    console_puts(" total, ");
    console_put_u32(heap_free_blocks());
    console_puts(" free\n");
    console_puts("  allocs: ");
    console_put_u64(heap_alloc_count());
    console_puts(", frees: ");
    console_put_u64(heap_free_count());
    console_putchar('\n');
    console_set_color(COL_MUTED);
    console_puts("  (try 'heap test' to allocate + free 8 blocks)\n");
    console_set_color(COL_WHITE);
}

/* ─── Filesystem commands ────────────────────────────────── */

static void put_pad_to(uint32_t target_col, uint32_t cur_col) {
    while (cur_col < target_col) {
        console_putchar(' ');
        cur_col++;
    }
}

static void cmd_ls(int argc, char **argv) {
    (void)argc; (void)argv;
    if (fs_count() == 0) {
        console_set_color(COL_MUTED);
        console_puts("(empty)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("file              kind    size\n");
    console_set_color(COL_WHITE);
    for (fs_node *n = fs_first(); n; n = fs_next(n)) {
        uint32_t name_len = 0;
        const char *p = n->name;
        while (*p) { name_len++; p++; }
        console_set_color(n->kind == FS_DIR ? COL_PROMPT : COL_WHITE);
        console_puts(n->name);
        console_set_color(COL_MUTED);
        put_pad_to(18, name_len);
        console_puts(n->kind == FS_DIR ? "dir" : "file");
        put_pad_to(26, 18 + (n->kind == FS_DIR ? 3 : 4));
        console_put_u32(n->size);
        console_puts(" B\n");
    }
    console_set_color(COL_WHITE);
    console_set_color(COL_MUTED);
    console_puts("total: ");
    console_put_u32(fs_count());
    console_puts(" entries, ");
    console_put_u32(fs_total_bytes());
    console_puts(" bytes\n");
    console_set_color(COL_WHITE);
}

static void cmd_cat(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: cat <file>\n");
        console_set_color(COL_WHITE);
        return;
    }
    fs_node *n = fs_find(argv[1]);
    if (!n) {
        console_set_color(0xF87171u);
        console_puts("no such file: ");
        console_puts(argv[1]);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
    if (n->kind != FS_FILE) {
        console_set_color(COL_MUTED);
        console_puts("(directory)\n");
        console_set_color(COL_WHITE);
        return;
    }
    for (uint32_t i = 0; i < n->size; i++) {
        console_putchar((char)n->data[i]);
    }
    /* Ensure final newline. */
    if (n->size == 0 || n->data[n->size - 1] != '\n') console_putchar('\n');
}

/* Reassemble argv[start..argc-1] with single spaces between tokens
 * into a single 0-terminated buffer in caller-provided scratch. */
static uint32_t join_argv(int start, int argc, char **argv, char *out, uint32_t cap) {
    uint32_t pos = 0;
    for (int i = start; i < argc; i++) {
        const char *p = argv[i];
        while (*p && pos + 1 < cap) out[pos++] = *p++;
        if (i + 1 < argc && pos + 1 < cap) out[pos++] = ' ';
    }
    if (pos < cap) out[pos] = 0;
    return pos;
}

static void cmd_write(int argc, char **argv) {
    if (argc < 3) {
        console_set_color(COL_MUTED);
        console_puts("usage: write <file> <text...>\n");
        console_set_color(COL_WHITE);
        return;
    }
    char buf[256];
    uint32_t n = join_argv(2, argc, argv, buf, sizeof(buf));
    int r = fs_write(argv[1], (const uint8_t *)buf, n);
    if (r < 0) {
        console_set_color(0xF87171u);
        console_puts("write failed\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("wrote ");
    console_set_color(COL_WHITE);
    console_put_u32((uint32_t)r);
    console_puts(" bytes to ");
    console_puts(argv[1]);
    console_putchar('\n');
}

static void cmd_append(int argc, char **argv) {
    if (argc < 3) {
        console_set_color(COL_MUTED);
        console_puts("usage: append <file> <text...>\n");
        console_set_color(COL_WHITE);
        return;
    }
    char buf[256];
    uint32_t n = join_argv(2, argc, argv, buf, sizeof(buf) - 1);
    /* Add a newline at the end so 'append log line1' then 'cat log' is
     * one entry per line — feels right for a log file. */
    if (n < sizeof(buf) - 1) buf[n++] = '\n';
    int r = fs_append(argv[1], (const uint8_t *)buf, n);
    if (r < 0) {
        console_set_color(0xF87171u);
        console_puts("append failed\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("appended ");
    console_set_color(COL_WHITE);
    console_put_u32((uint32_t)r);
    console_puts(" bytes to ");
    console_puts(argv[1]);
    console_putchar('\n');
}

static void cmd_rm(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: rm <file>\n");
        console_set_color(COL_WHITE);
        return;
    }
    if (fs_unlink(argv[1]) != 0) {
        console_set_color(0xF87171u);
        console_puts("no such file: ");
        console_puts(argv[1]);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("removed ");
    console_set_color(COL_WHITE);
    console_puts(argv[1]);
    console_putchar('\n');
}

static void cmd_touch(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: touch <file>\n");
        console_set_color(COL_WHITE);
        return;
    }
    fs_node *n = fs_find(argv[1]);
    if (!n) n = fs_create(argv[1], FS_FILE);
    if (!n) {
        console_set_color(0xF87171u);
        console_puts("touch failed\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("touched ");
    console_set_color(COL_WHITE);
    console_puts(argv[1]);
    console_putchar('\n');
}

static void cmd_mkdir(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: mkdir <name>\n");
        console_set_color(COL_WHITE);
        return;
    }
    if (!fs_create(argv[1], FS_DIR)) {
        console_set_color(0xF87171u);
        console_puts("mkdir failed (exists?)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("mkdir ");
    console_set_color(COL_WHITE);
    console_puts(argv[1]);
    console_putchar('\n');
}

static void cmd_sync(int argc, char **argv) {
    (void)argc; (void)argv;
    if (!ata_present()) {
        console_set_color(0xF87171u);
        console_puts("sync: no disk attached (try '-hda astrion.disk' to QEMU)\n");
        console_set_color(COL_WHITE);
        return;
    }
    int r = fs_sync();
    if (r != 0) {
        console_set_color(0xF87171u);
        console_puts("sync: write failed\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("sync: ");
    console_set_color(COL_WHITE);
    console_put_u32(fs_count());
    console_puts(" entries (");
    console_put_u32(fs_total_bytes());
    console_puts(" bytes) saved to disk — reboot will restore them\n");
}

static void cmd_disk(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_OK);
    console_puts("ATA primary master:\n");
    console_set_color(COL_WHITE);
    if (!ata_present()) {
        console_set_color(COL_MUTED);
        console_puts("  no disk (boot with QEMU -hda astrion.disk to enable persistence)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_puts("  model:   ");
    console_puts(ata_model());
    console_putchar('\n');
    console_puts("  sectors: ");
    console_put_u32(ata_total_sectors());
    console_puts(" (");
    console_put_u32((ata_total_sectors() * 512) / (1024 * 1024));
    console_puts(" MiB)\n");
}

/* ─── Scheduler commands ─────────────────────────────────── */

/* Background ticker: paints an incrementing green counter just left
 * of the clock, ~10 updates/sec, yielding constantly. The visible
 * proof of multitasking — it counts while you type, while scripts
 * run, while Snake plays. */
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale);
extern uint32_t fb_width_x(void);

static void ticker_task(void *arg) {
    (void)arg;
    uint32_t n = 0;
    uint64_t last = 0;
    uint32_t x = fb_width_x() - 380;
    for (;;) {
        uint64_t now = pit_elapsed_ms();
        if (now - last >= 100) {
            last = now;
            fb_rect_x(x - 6, 26, 150, 32, 0x1E2761u);
            fb_put_u32_x(x, 30, n, 0x4ADE80u, 2);
            n++;
        }
        task_yield();
    }
}

static void cmd_ps(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_OK);
    console_puts("tid  name          state    switches\n");
    console_set_color(COL_WHITE);
    static const char *STATE_NAMES[] = { "-", "ready", "RUN", "done" };
    struct task_info ti;
    for (int i = 0; i < TASK_MAX; i++) {
        if (!task_get_info(i, &ti)) continue;
        console_put_u32((uint32_t)ti.tid);
        console_puts("    ");
        console_puts(ti.name);
        uint32_t nl = 0; for (const char *p = ti.name; *p; p++) nl++;
        for (uint32_t s = nl; s < 14; s++) console_putchar(' ');
        console_set_color(ti.tid == task_current_tid() ? COL_PROMPT : COL_WHITE);
        console_puts(STATE_NAMES[ti.state]);
        console_set_color(COL_WHITE);
        uint32_t sl = 0; for (const char *p = STATE_NAMES[ti.state]; *p; p++) sl++;
        for (uint32_t s = sl; s < 9; s++) console_putchar(' ');
        console_put_u64(ti.switches);
        console_putchar('\n');
    }
}

static void cmd_spawn(int argc, char **argv) {
    (void)argc; (void)argv;
    int tid = task_spawn("ticker", ticker_task, 0);
    if (tid < 0) {
        console_set_color(0xF87171u);
        console_puts("spawn failed (task table full?)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("spawned ");
    console_set_color(COL_WHITE);
    console_puts("ticker as tid ");
    console_put_u32((uint32_t)tid);
    console_puts(" - green counter top-right. 'kill ");
    console_put_u32((uint32_t)tid);
    console_puts("' stops it.\n");
}

static void cmd_kill(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: kill <tid>   (see 'ps')\n");
        console_set_color(COL_WHITE);
        return;
    }
    uint32_t tid;
    if (!parse_u32(argv[1], &tid)) {
        console_set_color(COL_MUTED);
        console_puts("not a number\n");
        console_set_color(COL_WHITE);
        return;
    }
    if (task_kill((int)tid) != 0) {
        console_set_color(0xF87171u);
        console_puts("kill: no such running task (and tid 0 is protected)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("killed ");
    console_set_color(COL_WHITE);
    console_puts("tid ");
    console_put_u32(tid);
    console_putchar('\n');
}

/* ─── Parser ─────────────────────────────────────────────── */

static uint8_t redirect_buf[2048];

static void dispatch(char *cmdline) {
    /* Tokenize in place. */
    char *argv[16];
    int   argc = 0;
    char *p = cmdline;
    while (*p && argc < 16) {
        while (*p == ' ' || *p == '\t') *p++ = 0;
        if (!*p) break;
        argv[argc++] = p;
        while (*p && *p != ' ' && *p != '\t') p++;
    }
    if (argc == 0) return;

    /* Detect '>' redirect: argv[i] == ">" and argv[i+1] is the file. */
    const char *redir_file = 0;
    for (int i = 1; i + 1 < argc; i++) {
        if (streq(argv[i], ">")) {
            redir_file = argv[i + 1];
            argc = i;       /* hide redirect tokens from the command */
            break;
        }
    }
    /* Nested redirect isn't supported — capture state + redirect_buf are
     * single-level. This happens with 'run script > out' where a script
     * line ALSO redirects. Rather than corrupt the outer capture, drop
     * the inner redirect: the command's output just flows into the
     * outer capture (it's all headed to the outer's file anyway). */
    if (redir_file && console_capture_active()) redir_file = 0;

    uint32_t cap_len = 0;
    if (redir_file) {
        redirect_buf[0] = 0;
        console_set_capture(redirect_buf, sizeof(redirect_buf), &cap_len);
    }

    for (const struct cmd *c = CMDS; c->name; c++) {
        if (streq(argv[0], c->name)) {
            c->fn(argc, argv);
            goto done;
        }
    }
    /* Unknown — print to console regardless of capture state. */
    if (redir_file) console_clear_capture();
    console_set_color(0xF87171u);
    console_puts("unknown command: ");
    console_puts(argv[0]);
    console_puts(" — try 'help'\n");
    console_set_color(COL_WHITE);
    return;

done:
    if (redir_file) {
        console_clear_capture();
        int r = fs_write(redir_file, redirect_buf, cap_len);
        if (r < 0) {
            console_set_color(0xF87171u);
            console_puts("> redirect failed\n");
            console_set_color(COL_WHITE);
            return;
        }
        console_set_color(COL_MUTED);
        console_puts(" -> ");
        console_set_color(COL_WHITE);
        console_puts(redir_file);
        console_set_color(COL_MUTED);
        console_puts(" (");
        console_put_u32(cap_len);
        console_puts(" bytes)\n");
        console_set_color(COL_WHITE);
    }
}

/* Scripts can call 'run', so cmd_run is re-entrant. Two hazards the
 * depth guard closes: (1) a script that runs itself recurses forever
 * and overflows the kernel stack (task 0's 16 KiB boot stack); (2) the
 * per-call line buffer must be on the STACK, not static — a static
 * buffer would be clobbered when an inner 'run' reuses it, corrupting
 * the outer loop. Cap at 8 levels: deep enough for real script nesting,
 * shallow enough that 8 × ~300-byte frames stay well under 16 KiB. */
#define RUN_MAX_DEPTH 8
static int run_depth;

static void cmd_run(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: run <file>\n");
        console_set_color(COL_WHITE);
        return;
    }
    if (run_depth >= RUN_MAX_DEPTH) {
        console_set_color(0xF87171u);
        console_puts("run: nesting too deep (max ");
        console_put_u32(RUN_MAX_DEPTH);
        console_puts(") — recursive script?\n");
        console_set_color(COL_WHITE);
        return;
    }
    fs_node *n = fs_find(argv[1]);
    if (!n || n->kind != FS_FILE) {
        console_set_color(0xF87171u);
        console_puts("run: no such file: ");
        console_puts(argv[1]);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
    /* COPY the script before executing. A script line can 'rm' or
     * 'write' the script file itself, which frees / reallocs n->data
     * out from under us — a use-after-free if we kept indexing the
     * live node. Snapshot into our own heap buffer; from here the
     * file node can be deleted with no effect on this run. */
    uint32_t sz = n->size;
    uint8_t *script = (uint8_t *)kmalloc(sz ? sz : 1);
    if (!script) {
        console_set_color(0xF87171u);
        console_puts("run: out of memory\n");
        console_set_color(COL_WHITE);
        return;
    }
    for (uint32_t i = 0; i < sz; i++) script[i] = n->data[i];

    run_depth++;
    /* line[] is a STACK buffer (not static) so nested 'run' calls each
     * get their own. dispatch() tokenizes in place, hence the copy. */
    char line[256];
    uint32_t line_pos = 0;
    int line_no = 1;
    for (uint32_t i = 0; i <= sz; i++) {
        char c = (i < sz) ? (char)script[i] : '\n';
        if (c == '\n' || c == '\r') {
            line[line_pos] = 0;
            /* Skip empty + comment lines. */
            const char *t = line;
            while (*t == ' ' || *t == '\t') t++;
            if (*t && *t != '#') {
                /* Trace-print so the user sees the script execute. */
                console_set_color(COL_MUTED);
                console_puts("[");
                console_put_u32((uint32_t)line_no);
                console_puts("] ");
                console_set_color(COL_PROMPT);
                console_puts(line);
                console_putchar('\n');
                console_set_color(COL_WHITE);
                dispatch(line);
            }
            line_pos = 0;
            line_no++;
            continue;
        }
        if (line_pos + 1 < sizeof(line)) line[line_pos++] = c;
    }
    run_depth--;
    kfree(script);
    console_set_color(COL_OK);
    console_puts("run: ");
    console_set_color(COL_WHITE);
    console_puts(argv[1]);
    console_puts(" done\n");
}

/* ─── Public entry points ─────────────────────────────────── */

void shell_install(void) {
    line_len = 0;
    /* Boot banner inside the shell. */
    console_set_color(COL_OK);
    console_puts("Astrion shell ready. Type 'help'.\n\n");
    console_set_color(COL_WHITE);
    print_prompt();
}

void shell_on_key(char c) {
    if (c == '\n') {
        line[line_len] = 0;
        console_putchar('\n');
        if (line_len > 0) dispatch(line);
        line_len = 0;
        print_prompt();
        return;
    }
    if (c == '\b') {
        if (line_len > 0) {
            line_len--;
            console_backspace();
        }
        return;
    }
    if (c >= 32 && c <= 126 && line_len < LINE_MAX - 1) {
        line[line_len++] = c;
        console_putchar(c);
    }
}

void shell_tick(void) {
    /* Reserved for future use — e.g. blinking cursor. */
}
