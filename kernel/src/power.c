/*
 * Astrion v2.0 — machine power control (see power.h).
 *
 * Two jobs, each with a clean path and honest fallbacks:
 *
 *   power_off()
 *     1. ACPI S5 — the real, spec'd soft-off. acpi.c parsed the PM1a control
 *        port and the S5 sleep type at boot; we write SLP_TYPa | SLP_EN.
 *     2. The QEMU I/O poweroff ports (0x604 and 0xB004). These are how QEMU
 *        and a few firmwares expose S5 directly; writing 0x2000 (SLP_EN,
 *        SLP_TYP 0) cuts power. On QEMU one of these always works, even if our
 *        ACPI parse was imperfect. On other hardware they're harmless stray
 *        writes to unused ports.
 *     If neither cuts power (real hardware with no path we found), the function
 *     RETURNS. The caller is expected to then tell the user it is safe to turn
 *     the machine off by hand.
 *
 *   power_reboot()
 *     1. Pulse the 8042 keyboard controller's reset line (command 0xFE) after
 *        waiting, bounded, for its input buffer to drain.
 *     2. Triple-fault: load a zero-length IDT and raise #BP. With no gate to
 *        dispatch it the CPU escalates fault -> double -> triple and resets.
 *     Reboot is far more reliable than poweroff; this effectively never falls
 *     through.
 *
 * Integer only, no libc, no floats — like the rest of the kernel.
 */
#include <stdint.h>
#include "power.h"
#include "acpi.h"

static inline void outb(uint16_t port, uint8_t v) {
    __asm__ volatile("outb %0, %1" : : "a"(v), "Nd"(port));
}
static inline void outw(uint16_t port, uint16_t v) {
    __asm__ volatile("outw %0, %1" : : "a"(v), "Nd"(port));
}
static inline uint8_t inb(uint16_t port) {
    uint8_t r;
    __asm__ volatile("inb %1, %0" : "=a"(r) : "Nd"(port));
    return r;
}

int power_available(void) {
    /* "Clean path usable" = we parsed a real ACPI S5 target. The QEMU I/O ports
     * are always tried as a fallback, but they aren't a clean path on real
     * hardware, so they don't count toward this answer. */
    return acpi_s5_available();
}

void power_off(void) {
    __asm__ volatile("cli");

    /* 1. The clean path: ACPI S5. No-op if acpi.c found no port. */
    acpi_enter_s5();

    /* 2. Pragmatic fallback: QEMU / Bochs poweroff ports. Word write of
     *    SLP_EN | (SLP_TYP 0) = 0x2000. */
    outw(0x604, 0x2000);
    outw(0xB004, 0x2000);

    /* Still running: no poweroff path worked (real hardware, no ACPI S5 found).
     * Return to the caller so the UI can show "it is now safe to turn off".
     * Deliberately no hlt-loop here — that would strand the machine on a black
     * screen instead of letting the caller draw. */
}

void power_reboot(void) {
    __asm__ volatile("cli");

    /* 1. 8042 pulse. Wait (bounded) for the input buffer to empty so the reset
     *    command isn't dropped, then issue it. */
    for (int i = 0; i < 100000; i++)
        if (!(inb(0x64) & 0x02)) break;
    outb(0x64, 0xFE);

    /* Give the pulse a moment to land before escalating. */
    for (int i = 0; i < 1000000; i++) __asm__ volatile("pause");

    /* 2. Last resort: triple-fault via a null IDT + #BP. */
    struct { uint16_t limit; uint64_t base; } __attribute__((packed)) null_idt = { 0, 0 };
    __asm__ volatile("lidt %0" : : "m"(null_idt));
    __asm__ volatile("int3");

    /* Unreachable. */
    for (;;) __asm__ volatile("hlt");
}
