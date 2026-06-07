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

static const struct cmd CMDS[] = {
    { "help",    "list available commands",          cmd_help },
    { "version", "kernel + build banner",            cmd_version },
    { "clear",   "clear the console",                cmd_clear },
    { "echo",    "echo <text>",                      cmd_echo },
    { "mem",     "show memory map summary",          cmd_mem },
    { "regs",    "dump CR0/CR2/CR3/CR4 + RFLAGS",    cmd_regs },
    { "tick",    "current PIT tick count + uptime",  cmd_tick },
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
