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

/* ─── Parser ─────────────────────────────────────────────── */

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

    for (const struct cmd *c = CMDS; c->name; c++) {
        if (streq(argv[0], c->name)) { c->fn(argc, argv); return; }
    }

    console_set_color(0xF87171u);  /* red */
    console_puts("unknown command: ");
    console_puts(argv[0]);
    console_puts(" — try 'help'\n");
    console_set_color(COL_WHITE);
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
