/*
 * Astrion v2.0 — CMOS real-time clock (see rtc.h).
 *
 * Reading the RTC is fiddly for three reasons, and all three are handled here:
 *
 *  1. The chip updates itself once a second. Read it mid-update and you get
 *     garbage (e.g. 10:59:60). So we wait for the update-in-progress flag to
 *     clear, then read the whole set TWICE and only accept it when two reads
 *     agree — that closes the window where a tick lands between our reads.
 *
 *  2. The format is not fixed. Register B says whether values are BCD or
 *     binary, and whether hours are 24h or 12h+PM-bit. We normalise both.
 *     The PM bit must be stripped BEFORE any BCD conversion, or it corrupts
 *     the digits.
 *
 *  3. The chip has ONE index latch, shared by everyone. Selecting a register
 *     and reading it are two separate port accesses, and the scheduler is
 *     preemptive — three tasks read this clock (the top-bar clock, `date`,
 *     and the assistant). A tick landing between the two accesses lets another
 *     task's index win, and you read the wrong register into the wrong field:
 *     the year lands in `sec`, and sec=26 is perfectly plausible, so it passes
 *     validation and quietly reports a wrong time. So the pair is atomic.
 *
 * When the chip looks wrong we return -1 rather than guessing. A caller that
 * gets -1 falls back to uptime, which is honest; a confident wrong date is not.
 *
 * Integer only, no libc — like the rest of the kernel.
 */
#include <stdint.h>
#include "rtc.h"

#define CMOS_ADDR 0x70
#define CMOS_DATA 0x71

#define REG_SEC   0x00
#define REG_MIN   0x02
#define REG_HOUR  0x04
#define REG_DAY   0x07
#define REG_MON   0x08
#define REG_YEAR  0x09
#define REG_CENT  0x32
#define REG_STA   0x0A
#define REG_STB   0x0B

static inline void outb(uint16_t port, uint8_t v) {
    __asm__ volatile("outb %0, %1" : : "a"(v), "Nd"(port));
}
static inline uint8_t inb(uint16_t port) {
    uint8_t r;
    __asm__ volatile("inb %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

/* Mask interrupts, handing back the previous IF so it can be put back exactly
 * as it was. rtc_read runs at boot BEFORE the kernel's own `sti`, so a blind
 * sti here would switch interrupts on early, part-way through device setup.
 * Save and restore; never assume. */
static inline uint64_t irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) : : "memory");
    return f;
}
static inline void irq_restore(uint64_t f) {
    if (f & 0x200) __asm__ volatile("sti" ::: "memory");   /* IF was set */
}

/* Bit 7 of the index port is the NMI-disable bit — it rides along with every
 * register number we write. The port is write-only, so the hardware can't tell
 * us the current setting; we shadow it here and OR it back in on every access.
 * Writing a bare register number would clear bit 7 and silently re-enable NMI
 * on every single clock read. Nothing else in the kernel disables NMI today,
 * so this stays 0 — but the bit is now preserved through one choke point
 * instead of being clobbered, so future NMI code composes correctly. */
static uint8_t nmi_disable_bit = 0x00;

static uint8_t cmos_read(uint8_t reg) {
    /* Index write + data read are ONE transaction — see note (3) up top.
     * Deliberately narrow: the mask covers only this pair, so the bounded
     * spin in settle() re-enables interrupts between polls and a dead chip
     * can't hold the box silent for the whole guard count. */
    uint64_t f = irq_save();
    outb(CMOS_ADDR, (uint8_t)(nmi_disable_bit | (reg & 0x7F)));
    uint8_t v = inb(CMOS_DATA);
    irq_restore(f);
    return v;
}

static int update_in_progress(void) { return cmos_read(REG_STA) & 0x80; }

static uint8_t bcd2bin(uint8_t v) { return (uint8_t)((v & 0x0F) + ((v >> 4) * 10)); }

/* Wait out an in-progress update, bounded so a dead chip can't hang the box. */
static void settle(void) {
    int guard = 1000000;
    while (update_in_progress() && --guard) { }
}

struct raw { uint8_t sec, min, hour, day, mon, yr, cent; };

static void read_raw(struct raw *r) {
    settle();
    r->sec  = cmos_read(REG_SEC);
    r->min  = cmos_read(REG_MIN);
    r->hour = cmos_read(REG_HOUR);
    r->day  = cmos_read(REG_DAY);
    r->mon  = cmos_read(REG_MON);
    r->yr   = cmos_read(REG_YEAR);
    r->cent = cmos_read(REG_CENT);
}

static int raw_eq(const struct raw *a, const struct raw *b) {
    return a->sec == b->sec && a->min == b->min && a->hour == b->hour &&
           a->day == b->day && a->mon == b->mon && a->yr  == b->yr  &&
           a->cent == b->cent;
}

int rtc_read(struct rtc_time *t) {
    struct raw a, b;
    int tries = 8;
    int agreed = 0;

    /* Read until two consecutive reads agree — see note (1) above. */
    read_raw(&a);
    do {
        b = a;
        read_raw(&a);
        if (raw_eq(&a, &b)) { agreed = 1; break; }
    } while (--tries);

    /* Eight tries and never two matching reads: the chip is changing under us
     * every time we look, or it isn't answering sensibly. Using the last read
     * anyway would be pretending we succeeded. */
    if (!agreed) return -1;

    uint8_t regB = cmos_read(REG_STB);
    uint8_t hour = a.hour;

    /* Strip the PM flag BEFORE converting BCD — note (2). */
    int pm = 0;
    if (!(regB & 0x02) && (hour & 0x80)) { pm = 1; hour &= 0x7F; }

    if (!(regB & 0x04)) {                 /* values are BCD -> binary */
        a.sec  = bcd2bin(a.sec);
        a.min  = bcd2bin(a.min);
        hour   = bcd2bin(hour);
        a.day  = bcd2bin(a.day);
        a.mon  = bcd2bin(a.mon);
        a.yr   = bcd2bin(a.yr);
        a.cent = bcd2bin(a.cent);
    }

    if (!(regB & 0x02)) {                 /* 12-hour -> 24-hour */
        if (pm)            hour = (uint8_t)((hour % 12) + 12);
        else if (hour == 12) hour = 0;
    }

    /* The century register is only meaningful if the firmware populates it.
     * If it's out of range we do NOT know the century, and assuming 2000 turns
     * "I don't know" into a confidently wrong year with no way for the caller
     * to tell. Fail closed instead and let them fall back to uptime. */
    if (a.cent < 19 || a.cent > 21) return -1;
    int year = a.cent * 100 + a.yr;

    t->sec = a.sec; t->min = a.min; t->hour = hour;
    t->day = a.day; t->month = a.mon; t->year = year;

    if (t->sec > 59 || t->min > 59 || t->hour > 23 ||
        t->day < 1 || t->day > 31 || t->month < 1 || t->month > 12 ||
        t->year < 1970 || t->year > 2199)
        return -1;
    return 0;
}

int rtc_present(void) {
    struct rtc_time t;
    return rtc_read(&t) == 0;
}

static void two(char *b, int v) {
    b[0] = (char)('0' + (v / 10) % 10);
    b[1] = (char)('0' + v % 10);
}

void rtc_format_time(const struct rtc_time *t, char *buf) {
    two(buf, t->hour); buf[2] = ':';
    two(buf + 3, t->min); buf[5] = ':';
    two(buf + 6, t->sec); buf[8] = 0;
}

void rtc_format_date(const struct rtc_time *t, char *buf) {
    int y = t->year;
    buf[0] = (char)('0' + (y / 1000) % 10);
    buf[1] = (char)('0' + (y / 100) % 10);
    buf[2] = (char)('0' + (y / 10) % 10);
    buf[3] = (char)('0' + y % 10);
    buf[4] = '-';
    two(buf + 5, t->month); buf[7] = '-';
    two(buf + 8, t->day);   buf[10] = 0;
}

const char *rtc_month_name(int m) {
    static const char *const names[] = {
        "---", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    };
    if (m < 1 || m > 12) return names[0];
    return names[m];
}
