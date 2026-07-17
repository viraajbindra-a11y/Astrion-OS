/*
 * Astrion v2.0 — minimal ACPI table parser (poweroff path only)
 *
 * We don't want a full ACPICA. We want exactly one thing out of the firmware
 * tables: how to ask the machine to enter S5, "soft off". That is a walk of
 * RSDP -> RSDT/XSDT -> FADT for the PM1 control port, then a scan of the DSDT's
 * AML bytecode for the \_S5_ sleep-type value.
 *
 * Every byte here comes from firmware, so this is an untrusted parser: each
 * offset and length is bounds-checked `a > cap - b` before it is touched, and
 * nothing outside the identity-mapped first 4 GiB is ever dereferenced.
 *
 * Integer only, no libc — like the rest of the kernel.
 */
#ifndef ASTRION_ACPI_H
#define ASTRION_ACPI_H

#include <stdint.h>

/* Walk the ACPI tables once, at boot. Returns 1 if a complete S5 path (PM1a
 * control port + a \_S5_ sleep type) was found, 0 otherwise. Uses no
 * interrupts, so it is safe to call before the kernel's own `sti`. */
int acpi_init(void);

/* 1 if acpi_init() found a complete S5 path. */
int acpi_s5_available(void);

/* Write the S5 sleep command to the PM1 control register(s). Does nothing if
 * no port was found. This is the CLEAN poweroff; on real hardware it may still
 * fail to cut power, which is why power.c keeps I/O-port fallbacks. */
void acpi_enter_s5(void);

/* Accessors for the boot report line (0 when nothing was found). */
uint32_t acpi_pm1a_cnt_port(void);
uint32_t acpi_pm1b_cnt_port(void);
uint16_t acpi_slp_typ_a(void);
uint16_t acpi_slp_typ_b(void);

/* CMOS century-register index from the FADT (offset 108), or 0 if the firmware
 * reports none. rtc.c trusts this on real hardware and falls back to the 0x32
 * QEMU/SeaBIOS convention when it's 0. Valid only after acpi_init(). */
uint8_t acpi_century_reg(void);

#endif
