/*
 * Astrion v2.0 — In-memory filesystem
 *
 * Single root directory + flat namespace for now (no subdirs in v1
 * of this fs; mkdir is wired but stored as a tag in the file
 * metadata so 'ls' can show <dir> entries — actual recursion comes
 * later). Files are kmalloc'd byte buffers; the file table is a
 * single linked list of `struct fs_file` nodes.
 *
 * Names: ASCII, up to 63 chars, no path separators yet.
 *
 * API is intentionally minimal — just enough for cat / write / ls /
 * rm to be real, and for future ELF loader + persistence layer to
 * have a clear boundary.
 */

#ifndef ASTRION_FS_H
#define ASTRION_FS_H

#include <stdint.h>

#define FS_NAME_MAX 63

enum {
    FS_FILE = 0,
    FS_DIR  = 1,
};

typedef struct fs_node {
    char            name[FS_NAME_MAX + 1];
    uint32_t        kind;           /* FS_FILE | FS_DIR */
    uint32_t        size;
    uint8_t        *data;           /* kmalloc'd buffer (file only) */
    uint32_t        capacity;       /* data buffer capacity */
    uint64_t        created_ms;     /* pit_elapsed_ms() at create */
    uint64_t        modified_ms;
    struct fs_node *next;
} fs_node;

void      fs_init(void);

fs_node  *fs_find(const char *name);
fs_node  *fs_create(const char *name, uint32_t kind);
int       fs_write(const char *name, const uint8_t *data, uint32_t len);
int       fs_append(const char *name, const uint8_t *data, uint32_t len);
int       fs_read(const char *name, uint8_t *out, uint32_t cap, uint32_t *out_len);
int       fs_unlink(const char *name);

/* Iteration. */
fs_node  *fs_first(void);
fs_node  *fs_next(fs_node *n);
uint32_t  fs_count(void);
uint32_t  fs_total_bytes(void);

#endif
