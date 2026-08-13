/*
 * Astrion v2.0 — PCI configuration space
 *
 * The first thing a network stack needs is a network card, and the only way
 * to find one on a PC is to walk PCI. Everything past this file — the e1000
 * driver, ARP, IP, TCP, the browser the September plan wants — sits on top of
 * "which device is at which address", which is the one question this answers.
 *
 * Mechanism #1 only (the 0xCF8/0xCFC port pair). Not PCIe ECAM, which needs
 * the ACPI MCFG table and gives access to config space past byte 256. Nothing
 * here needs those bytes, QEMU's e1000 is a plain PCI device, and every PC
 * since 1993 answers on these two ports — so mechanism #1 is both simpler and
 * more portable. If a device ever needs extended config space, that is the day
 * to add ECAM, not before.
 */

#ifndef ASTRION_PCI_H
#define ASTRION_PCI_H

#include <stdint.h>

struct pci_dev {
    uint8_t  bus, slot, fn;
    uint16_t vendor, device;
    uint8_t  class_, subclass, prog_if, revision;
    uint8_t  irq_line;
};

/* Raw config-space access. off must be 4-byte aligned for the 32-bit forms —
 * the low two bits of the address register are reserved and the hardware
 * ignores them, so an unaligned offset silently reads the wrong dword. */
uint32_t pci_cfg_read32(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off);
uint16_t pci_cfg_read16(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off);
void     pci_cfg_write32(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off,
                         uint32_t val);

/* Walk every bus/slot/function once and remember what is there. Returns how
 * many functions responded. Safe to call more than once. */
int  pci_scan(void);

/* How many devices the last scan found, and indexed access to them — the
 * 'pci' shell command walks these. */
int  pci_count(void);
const struct pci_dev *pci_at(int i);

/* Find the first device matching. Returns 0 when there is none, which is the
 * normal answer on a machine with no such card and must not be an error. */
const struct pci_dev *pci_find(uint16_t vendor, uint16_t device);
const struct pci_dev *pci_find_class(uint8_t class_, uint8_t subclass);

/* Base address register `idx` (0..5), with the low flag bits stripped.
 *
 * Returns the MMIO physical address for a memory BAR, or the port base with
 * bit 0 kept clear for an I/O BAR — callers that care which they got must ask
 * pci_bar_is_io(). A 64-bit memory BAR consumes TWO slots and the high half is
 * folded in here, so a caller that asks for BAR0 of a 64-bit device gets the
 * whole address and must not then ask for BAR1.
 *
 * 0 means "not implemented", which is what an unused BAR reads as. */
uint64_t pci_bar(const struct pci_dev *d, int idx);
int      pci_bar_is_io(const struct pci_dev *d, int idx);

/* Let the device write to memory on its own. A NIC's descriptor rings are
 * pure DMA, so without this the card reads the ring exactly never and the
 * driver hangs waiting for a status bit that will never be set — the classic
 * "everything looks right and nothing happens" bug. */
void pci_enable_bus_master(const struct pci_dev *d);

/* A human-readable guess at what a class/subclass pair is, for the shell.
 * Deliberately short and honest: unknown returns "device", not a made-up name. */
const char *pci_class_name(uint8_t class_, uint8_t subclass);

#endif /* ASTRION_PCI_H */
