/*
 * Astrion v2.0 — machine power control
 *
 * Turning the box off and restarting it — the two things every OS is expected
 * to do and Astrion could not, until now. `halt` only parks the CPU; this
 * actually cuts power (ACPI S5, with QEMU's I/O poweroff ports as a fallback)
 * and actually reboots (8042 pulse, triple-fault as last resort).
 *
 * This is the mechanism only. The UI that decides WHEN to call it lives
 * elsewhere; it just needs these three entry points.
 */
#ifndef ASTRION_POWER_H
#define ASTRION_POWER_H

/* 1 if we found a usable clean poweroff path at boot, 0 otherwise.
 * Even when this is 0, power_off() will still TRY the QEMU fallback ports —
 * but on real hardware with no path found it may fail to cut power, and the
 * caller should be prepared to show a "safe to turn off" screen. */
int  power_available(void);

/* Cut power to the machine. Does NOT return on success; on hardware where no
 * poweroff path works it falls through and returns to the caller, so the UI
 * must handle the (rare) case where control comes back. */
void power_off(void);

/* Restart the machine. Does NOT return on success. */
void power_reboot(void);

#endif
