/*
 * Astrion v2.0 - In-kernel shell
 *
 * Reads chars via shell_on_key() (called from kernel_mb2_main's
 * keyboard drain loop), echoes them through the console module,
 * and on Enter dispatches to a built-in command table.
 *
 * Commands:
 *   help              - list commands.
 *   version           - kernel + build banner.
 *   clear             - clear the console region.
 *   echo <text>       - print arguments verbatim.
 *   mem               - dump the multiboot2 memory map.
 *   regs              - dump CR0/CR2/CR3/CR4 + RFLAGS + RSP.
 *   tick              - print current PIT tick count + elapsed time.
 *   panic             - trigger int $3 for fun (panic-screen demo).
 *   halt              - cli + hlt forever.
 *   art               - print an ASCII-art Astrion banner.
 *
 * Each command is just a function taking (argc, argv). argv is
 * carved out of a single input line in place - no malloc, no copy.
 */

#include <stdint.h>
#include "shell.h"
#include "console.h"
#include "pit.h"
#include "rtc.h"
#include "idt.h"
#include "snake.h"
#include "heap.h"
#include "fs.h"
#include "ata.h"
#include "task.h"
#include "wm.h"
#include "kbd.h"
#include "clipboard.h"
#include "elf.h"
#include "usermem.h"
#include "power.h"
#include "pmm.h"
#include "vmspace.h"

/* The shell's structural ink: the prompt, directory names in `ls`, help
 * section headers, the current task in `ps`. Not "accent" — accent (AC_ACCENT
 * 0x0A84FF) means focus, and it is spent on the focused window border, the
 * caret and the active dock icon. This colour is a label that repeats on
 * every line, so it has to be quiet, and 0x0A84FF is too dark to read as
 * thin monospace strokes on the navy console body anyway.
 * 0x64D2FF is AC_TEAL — the palette's "accent, as ink" — and it is already
 * what the Files window paints directory names in and what the Assistant
 * paints its own ">" prompt in (wm.c). Same concept, same colour. */
#define COL_PROMPT 0x64D2FFu     /* = AC_TEAL (desktop.h) */
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

/* The prompt carries the cwd - "astrion:/> " at the root, "astrion:/notes> "
 * inside a directory. It's the cheapest possible proof that `cd` moved us
 * somewhere real. */
static void print_prompt(void) {
    char path[FS_PATH_MAX + 1];
    console_set_color(COL_PROMPT);
    console_puts("astrion");
    console_set_color(COL_MUTED);
    console_putchar(':');
    if (fs_cwd_path(path, sizeof(path)) == 0) path[0] = 0;   /* can't happen; be safe */
    console_puts(path);
    console_set_color(COL_PROMPT);
    console_puts("> ");
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
static void cmd_shutdown(int argc, char **argv);
static void cmd_reboot(int argc, char **argv);
static void cmd_art(int argc, char **argv);
static void cmd_cpuid(int argc, char **argv);
static void cmd_uptime(int argc, char **argv);
static void cmd_date(int argc, char **argv);
static void cmd_guess(int argc, char **argv);
static void cmd_wipe(int argc, char **argv);
static void cmd_paint(int argc, char **argv);
static void cmd_snake(int argc, char **argv);
static void cmd_heap(int argc, char **argv);
static void cmd_ls(int argc, char **argv);
static void cmd_cd(int argc, char **argv);
static void cmd_pwd(int argc, char **argv);
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
static void cmd_busy(int argc, char **argv);
static void cmd_kill(int argc, char **argv);
static void cmd_exec(int argc, char **argv);
static void cmd_files(int argc, char **argv);
static void cmd_edit(int argc, char **argv);
static void cmd_assistant(int argc, char **argv);
static void cmd_monitor(int argc, char **argv);
static void cmd_clip(int argc, char **argv);
static void cmd_pmm(int argc, char **argv);
static void cmd_vmtest(int argc, char **argv);
static void cmd_vmswitch(int argc, char **argv);
static void cmd_isotest(int argc, char **argv);

static const struct cmd CMDS[] = {
    { "files",   "open the Files browser window",    cmd_files },
    { "edit",    "edit <file> - open the text editor", cmd_edit },
    { "assistant","open the Assistant window",       cmd_assistant },
    { "monitor", "open the System Monitor window",   cmd_monitor },
    { "help",    "list available commands",          cmd_help },
    { "version", "kernel + build banner",            cmd_version },
    { "clear",   "clear the console",                cmd_clear },
    { "echo",    "echo <text>",                      cmd_echo },
    { "mem",     "show memory map summary",          cmd_mem },
    { "regs",    "dump CR0/CR2/CR3/CR4 + RFLAGS",    cmd_regs },
    { "cpuid",   "CPU vendor + feature flags",       cmd_cpuid },
    { "tick",    "current PIT tick count + uptime",  cmd_tick },
    { "uptime",  "human-readable uptime",            cmd_uptime },
    { "date",    "real date + time (CMOS RTC)",      cmd_date },
    { "guess",   "play: guess my number 1..100",     cmd_guess },
    { "paint",   "drag mouse to draw ink trails",    cmd_paint },
    { "wipe",    "clear any ink trails / repaint",   cmd_wipe },
    { "snake",   "play classic Snake (arrows steer)", cmd_snake },
    { "heap",    "kernel heap stats",                cmd_heap },
    { "ls",      "list this directory (or ls <dir>)", cmd_ls },
    { "cd",      "cd <dir> - change directory (.. = up)", cmd_cd },
    { "pwd",     "print the current directory",      cmd_pwd },
    { "cat",     "print file contents",              cmd_cat },
    { "write",   "write <file> <text...>",           cmd_write },
    { "append",  "append <file> <text...>",          cmd_append },
    { "rm",      "remove a file or empty directory", cmd_rm },
    { "touch",   "create an empty file",             cmd_touch },
    { "mkdir",   "mkdir <dir> - create a directory", cmd_mkdir },
    { "sync",    "write all files to disk",          cmd_sync },
    { "clip",    "print the clipboard contents",     cmd_clip },
    { "pmm",     "physical RAM: frame allocator stats + self-test", cmd_pmm },
    { "vmtest",  "per-process address space: build + walk self-test", cmd_vmtest },
    { "vmswitch","scheduler-driven CR3 switch into a vmspace + back", cmd_vmswitch },
    { "isotest", "prove two per-process spaces isolate the same VA", cmd_isotest },
    { "disk",    "show ATA disk info",               cmd_disk },
    { "run",     "run a script (one cmd per line)",  cmd_run },
    { "exec",    "exec <file.elf> - load + run an ELF program", cmd_exec },
    { "ps",      "list scheduler tasks",             cmd_ps },
    { "spawn",   "spawn ticker - background counter", cmd_spawn },
    { "busy",    "spawn a non-yielding spinner (preempt proof)", cmd_busy },
    { "kill",    "kill <tid> - stop a task",         cmd_kill },
    { "panic",   "trigger int $3 (panic-screen demo)", cmd_panic },
    { "halt",    "stop the CPU forever",             cmd_halt },
    { "shutdown","power the machine off (ACPI S5)",  cmd_shutdown },
    { "reboot",  "restart the machine",              cmd_reboot },
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
    console_puts("triggering int $3 - see panic screen...\n");
    __asm__ volatile("int $3");
}

static void cmd_halt(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("halting - power-cycle to reboot.\n");
    for (;;) __asm__ volatile("cli; hlt");
}

static void cmd_shutdown(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("shutting down...\n");
    power_off();
    /* Only reached if no poweroff path cut power (real hardware, no ACPI S5). */
    console_set_color(COL_MUTED);
    console_puts("could not power off - it is now safe to turn the machine off.\n");
    for (;;) __asm__ volatile("cli; hlt");
}

static void cmd_reboot(int argc, char **argv) {
    (void)argc; (void)argv;
    console_set_color(COL_PROMPT);
    console_puts("restarting...\n");
    power_reboot();
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

static void cmd_date(int argc, char **argv) {
    (void)argc; (void)argv;
    struct rtc_time t;
    if (rtc_read(&t) != 0) {
        console_puts("date: no sane RTC on this machine\n");
        return;
    }
    char d[11], c[9];
    rtc_format_date(&t, d);
    rtc_format_time(&t, c);
    console_set_color(COL_OK);
    console_puts(rtc_month_name(t.month));
    console_puts(" ");
    console_put_u32((uint32_t)t.day);
    console_puts(", ");
    console_put_u32((uint32_t)t.year);
    console_set_color(COL_WHITE);
    console_puts("  ");
    console_puts(c);
    console_puts("   (");
    console_puts(d);
    console_puts(" - CMOS clock, no network time)\n");
}

static void cmd_uptime(int argc, char **argv) {
    (void)argc; (void)argv;
    char buf[9];
    pit_format_clock(buf);
    console_set_color(COL_OK);
    console_puts("up ");
    console_set_color(COL_WHITE);
    console_puts(buf);
    console_puts(" - ");
    console_put_u64(pit_ticks());
    console_puts(" ticks, ");
    console_put_u64(pit_elapsed_ms());
    console_puts(" ms\n");
}

/* ─── guess game ─────────────────────────────────────────── */

/* Simple LCG seeded from PIT ticks - not crypto, just enough for fun. */
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
        console_puts("not a number - try 'guess 42'\n");
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
extern void desktop_repaint_chrome(void);

static void cmd_wipe(int argc, char **argv) {
    (void)argc; (void)argv;
    desktop_repaint_chrome();   /* repaint the desktop (wallpaper/bar/dock/window) */
    console_clear();            /* clear the shell region */
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
    console_puts("  - cursor turns blue while drawing\n");
    console_puts("  - type 'wipe' to clear and start over\n");
}

static void cmd_snake(int argc, char **argv) {
    (void)argc; (void)argv;
    int score = snake_play();
    /* Game took over the screen; repaint the desktop. */
    desktop_repaint_chrome();
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

/* ls lists ONE directory - the cwd by default, or `ls <dir>`. The totals
 * at the bottom are that directory's, not the whole disk's. */
static void cmd_ls(int argc, char **argv) {
    fs_node *dir = fs_cwd();
    if (argc >= 2) {
        dir = fs_find(argv[1]);
        if (!dir || dir->kind != FS_DIR) {
            console_set_color(0xF87171u);
            console_puts("ls: not a directory: ");
            console_puts(argv[1]);
            console_putchar('\n');
            console_set_color(COL_WHITE);
            return;
        }
    }
    if (!fs_first_in(dir)) {
        console_set_color(COL_MUTED);
        console_puts("(empty)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("name              kind    size\n");
    console_set_color(COL_WHITE);
    uint32_t count = 0, bytes = 0;
    for (fs_node *n = fs_first_in(dir); n; n = fs_next_in(dir, n)) {
        uint32_t name_len = 0;
        const char *p = n->name;
        while (*p) { name_len++; p++; }
        console_set_color(n->kind == FS_DIR ? COL_PROMPT : COL_WHITE);
        console_puts(n->name);
        /* A trailing '/' marks a directory you can actually cd into. */
        if (n->kind == FS_DIR) { console_putchar('/'); name_len++; }
        console_set_color(COL_MUTED);
        put_pad_to(18, name_len);
        console_puts(n->kind == FS_DIR ? "dir" : "file");
        put_pad_to(26, 18 + (n->kind == FS_DIR ? 3 : 4));
        console_put_u32(n->size);
        console_puts(" B\n");
        count++;
        bytes += n->size;
    }
    console_set_color(COL_MUTED);
    console_puts("total: ");
    console_put_u32(count);
    console_puts(" entries, ");
    console_put_u32(bytes);
    console_puts(" bytes\n");
    console_set_color(COL_WHITE);
}

static void cmd_pwd(int argc, char **argv) {
    (void)argc; (void)argv;
    char path[FS_PATH_MAX + 1];
    if (fs_cwd_path(path, sizeof(path)) == 0) {
        console_set_color(0xF87171u);
        console_puts("pwd: path too long\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_puts(path);
    console_putchar('\n');
}

static void cmd_cd(int argc, char **argv) {
    /* Bare 'cd' goes home, and home is '/'. */
    const char *target = (argc >= 2) ? argv[1] : "/";
    if (fs_chdir(target) != 0) {
        console_set_color(0xF87171u);
        console_puts("cd: not a directory: ");
        console_puts(target);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
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
     * one entry per line - feels right for a log file. */
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
    /* Look first so the failure can say WHICH failure it was: a missing
     * path and a directory that still has things in it are different
     * problems, and fs_unlink returns -1 for both. */
    fs_node *n = fs_find(argv[1]);
    if (!n) {
        console_set_color(0xF87171u);
        console_puts("no such file: ");
        console_puts(argv[1]);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
    if (n->kind == FS_DIR && fs_first_in(n)) {
        console_set_color(0xF87171u);
        console_puts("rm: directory not empty: ");
        console_puts(argv[1]);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
    if (fs_unlink(argv[1]) != 0) {
        console_set_color(0xF87171u);
        console_puts("rm: cannot remove ");
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
        console_puts("usage: mkdir <dir>\n");
        console_set_color(COL_WHITE);
        return;
    }
    /* Only the last component is created - 'mkdir a/b' needs a to exist.
     * (No -p yet.) */
    if (!fs_create(argv[1], FS_DIR)) {
        console_set_color(0xF87171u);
        console_puts("mkdir failed: ");
        console_puts(argv[1]);
        console_puts(fs_find(argv[1]) ? " (exists)\n" : " (bad path?)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("mkdir ");
    console_set_color(COL_WHITE);
    console_puts(argv[1]);
    console_putchar('\n');
}

static void cmd_pmm(int argc, char **argv) {
    (void)argc; (void)argv;
    uint64_t total = pmm_frames_total();
    if (total == 0) {
        console_set_color(0xF87171u);
        console_puts("pmm: no free arena - allocator disabled\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_puts("arena  ");
    console_put_hex64(pmm_arena_base());
    console_puts(" .. ");
    console_put_hex64(pmm_arena_top());
    console_puts("\nframes ");
    console_put_u64(pmm_frames_free());
    console_puts(" free / ");
    console_put_u64(total);
    console_puts(" (");
    console_put_u64((pmm_frames_free() * 4096ull) / (1024 * 1024));
    console_puts(" MiB free)\n");

    /* Self-test: 8 frames come back distinct, aligned, zeroed and accounted,
     * and freeing them restores the count exactly. */
    uint64_t before = pmm_frames_free();
    uint64_t f[8];
    int ok = 1;
    for (int i = 0; i < 8; i++) {
        f[i] = pmm_alloc();
        if (f[i] == 0 || (f[i] & 0xFFFull)) ok = 0;
        else if (*(volatile uint64_t *)(uintptr_t)f[i] != 0) ok = 0;  /* zeroed */
        for (int j = 0; j < i; j++) if (f[j] == f[i]) ok = 0;         /* distinct */
    }
    if (pmm_frames_free() != before - 8) ok = 0;
    for (int i = 0; i < 8; i++) pmm_free(f[i]);
    if (pmm_frames_free() != before) ok = 0;

    if (ok) { console_set_color(COL_OK);   console_puts("self-test: PASS"); }
    else    { console_set_color(0xF87171u); console_puts("self-test: FAIL"); }
    console_set_color(COL_WHITE);
    console_puts(" (alloc 8 distinct zeroed frames, free 8, count restored)\n");
}

static void cmd_vmtest(int argc, char **argv) {
    (void)argc; (void)argv;
    if (pmm_frames_total() == 0) {
        console_set_color(0xF87171u);
        console_puts("vmtest: pmm disabled - no address spaces without frames\n");
        console_set_color(COL_WHITE);
        return;
    }

    /* Build a private space, map one page at the user base, and prove the walk
     * lands on our frame - all without ever loading CR3 (that's M3). Then
     * destroy it and confirm every frame came back (no leak). */
    const uint64_t uva      = USER_VA_BASE;
    const uint64_t sentinel = 0xA57210C0DEF00DULL;
    uint64_t before = pmm_frames_free();
    uint64_t frame = 0, mapped = 0, miss = 1;
    int ok = 1;

    vmspace_t *sp = vmspace_create();
    if (!sp) ok = 0;

    if (ok) {
        frame = pmm_alloc();               /* the page this uva will back onto */
        if (!frame) ok = 0;
    }
    if (ok) {
        *(volatile uint64_t *)(uintptr_t)frame = sentinel;   /* mark the frame */
        if (vmspace_map(sp, uva, frame, PTE_P | PTE_W | PTE_US) != 0) ok = 0;
    }
    if (ok) {
        mapped = vmspace_translate(sp, uva);                 /* must be our frame */
        miss   = vmspace_translate(sp, uva + 0x100000);      /* a hole -> 0 */
        if (mapped != frame) ok = 0;
        if (miss   != 0)     ok = 0;
        if (*(volatile uint64_t *)(uintptr_t)frame != sentinel) ok = 0;  /* frame intact */
    }

    if (sp) vmspace_destroy(sp);   /* frees leaf frame + PT/PD/PDPT + PML4 + handle */

    uint64_t after = pmm_frames_free();
    if (after != before) ok = 0;   /* every frame must return - no leak */

    console_puts("uva    ");
    console_put_hex64(uva);
    console_puts(" -> ");
    console_put_hex64(mapped);
    console_puts(" (frame ");
    console_put_hex64(frame);
    console_puts(")\nframes ");
    console_put_u64(before);
    console_puts(" before / ");
    console_put_u64(after);
    console_puts(" after\n");

    if (ok) { console_set_color(COL_OK);    console_puts("self-test: PASS"); }
    else    { console_set_color(0xF87171u); console_puts("self-test: FAIL"); }
    console_set_color(COL_WHITE);
    console_puts(" (create, map uva=128G, translate hit + miss, destroy, no leak)\n");
}

/* ---- vmswitch: prove a scheduler-driven CR3 switch (Tier 3, M3) -------------
 *
 * The shell builds a real per-process address space, spawns a KERNEL task bound
 * to it, and lets the SCHEDULER switch into it (loading the new CR3). The task
 * runs entirely under that space and touches only kernel memory - which is
 * mapped identically in every space, so it stays reachable across the switch. It
 * records the CR3 it actually executed under, writes a sentinel, and bumps a
 * counter; then it exits and the scheduler switches back to the kernel space.
 * We prove: (1) the task ran (sentinel + counter changed), (2) it ran under the
 * OTHER cr3 (seen == the vmspace PML4, and != kernel_cr3), (3) the box is alive,
 * (4) destroying the space returns the pmm to its exact baseline (no leak). */

#define VMSW_SENTINEL 0x5704DEADC0DE5704ULL

static volatile uint64_t vmsw_seen_cr3;   /* CR3 the task observed itself under */
static volatile uint64_t vmsw_sentinel;   /* task writes VMSW_SENTINEL here      */
static volatile uint64_t vmsw_counter;    /* task increments this once           */

static void vmswitch_task(void *arg) {
    (void)arg;
    /* Runs under the switched CR3. Read our own CR3 as hard evidence of which
     * space we are executing in, then touch ONLY kernel globals (BSS, identity-
     * mapped in every space - never the private user region). No framebuffer, no
     * heap, no yield: the smallest possible surface under the foreign CR3. */
    uint64_t cr3;
    __asm__ volatile("mov %%cr3, %0" : "=r"(cr3));
    vmsw_seen_cr3 = cr3;
    vmsw_sentinel = VMSW_SENTINEL;
    vmsw_counter++;
    /* return -> task_entry_thunk -> task_exit(): the scheduler switches away
     * (loading a different CR3) as part of the SAME schedule() that makes the
     * shell runnable again. So by the time the shell observes us DONE, the CR3 is
     * already off this vmspace - which is what makes destroy-after-DONE safe. */
}

static void cmd_vmswitch(int argc, char **argv) {
    (void)argc; (void)argv;
    if (pmm_frames_total() == 0) {
        console_set_color(0xF87171u);
        console_puts("vmswitch: pmm disabled - no address spaces without frames\n");
        console_set_color(COL_WHITE);
        return;
    }

    const uint64_t kcr3 = task_kernel_cr3();
    uint64_t before = pmm_frames_free();
    uint64_t space_cr3 = 0, seen = 0, cnt_before = vmsw_counter;
    int ok = 1, mapped = 0, finished = 0, tid = -1;

    /* Build a space that GENUINELY differs from the kernel space: vmspace_create
     * mints a fresh PML4 frame (and forks PML4[0] into a private PDPT), so its
     * PML4 phys is != kernel_cr3. (If it matched kernel_cr3, "switching" would
     * prove nothing.) The page frame is owned by the space and freed by destroy. */
    vmspace_t *sp = vmspace_create();
    if (!sp) ok = 0;
    uint64_t page = 0;
    if (ok) { page = pmm_alloc(); if (!page) ok = 0; }
    if (ok) {
        if (vmspace_map(sp, USER_VA_BASE, page, PTE_P | PTE_W | PTE_US) == 0) mapped = 1;
        else ok = 0;
    }
    if (ok) {
        space_cr3 = sp->pml4_phys;
        if (space_cr3 == kcr3) ok = 0;          /* must be a different space */
    }

    if (ok) {
        /* Arm the proof state, THEN spawn - so a stale value from a prior run
         * can't fake a pass, and the task (spawned after) runs under sp from its
         * first slice (cr3 bound under the spawn lock, before it is READY). */
        vmsw_seen_cr3 = 0;
        vmsw_sentinel = 0;
        tid = task_spawn_in_space("vmswitch", vmswitch_task, 0, space_cr3);
        if (tid < 0) ok = 0;
    }

    if (ok) {
        /* Let the scheduler run it, and wait for its STATE to leave the runnable
         * set (DONE, or reaped to UNUSED) - NOT a task-set flag. State only flips
         * inside task_exit's final schedule(), which has ALREADY switched CR3 off
         * sp before the shell resumes. Gating destroy on this (not on the task's
         * own "done" write, which can be observed while it is still preemptible
         * and READY under sp) is what makes freeing the space race-free. Bounded
         * so a wedge can never hang the shell. */
        struct task_info ti;
        for (int spins = 0; spins < 5000000; spins++) {
            if (!task_get_info(tid, &ti) || ti.state == TASK_DONE) { finished = 1; break; }
            task_yield();
        }
        if (!finished) ok = 0;   /* never completed - see cleanup: do NOT free sp */
    }

    /* Evidence the task really executed under the switched CR3. */
    seen = vmsw_seen_cr3;
    if (ok) {
        if (vmsw_sentinel != VMSW_SENTINEL)   ok = 0;   /* it ran                */
        if (vmsw_counter  != cnt_before + 1)  ok = 0;   /* exactly once          */
        if (seen != space_cr3)                ok = 0;   /* under the new cr3     */
        if (seen == kcr3)                     ok = 0;   /* not the kernel space  */
    }

    /* Destroy the space ONLY when no live task is still bound to it: either the
     * task finished (its CR3 is no longer active anywhere) or it never spawned.
     * If it somehow didn't finish, leak the space deliberately rather than free
     * page tables a live CR3 might still point at - a leak is a FAIL, a freed
     * live CR3 is a triple-fault. */
    int safe = (tid < 0) || finished;
    if (sp && safe) vmspace_destroy(sp);          /* frees PML4 + tables (+ leaf if mapped) */
    if (page && !mapped && safe) pmm_free(page);  /* orphaned leaf: destroy didn't own it   */

    uint64_t after = pmm_frames_free();
    if (after != before) ok = 0;   /* every frame must return - no leak */

    console_puts("kernel cr3 ");
    console_put_hex64(kcr3);
    console_puts("\nspace  cr3 ");
    console_put_hex64(space_cr3);
    console_puts("\ntask ran   ");
    console_put_hex64(seen);
    console_puts("\nsentinel   ");
    console_put_hex64(vmsw_sentinel);
    console_puts("\ncounter    ");
    console_put_u64(cnt_before);
    console_puts(" -> ");
    console_put_u64(vmsw_counter);
    console_puts("\nframes     ");
    console_put_u64(before);
    console_puts(" before / ");
    console_put_u64(after);
    console_puts(" after\n");

    if (ok) { console_set_color(COL_OK);    console_puts("self-test: PASS"); }
    else    { console_set_color(0xF87171u); console_puts("self-test: FAIL"); }
    console_set_color(COL_WHITE);
    console_puts(" (scheduler switched CR3 into a vmspace task and back, no leak)\n");
}

/* ---- isotest: prove two per-process spaces ISOLATE the same VA (Tier 3, M4) --
 *
 * Builds two vmspaces exactly the way exec does — create, then map one page at
 * USER_VA_BASE — and proves the isolation exec now delivers, without switching
 * CR3 (the page-table walk IS the MMU's own translation):
 *   1. translate(A, USER_VA_BASE) != translate(B, USER_VA_BASE): the SAME user
 *      virtual address resolves to DIFFERENT physical frames in the two spaces.
 *   2. distinct sentinels written through each frame read back intact — neither
 *      space can observe the other's write at that address (different RAM).
 *   3. destroying both returns the pmm to its exact baseline: no leak.
 * The LIVE runtime form of this is `exec` itself — two programs at the same
 * USER_VA_BASE, each under its own CR3, physically unable to see each other. */

#define ISO_SENT_A 0xA11CE55A9E27ED11ULL
#define ISO_SENT_B 0xB0B0CAFE5AFE5111ULL

static void cmd_isotest(int argc, char **argv) {
    (void)argc; (void)argv;
    if (pmm_frames_total() == 0) {
        console_set_color(0xF87171u);
        console_puts("isotest: pmm disabled - no address spaces without frames\n");
        console_set_color(COL_WHITE);
        return;
    }

    uint64_t before = pmm_frames_free();
    vmspace_t *A = 0, *B = 0;
    uint64_t pa = 0, pb = 0, fa = 0, fb = 0;
    int ok = 1, a_mapped = 0, b_mapped = 0;
    int a_sees_a = 0, b_sees_b = 0, a_isolated = 0, b_isolated = 0;

    A = vmspace_create();
    B = vmspace_create();
    if (!A || !B) ok = 0;

    if (ok) {
        pa = pmm_alloc();
        pb = pmm_alloc();
        if (!pa || !pb) ok = 0;
    }
    if (ok) {
        if (vmspace_map(A, USER_VA_BASE, pa, PTE_P | PTE_W | PTE_US) == 0) a_mapped = 1; else ok = 0;
        if (vmspace_map(B, USER_VA_BASE, pb, PTE_P | PTE_W | PTE_US) == 0) b_mapped = 1; else ok = 0;
    }
    if (ok) {
        fa = vmspace_translate(A, USER_VA_BASE);
        fb = vmspace_translate(B, USER_VA_BASE);
        if (fa == 0 || fb == 0) ok = 0;
        if (fa == fb)           ok = 0;   /* same VA MUST land on different frames */
    }
    if (ok) {
        /* Write a distinct sentinel through each frame's identity address, then
         * read both back. If the two USER_VA_BASE mappings aliased the same RAM,
         * B's write would clobber A's frame and this would catch it. */
        *(volatile uint64_t *)(uintptr_t)fa = ISO_SENT_A;
        *(volatile uint64_t *)(uintptr_t)fb = ISO_SENT_B;
        a_sees_a   = (*(volatile uint64_t *)(uintptr_t)fa == ISO_SENT_A);
        b_sees_b   = (*(volatile uint64_t *)(uintptr_t)fb == ISO_SENT_B);
        a_isolated = (*(volatile uint64_t *)(uintptr_t)fa != ISO_SENT_B);  /* A never sees B's write */
        b_isolated = (*(volatile uint64_t *)(uintptr_t)fb != ISO_SENT_A);  /* B never sees A's write */
        if (!(a_sees_a && b_sees_b && a_isolated && b_isolated)) ok = 0;
    }

    if (A) vmspace_destroy(A);   /* frees each space's PML4 + tables + its leaf frame */
    if (B) vmspace_destroy(B);
    if (pa && !a_mapped) pmm_free(pa);   /* orphaned leaf: destroy didn't own it */
    if (pb && !b_mapped) pmm_free(pb);

    uint64_t after = pmm_frames_free();
    if (after != before) ok = 0;   /* every frame must return - no leak */

    console_puts("A: uva ");
    console_put_hex64(USER_VA_BASE);
    console_puts(" -> frame ");
    console_put_hex64(fa);
    console_puts("\nB: uva ");
    console_put_hex64(USER_VA_BASE);
    console_puts(" -> frame ");
    console_put_hex64(fb);
    console_puts("\ndistinct frames    ");
    console_puts(fa != fb ? "yes" : "no");
    console_puts("\nA isolated from B  ");
    console_puts(a_isolated ? "yes" : "no");
    console_puts("\nB isolated from A  ");
    console_puts(b_isolated ? "yes" : "no");
    console_puts("\nframes ");
    console_put_u64(before);
    console_puts(" before / ");
    console_put_u64(after);
    console_puts(" after\n");

    if (ok) { console_set_color(COL_OK);    console_puts("self-test: PASS"); }
    else    { console_set_color(0xF87171u); console_puts("self-test: FAIL"); }
    console_set_color(COL_WHITE);
    console_puts(" (two spaces, same VA -> distinct frames, no cross-visibility, no leak)\n");
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
    if (r == -2) {   /* refused to protect data, not a write error */
        console_set_color(0xF87171u);
        console_puts("sync: refused - too many files to save back safely.\n");
        console_puts("      nothing was written; your files are safe. delete some and retry.\n");
        console_set_color(COL_WHITE);
        return;
    }
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
    console_puts(" bytes) saved to disk - reboot will restore them\n");
}

/* Print the current clipboard - makes a copy verifiable without a second app
 * (copy a line in the editor, then `clip` here to see it). */
static void cmd_clip(int argc, char **argv) {
    (void)argc; (void)argv;
    uint32_t n = clipboard_len();
    if (n == 0) {
        console_set_color(COL_MUTED);
        console_puts("clipboard is empty\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_MUTED);
    console_puts("clipboard (");
    console_put_u32(n);
    console_puts(" bytes):\n");
    console_set_color(COL_WHITE);
    console_puts(clipboard_get());   /* always NUL-terminated */
    console_putchar('\n');
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
 * proof of multitasking - it counts while you type, while scripts
 * run, while Snake plays. */
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale);
extern uint32_t fb_width_x(void);
/* Both counters below paint from their OWN task, so they can land on top of a
 * resting mouse cursor. They can't lift it (they preempt task 0, which may be
 * inside the cursor's pixel loops) — they flag the damage and the main loop
 * repairs it. Without this, parking the pointer on a counter caches its pixels
 * and stamps them back a tenth of a second later. */
extern void     mouse_invalidate_rect(int x, int y, int w, int h);

static void ticker_task(void *arg) {
    (void)arg;
    uint32_t n = 0;
    uint64_t last = 0;
    uint32_t x = fb_width_x() - 380;
    for (;;) {
        uint64_t now = pit_elapsed_ms();
        if (now - last >= 100) {
            last = now;
            mouse_invalidate_rect((int)x - 6, 26, 150, 32);
            fb_rect_x(x - 6, 26, 150, 32, 0x1E2761u);
            fb_put_u32_x(x, 30, n, 0x4ADE80u, 2);
            n++;
        }
        task_yield();
    }
}

/* The PREEMPTION proof. This task NEVER calls task_yield — it just
 * spins, burning a few million iterations between repaints. Under the
 * old cooperative scheduler it would wedge the whole machine (the clock
 * would freeze, the shell would go dead). Under preemption the timer
 * forcibly deschedules it every tick, so the shell stays responsive and
 * the clock keeps ticking while this red counter climbs. */
static void busy_task(void *arg) {
    (void)arg;
    volatile uint64_t spin = 0;
    uint32_t n = 0;
    uint32_t x = fb_width_x() - 620;
    for (;;) {
        /* Burn CPU with no yield. ~8M iterations ≈ a visible beat. */
        for (uint32_t i = 0; i < 8000000; i++) spin++;
        mouse_invalidate_rect((int)x - 6, 26, 150, 32);
        fb_rect_x(x - 6, 26, 150, 32, 0x1E2761u);
        fb_put_u32_x(x, 30, n, 0xF87171u, 2);   /* red: "I never yield" */
        n++;
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

static void cmd_busy(int argc, char **argv) {
    (void)argc; (void)argv;
    int tid = task_spawn("busy", busy_task, 0);
    if (tid < 0) {
        console_set_color(0xF87171u);
        console_puts("busy: spawn failed (task table full?)\n");
        console_set_color(COL_WHITE);
        return;
    }
    console_set_color(COL_OK);
    console_puts("spawned ");
    console_set_color(COL_WHITE);
    console_puts("busy spinner as tid ");
    console_put_u32((uint32_t)tid);
    console_puts(" - it NEVER yields (red counter).\n");
    console_set_color(COL_MUTED);
    console_puts("  preemption proof: shell + clock stay alive anyway. 'kill ");
    console_put_u32((uint32_t)tid);
    console_puts("' stops it.\n");
    console_set_color(COL_WHITE);
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

/* ─── window-manager app launchers ─────────────────────────────── */
static void cmd_files(int argc, char **argv) {
    (void)argc; (void)argv;
    wm_open_app(1);   /* Files browser */
}
static void cmd_edit(int argc, char **argv) {
    wm_open_editor(argc > 1 ? argv[1] : 0);   /* editor, optional filename */
}
static void cmd_assistant(int argc, char **argv) {
    (void)argc; (void)argv;
    wm_open_app(4);   /* Assistant (Tier 2 fills it in) */
}
static void cmd_monitor(int argc, char **argv) {
    (void)argc; (void)argv;
    wm_open_app(5);   /* System Monitor — the GUI form of `ps` + `heap` */
}

/* ─── exec: load + run an ELF program in its OWN address space (Tier 3, M4) ──
 *
 * Each exec builds a PRIVATE vmspace: image + user-stack frames come from the
 * pmm, are mapped at USER_VA_BASE (P|W|US) into THAT space, and the relocated
 * image is copied into them via their identity addresses. The ring-3 task runs
 * under that space's CR3 (task_spawn_user_space), so two programs loaded at the
 * same virtual address live on different physical frames under different page
 * tables — they physically cannot see each other's memory. (The old shared
 * user_pool at 128 GiB is retired for exec; usermem.c stays only as the now-
 * vestigial window + the syscall-validation helpers.)
 *
 * From ring 3 the program reaches the kernel ONLY through `syscall` (syscall.c);
 * it cannot touch kernel memory, and any fault (bad pointer, privileged insn,
 * div0) traps and kills just that task — the fault happens in its OWN space now,
 * and reap reclaims the space. It runs preemptibly, so even an infinite loop
 * can't wedge the shell; 'kill <tid>' recovers it.
 */
extern void enter_user(uint64_t rip, uint64_t user_stack_top);  /* usermode.S — never returns */

#define USER_STACK_FRAMES 4   /* 16 KiB ring-3 stack */

/* Heap context handed to the spawned task: where to enter ring 3 and the top of
 * its user stack. The task OWNS it — task_spawn_user_space records free_arg=1, so
 * reap_done frees it when the task leaves the runnable set. That one free-path
 * covers a normal exit AND a kill-before-run (this ctx never being read), with no
 * double-free (F1). */
struct exec_ctx {
    uint64_t entry;            /* user VA of the program entry point */
    uint64_t user_stack_top;   /* user VA, 16-aligned */
};

static void exec_trampoline(void *arg) {
    struct exec_ctx *ec = (struct exec_ctx *)arg;
    uint64_t entry = ec->entry;
    uint64_t ustk  = ec->user_stack_top;
    /* Do NOT free ec here. The task owns it (free_arg=1) and reap_done reclaims
     * it when the task leaves the runnable set — one free-path that also covers a
     * task killed before it ever runs (F1). We've copied the two fields we need
     * into locals, so enter_user (which never returns) doesn't touch ec. */
    enter_user(entry, ustk);   /* iretq to CPL 3 */
}

/* Build the per-process address space `exec` runs a program in. Allocate the
 * image + user-stack frames from the pmm and map them CONTIGUOUSLY at
 * USER_VA_BASE (P|W|US) into a fresh vmspace; copy the already-relocated image
 * (`img`, laid out as if based at USER_VA_BASE) into the image frames via their
 * identity (phys == kernel-ptr) addresses. Stack frames stay as pmm_alloc handed
 * them out — zeroed. Because the frames are mapped exactly [0, total_frames)
 * with no gaps, [USER_VA_BASE, USER_VA_BASE + total_frames*4K) is fully backed.
 *
 * On success *out_sp owns every frame + private table (all reclaimed by
 * vmspace_destroy when the task is reaped). On failure nothing leaks: the
 * current un-mapped leaf is freed and the partial space destroyed here, and an
 * error string is returned. Never loads CR3 — the space is inert until a task
 * bound to it is scheduled in. */
static const char *exec_build_space(const uint8_t *img,
                                    uint32_t image_frames, uint32_t total_frames,
                                    vmspace_t **out_sp) {
    vmspace_t *sp = vmspace_create();
    if (!sp) return "out of physical memory";

    for (uint32_t i = 0; i < total_frames; i++) {
        uint64_t fr = pmm_alloc();                     /* zeroed identity-mapped frame */
        if (!fr) { vmspace_destroy(sp); return "out of physical memory"; }
        if (i < image_frames)
            elf_copy_bytes((uint8_t *)(uintptr_t)fr,
                           img + (uint64_t)i * USER_FRAME_SIZE, USER_FRAME_SIZE);
        uint64_t uva = USER_VA_BASE + (uint64_t)i * USER_FRAME_SIZE;
        if (vmspace_map(sp, uva, fr, PTE_P | PTE_W | PTE_US) != 0) {
            pmm_free(fr);          /* not installed -> destroy won't own it */
            vmspace_destroy(sp);   /* reclaims every already-mapped frame + tables */
            return "cannot map user page";
        }
    }
    *out_sp = sp;
    return 0;
}

static void cmd_exec(int argc, char **argv) {
    if (argc < 2) {
        console_set_color(COL_MUTED);
        console_puts("usage: exec <file.elf>\n");
        console_set_color(COL_WHITE);
        return;
    }
    fs_node *n = fs_find(argv[1]);
    if (!n || n->kind != FS_FILE) {
        console_set_color(0xF87171u);
        console_puts("exec: no such file: ");
        console_puts(argv[1]);
        console_putchar('\n');
        console_set_color(COL_WHITE);
        return;
    }
    uint32_t sz = n->size;
    if (sz == 0) {
        console_set_color(0xF87171u);
        console_puts("exec: empty file\n");
        console_set_color(COL_WHITE);
        return;
    }
    /* Snapshot the file bytes before parsing (same guard as cmd_run): a
     * program is data from a file node, and the loader must only ever
     * touch our private copy — never the live FS buffer. */
    uint8_t *buf = (uint8_t *)kmalloc(sz);
    if (!buf) {
        console_set_color(0xF87171u);
        console_puts("exec: out of memory\n");
        console_set_color(COL_WHITE);
        return;
    }
    for (uint32_t i = 0; i < sz; i++) buf[i] = n->data[i];

    /* Size the image, then work out how many frames image + stack need. */
    uint64_t span = 0;
    const char *err = elf_probe(buf, sz, &span);
    if (err) { kfree(buf); goto fail_msg; }

    uint32_t image_frames = (uint32_t)((span + USER_FRAME_SIZE - 1) / USER_FRAME_SIZE);
    uint32_t total_frames = image_frames + USER_STACK_FRAMES;

    /* Relocate the image into a temporary CONTIGUOUS kernel buffer, based at
     * USER_VA_BASE (where it will run in its own space). The audited loader
     * writes to one contiguous dst; the per-process frames are not physically
     * contiguous, so this buffer is the bridge — it lets us reuse elf_load_at
     * untouched, then scatter the result into the frames page by page. kcalloc
     * zeroes it, so the tail of the last image page (span..img_cap) is 0. */
    uint64_t img_cap = (uint64_t)image_frames * USER_FRAME_SIZE;
    uint8_t *img = (uint8_t *)kcalloc(1, img_cap);
    if (!img) {
        kfree(buf);
        console_set_color(0xF87171u);
        console_puts("exec: out of memory\n");
        console_set_color(COL_WHITE);
        return;
    }
    uint64_t entry_va = 0;
    err = elf_load_at(buf, sz, img, img_cap, USER_VA_BASE, &entry_va, &span);
    kfree(buf);
    if (err) { kfree(img); goto fail_msg; }

    /* Build the private space: alloc + map the frames, copy the image in. */
    vmspace_t *sp = 0;
    err = exec_build_space(img, image_frames, total_frames, &sp);
    kfree(img);                    /* copied into the frames; the bridge is done */
    if (err) goto fail_msg;

    /* Initial user RSP. _start is a GCC-compiled function, so it expects the
     * post-`call` alignment rsp ≡ 8 (mod 16); the region top is frame-aligned
     * (16-aligned), so bias by 8 (same reasoning as task.c's stack fabrication).
     * user_top is the exclusive top of the mapped region — the bound this
     * process's own syscall pointers validate against. */
    uint64_t user_top       = USER_VA_BASE + (uint64_t)total_frames * USER_FRAME_SIZE;
    uint64_t user_stack_top = user_top - 8;

    struct exec_ctx *ec = (struct exec_ctx *)kmalloc(sizeof(*ec));
    if (!ec) {
        vmspace_destroy(sp);       /* not spawned -> never a live CR3 -> safe to free */
        console_set_color(0xF87171u);
        console_puts("exec: out of memory\n");
        console_set_color(COL_WHITE);
        return;
    }
    ec->entry = entry_va;
    ec->user_stack_top = user_stack_top;

    /* Spawn the ring-3 task bound to sp's CR3, with sp OWNED by the task so reap
     * destroys it on exit/kill. The binding is recorded ATOMICALLY under the
     * spawn lock, before the task is READY: rogue.elf faults the instant it
     * runs, so the space must be on record (or it would leak) before it can be
     * scheduled, faulted, and reaped. */
    int tid = task_spawn_user_space(argv[1], exec_trampoline, ec, sp, user_top);
    if (tid < 0) {
        vmspace_destroy(sp);
        kfree(ec);
        console_set_color(0xF87171u);
        console_puts("exec: cannot spawn task\n");
        console_set_color(COL_WHITE);
        return;
    }

    console_set_color(COL_OK);
    console_puts("exec: ");
    console_set_color(COL_WHITE);
    console_puts("launched ");
    console_puts(argv[1]);
    console_puts(" in ring 3 as tid ");
    console_put_u32((uint32_t)tid);
    console_putchar('\n');
    return;

fail_msg:
    console_set_color(0xF87171u);
    console_puts("exec: ");
    console_puts(err);
    console_putchar('\n');
    console_set_color(COL_WHITE);
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
    /* Nested redirect isn't supported - capture state + redirect_buf are
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
    /* Unknown - print to console regardless of capture state. */
    if (redir_file) console_clear_capture();
    console_set_color(0xF87171u);
    console_puts("unknown command: ");
    console_puts(argv[0]);
    console_puts(" - try 'help'\n");
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
 * per-call line buffer must be on the STACK, not static - a static
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
        console_puts(") - recursive script?\n");
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
     * out from under us - a use-after-free if we kept indexing the
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
    if (c == KEY_CTRL_V) {   /* paste the clipboard into the input line */
        const char *p = clipboard_get();
        for (int k = 0; p[k] && line_len < LINE_MAX - 1; k++) {
            char ch = p[k];
            if (ch < 32 || ch > 126) continue;   /* one printable line, no newlines */
            line[line_len++] = ch;
            console_putchar(ch);
        }
        return;
    }
    if (c >= 32 && c <= 126 && line_len < LINE_MAX - 1) {
        line[line_len++] = c;
        console_putchar(c);
    }
}

void shell_tick(void) {
    /* Reserved for future use - e.g. blinking cursor. */
}
