/*
 * Astrion v2.0 — CMOS real-time clock (see rtc.h).
 *
 * Reading the RTC is fiddly for two reasons, and both are handled here:
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

static uint8_t cmos_read(uint8_t reg) {
    outb(CMOS_ADDR, reg);
    return inb(CMOS_DATA);
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

    /* Read until two consecutive reads agree — see note (1) above. */
    read_raw(&a);
    do {
        b = a;
        read_raw(&a);
        if (raw_eq(&a, &b)) break;
    } while (--tries);

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

    /* The century register is only meaningful if the firmware populates it;
     * accept it when it's plausible, otherwise assume this century. */
    int year = (a.cent >= 19 && a.cent <= 21) ? (a.cent * 100 + a.yr)
                                              : (2000 + a.yr);

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
