/*
 * Astrion v2.0 — CMOS real-time clock
 *
 * The PIT gives us uptime; this gives us the actual wall clock — the date and
 * time the machine believes it is, read straight off the RTC chip over ports
 * 0x70/0x71. No network time, no NTP, nothing to phone home to.
 */
#ifndef ASTRION_RTC_H
#define ASTRION_RTC_H

#include <stdint.h>

struct rtc_time {
    int year;    /* full year, e.g. 2026 */
    int month;   /* 1-12 */
    int day;     /* 1-31 */
    int hour;    /* 0-23 (always normalised to 24h) */
    int min;     /* 0-59 */
    int sec;     /* 0-59 */
};

/* Read the clock. Returns 0 on success, -1 if the chip looks insane. */
int  rtc_read(struct rtc_time *t);

/* 1 if the RTC answered with a plausible date at boot. */
int  rtc_present(void);

void rtc_format_time(const struct rtc_time *t, char *buf);   /* "HH:MM:SS", buf[9]  */
void rtc_format_date(const struct rtc_time *t, char *buf);    /* "YYYY-MM-DD", buf[11] */
const char *rtc_month_name(int m);                            /* "Jul", or "---" */

#endif
