/*
 * Astrion v2.0 - ATA PIO driver
 *
 * Standard primary-IDE channel sits at I/O ports 0x1F0..0x1F7 (data
 * + LBA + status) and 0x3F6 (alt status + device control). We talk
 * to the master drive only.
 *
 * Sequence for a sector read:
 *   1. Spin until !BSY (bit 7 of status).
 *   2. Write drive select with bits set for master + LBA mode + the
 *      top 4 bits of the 28-bit LBA.
 *   3. Write sector count = 1.
 *   4. Write LBA bytes 0..2 to ports 0x1F3..0x1F5.
 *   5. Send READ command (0x20) to 0x1F7.
 *   6. Spin until DRQ (bit 3 of status) - data ready.
 *   7. Read 256 16-bit words from the data port into the caller's buf.
 *
 * Write is the same shape with command 0x30 and an outsw instead of
 * insw. After writing, we issue a FLUSH (0xE7) so QEMU commits the
 * write to the backing file immediately - otherwise the disk image
 * on the host doesn't see the changes until shutdown.
 */

#include <stdint.h>
#include "ata.h"

#define ATA_DATA       0x1F0
#define ATA_ERROR      0x1F1
#define ATA_FEATURES   0x1F1
#define ATA_SECCOUNT   0x1F2
#define ATA_LBA0       0x1F3
#define ATA_LBA1       0x1F4
#define ATA_LBA2       0x1F5
#define ATA_DRIVE      0x1F6
#define ATA_STATUS     0x1F7
#define ATA_COMMAND    0x1F7
#define ATA_CTRL       0x3F6

#define CMD_READ       0x20
#define CMD_WRITE      0x30
#define CMD_IDENTIFY   0xEC
#define CMD_FLUSH      0xE7

#define ST_BSY   0x80
#define ST_DRDY  0x40
#define ST_DRQ   0x08
#define ST_ERR   0x01

#define MAX_SPIN 1000000

static int      have_disk;
static uint32_t total_sectors;
static char     model_str[41];

static inline void outb_(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}
static inline uint8_t inb_(uint16_t port) {
    uint8_t v; __asm__ volatile("inb %1, %0" : "=a"(v) : "Nd"(port)); return v;
}
static inline uint16_t inw_(uint16_t port) {
    uint16_t v; __asm__ volatile("inw %1, %0" : "=a"(v) : "Nd"(port)); return v;
}
static inline void outw_(uint16_t port, uint16_t val) {
    __asm__ volatile("outw %0, %1" : : "a"(val), "Nd"(port));
}

/* Read alt status 4x to give the drive ~400 ns of settling time
 * before checking BSY. Standard ATA idiom. */
static void io_wait_400ns(void) {
    (void)inb_(ATA_CTRL); (void)inb_(ATA_CTRL);
    (void)inb_(ATA_CTRL); (void)inb_(ATA_CTRL);
}

static int wait_not_busy(void) {
    for (int i = 0; i < MAX_SPIN; i++) {
        uint8_t s = inb_(ATA_STATUS);
        if (!(s & ST_BSY)) return 0;
    }
    return -1;
}

static int wait_drq(void) {
    for (int i = 0; i < MAX_SPIN; i++) {
        uint8_t s = inb_(ATA_STATUS);
        if (s & ST_ERR) return -1;
        if (!(s & ST_BSY) && (s & ST_DRQ)) return 0;
    }
    return -1;
}

void ata_init(void) {
    have_disk = 0;
    total_sectors = 0;
    model_str[0] = 0;

    /* Select master, clear features. */
    outb_(ATA_DRIVE, 0xA0);
    io_wait_400ns();
    outb_(ATA_SECCOUNT, 0);
    outb_(ATA_LBA0, 0);
    outb_(ATA_LBA1, 0);
    outb_(ATA_LBA2, 0);
    outb_(ATA_COMMAND, CMD_IDENTIFY);
    io_wait_400ns();

    uint8_t status = inb_(ATA_STATUS);
    if (status == 0)        return;   /* no drive */
    if (wait_not_busy())    return;
    /* Check sig - IDENTIFY should leave LBA1/LBA2 = 0 for ATA. */
    if (inb_(ATA_LBA1) != 0 || inb_(ATA_LBA2) != 0) return;
    if (wait_drq())         return;

    /* Read 256 16-bit words of IDENTIFY data. */
    uint16_t id[256];
    for (int i = 0; i < 256; i++) id[i] = inw_(ATA_DATA);

    /* Total sectors (28-bit LBA) at words 60..61. */
    total_sectors = ((uint32_t)id[61] << 16) | (uint32_t)id[60];

    /* Model string at words 27..46 - big-endian byte order per word. */
    for (int i = 0; i < 20; i++) {
        model_str[i * 2]     = (char)(id[27 + i] >> 8);
        model_str[i * 2 + 1] = (char)(id[27 + i] & 0xFF);
    }
    model_str[40] = 0;
    /* Trim trailing spaces. */
    for (int i = 39; i >= 0 && model_str[i] == ' '; i--) model_str[i] = 0;

    have_disk = 1;
}

int ata_present(void)            { return have_disk; }
uint32_t ata_total_sectors(void) { return total_sectors; }
const char *ata_model(void)      { return model_str; }

int ata_read_sector(uint32_t lba, void *buf) {
    if (!have_disk) return -1;
    if (lba >= total_sectors) return -1;   /* never address past the disk */
    if (wait_not_busy()) return -1;

    outb_(ATA_DRIVE, 0xE0 | ((lba >> 24) & 0x0F));    /* master, LBA mode */
    io_wait_400ns();
    outb_(ATA_SECCOUNT, 1);
    outb_(ATA_LBA0, (uint8_t)(lba & 0xFF));
    outb_(ATA_LBA1, (uint8_t)((lba >> 8) & 0xFF));
    outb_(ATA_LBA2, (uint8_t)((lba >> 16) & 0xFF));
    outb_(ATA_COMMAND, CMD_READ);

    if (wait_drq()) return -1;

    uint16_t *p = (uint16_t *)buf;
    for (int i = 0; i < 256; i++) p[i] = inw_(ATA_DATA);
    return 0;
}

int ata_write_sector(uint32_t lba, const void *buf) {
    if (!have_disk) return -1;
    if (lba >= total_sectors) return -1;   /* never address past the disk */
    if (wait_not_busy()) return -1;

    outb_(ATA_DRIVE, 0xE0 | ((lba >> 24) & 0x0F));
    io_wait_400ns();
    outb_(ATA_SECCOUNT, 1);
    outb_(ATA_LBA0, (uint8_t)(lba & 0xFF));
    outb_(ATA_LBA1, (uint8_t)((lba >> 8) & 0xFF));
    outb_(ATA_LBA2, (uint8_t)((lba >> 16) & 0xFF));
    outb_(ATA_COMMAND, CMD_WRITE);

    if (wait_drq()) return -1;

    const uint16_t *p = (const uint16_t *)buf;
    for (int i = 0; i < 256; i++) outw_(ATA_DATA, p[i]);

    /* Flush so QEMU writes the host-side image right away. */
    outb_(ATA_COMMAND, CMD_FLUSH);
    if (wait_not_busy()) return -1;
    return 0;
}
