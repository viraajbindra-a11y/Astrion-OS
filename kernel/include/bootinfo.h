/**
 * NOVA OS Kernel — Boot Information
 * Passed from the bootloader to the kernel.
 */

#ifndef NOVA_BOOTINFO_H
#define NOVA_BOOTINFO_H

#include "types.h"

typedef struct {
    uint64_t framebuffer_addr;
    uint32_t width;
    uint32_t height;
    uint32_t pitch;           // bytes per scanline
    uint32_t bpp;             // bits per pixel (32)
    uint64_t memory_map_addr;
    uint64_t memory_map_size;
    uint64_t memory_map_desc_size;
} BootInfo;

#endif
