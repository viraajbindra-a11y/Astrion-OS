/*
 * Astrion v2.0 - ATA PIO disk driver (primary master, 28-bit LBA)
 *
 * Smallest possible block-device layer. No DMA, no interrupts, no
 * multi-drive support. Reads/writes 512-byte sectors via the legacy
 * IDE I/O ports (0x1F0 base). Identify cycle on init reports the
 * model string and total sector count so 'disk' shell cmd can show
 * something useful.
 *
 * Public API takes sector indices (LBA), not byte offsets. Callers
 * convert.
 */

#ifndef ASTRION_ATA_H
#define ASTRION_ATA_H

#include <stdint.h>

#define ATA_SECTOR_SIZE 512

void ata_init(void);
int  ata_present(void);
uint32_t ata_total_sectors(void);
const char *ata_model(void);

/* Returns 0 on success, -1 on error (no disk, timeout, etc.). */
int ata_read_sector(uint32_t lba, void *buf);
int ata_write_sector(uint32_t lba, const void *buf);

#endif
