/*
 * Astrion v2.0 — In-memory filesystem
 *
 * Single linked list of fs_node entries. Each file has a kmalloc'd
 * data buffer that grows via krealloc when fs_write/fs_append need
 * more room. Directories are entries with kind=FS_DIR + data=NULL.
 *
 * Concurrency: same single-thread invariant as the heap. When
 * preemptive multitasking lands, we wrap mutations in a lock.
 */

#include <stdint.h>
#include "fs.h"
#include "heap.h"
#include "pit.h"
#include "ata.h"

static fs_node *root;
static uint32_t node_count;

/* tiny libc-style helpers — kept here so fs.c is self-contained. */
static int sstreq(const char *a, const char *b) {
    while (*a && *b && *a == *b) { a++; b++; }
    return *a == 0 && *b == 0;
}

static uint32_t sstrlen(const char *s) {
    uint32_t n = 0; while (*s++) n++; return n;
}

static void sstrcpy_n(char *dst, const char *src, uint32_t cap) {
    uint32_t i = 0;
    while (src[i] && i < cap - 1) { dst[i] = src[i]; i++; }
    dst[i] = 0;
}

static void mmemcpy(uint8_t *dst, const uint8_t *src, uint32_t n) {
    for (uint32_t i = 0; i < n; i++) dst[i] = src[i];
}

void fs_init(void) {
    root = 0;
    node_count = 0;

    /* If a disk is attached and has a valid superblock, load from it.
     * Otherwise seed a couple of default files so the user has
     * something to interact with. */
    if (ata_present() && fs_load_from_disk() == 0 && node_count > 0) {
        return;
    }

    fs_create("readme.txt", FS_FILE);
    const char *welcome =
        "welcome to astrion v2.0\n"
        "\n"
        "this is an in-kernel filesystem.\n"
        "try: ls, cat readme.txt, write log hi there\n"
        "type 'sync' to save to disk, then reboot — files come back.\n";
    fs_write("readme.txt", (const uint8_t *)welcome, sstrlen(welcome));

    fs_create("greet.sh", FS_FILE);
    const char *g = "echo hello from astrion\n";
    fs_write("greet.sh", (const uint8_t *)g, sstrlen(g));
}

fs_node *fs_find(const char *name) {
    for (fs_node *n = root; n; n = n->next) {
        if (sstreq(n->name, name)) return n;
    }
    return 0;
}

fs_node *fs_create(const char *name, uint32_t kind) {
    if (!name || !*name) return 0;
    if (sstrlen(name) > FS_NAME_MAX) return 0;
    if (fs_find(name)) return 0;
    fs_node *n = (fs_node *)kmalloc(sizeof(fs_node));
    if (!n) return 0;
    sstrcpy_n(n->name, name, FS_NAME_MAX + 1);
    n->kind = kind;
    n->size = 0;
    n->data = 0;
    n->capacity = 0;
    n->created_ms = pit_elapsed_ms();
    n->modified_ms = n->created_ms;
    n->next = root;
    root = n;
    node_count++;
    return n;
}

static int ensure_capacity(fs_node *n, uint32_t need) {
    if (n->capacity >= need) return 0;
    uint32_t new_cap = n->capacity ? n->capacity : 64;
    while (new_cap < need) new_cap *= 2;
    uint8_t *nb = (uint8_t *)krealloc(n->data, new_cap);
    if (!nb) return -1;
    n->data = nb;
    n->capacity = new_cap;
    return 0;
}

int fs_write(const char *name, const uint8_t *data, uint32_t len) {
    fs_node *n = fs_find(name);
    if (!n) n = fs_create(name, FS_FILE);
    if (!n || n->kind != FS_FILE) return -1;
    if (ensure_capacity(n, len) != 0) return -1;
    mmemcpy(n->data, data, len);
    n->size = len;
    n->modified_ms = pit_elapsed_ms();
    return (int)len;
}

int fs_append(const char *name, const uint8_t *data, uint32_t len) {
    fs_node *n = fs_find(name);
    if (!n) n = fs_create(name, FS_FILE);
    if (!n || n->kind != FS_FILE) return -1;
    if (ensure_capacity(n, n->size + len) != 0) return -1;
    mmemcpy(n->data + n->size, data, len);
    n->size += len;
    n->modified_ms = pit_elapsed_ms();
    return (int)len;
}

int fs_read(const char *name, uint8_t *out, uint32_t cap, uint32_t *out_len) {
    fs_node *n = fs_find(name);
    if (!n || n->kind != FS_FILE) return -1;
    uint32_t copy = n->size < cap ? n->size : cap;
    mmemcpy(out, n->data, copy);
    if (out_len) *out_len = copy;
    return (int)copy;
}

int fs_unlink(const char *name) {
    fs_node **p = &root;
    while (*p) {
        if (sstreq((*p)->name, name)) {
            fs_node *gone = *p;
            *p = gone->next;
            if (gone->data) kfree(gone->data);
            kfree(gone);
            node_count--;
            return 0;
        }
        p = &(*p)->next;
    }
    return -1;
}

fs_node  *fs_first(void)            { return root; }
fs_node  *fs_next(fs_node *n)       { return n ? n->next : 0; }
uint32_t  fs_count(void)            { return node_count; }

uint32_t fs_total_bytes(void) {
    uint32_t t = 0;
    for (fs_node *n = root; n; n = n->next) t += n->size;
    return t;
}

/* ─── Persistence ─────────────────────────────────────────
 *
 * On-disk layout (little-endian):
 *
 *   sector 0 = superblock:
 *     u32 magic = 0xA570F500
 *     u32 version = 1
 *     u32 node_count
 *     u32 total_data_bytes (sum of all file sizes)
 *     u8  reserved[496]
 *
 *   sectors 1..N = node table, packed:
 *     u32 magic_node = 0xA570F510
 *     u32 kind
 *     u32 size           (payload bytes in data, file only)
 *     u32 name_len
 *     u64 created_ms
 *     u64 modified_ms
 *     char name[name_len]            (no nul)
 *     u8   data[size]                (file only; pad to 8 bytes)
 *
 * The serializer rounds each node's total bytes up to 512, and
 * keeps writing more sectors as needed. The deserializer reads
 * sector 0, validates magic, then walks the tail sectors one by
 * one, allocating fs_nodes on the heap.
 *
 * Keeping a single contiguous append-style serialization makes
 * this trivially robust for the MVP. Fragmentation, free lists,
 * journals — all later.
 */

#define MAGIC_SB    0xA570F500u
#define MAGIC_NODE  0xA570F510u
#define FS_VERSION  1u

struct sb {
    uint32_t magic;
    uint32_t version;
    uint32_t node_count;
    uint32_t total_data_bytes;
    uint8_t  reserved[496];
} __attribute__((packed));

struct node_hdr {
    uint32_t magic;
    uint32_t kind;
    uint32_t size;
    uint32_t name_len;
    uint64_t created_ms;
    uint64_t modified_ms;
} __attribute__((packed));

static uint8_t  sec_buf[512];
static uint8_t *flat_buf;        /* scratch we kmalloc for serialization */

/* Tiny memcpy / memset locally to avoid SSE-via-memcpy. */
static void cp(uint8_t *d, const uint8_t *s, uint32_t n) { for (uint32_t i = 0; i < n; i++) d[i] = s[i]; }
static void zr(uint8_t *d, uint32_t n) { for (uint32_t i = 0; i < n; i++) d[i] = 0; }
static uint32_t round_up(uint32_t v, uint32_t a) { return (v + a - 1) & ~(a - 1); }

int fs_sync(void) {
    if (!ata_present()) return -1;

    /* Build a single flat layout in RAM first, then split into
     * sectors. That's simpler than tracking partial-sector state
     * mid-write. */
    uint32_t needed = 0;
    for (fs_node *n = root; n; n = n->next) {
        needed += sizeof(struct node_hdr);
        uint32_t name_len = 0;
        const char *p = n->name;
        while (*p) { name_len++; p++; }
        needed += name_len;
        needed += n->size;
        needed = round_up(needed, 8);
    }
    uint32_t total = round_up(needed, 512);
    if (flat_buf) { kfree(flat_buf); flat_buf = 0; }
    flat_buf = (uint8_t *)kmalloc(total > 0 ? total : 512);
    if (!flat_buf) return -1;
    zr(flat_buf, total);

    /* Pack nodes into flat_buf. */
    uint32_t off = 0;
    uint32_t count = 0;
    uint32_t total_data = 0;
    for (fs_node *n = root; n; n = n->next) {
        uint32_t name_len = 0;
        const char *p = n->name;
        while (*p) { name_len++; p++; }
        struct node_hdr h;
        h.magic       = MAGIC_NODE;
        h.kind        = n->kind;
        h.size        = n->size;
        h.name_len    = name_len;
        h.created_ms  = n->created_ms;
        h.modified_ms = n->modified_ms;
        cp(flat_buf + off, (const uint8_t *)&h, sizeof(h));
        off += sizeof(h);
        cp(flat_buf + off, (const uint8_t *)n->name, name_len);
        off += name_len;
        if (n->size && n->data) {
            cp(flat_buf + off, n->data, n->size);
            off += n->size;
        }
        off = round_up(off, 8);
        count++;
        total_data += n->size;
    }

    /* Build + write superblock at sector 0. */
    zr(sec_buf, 512);
    struct sb sb;
    sb.magic = MAGIC_SB;
    sb.version = FS_VERSION;
    sb.node_count = count;
    sb.total_data_bytes = total_data;
    zr(sb.reserved, sizeof(sb.reserved));
    cp(sec_buf, (const uint8_t *)&sb, sizeof(sb));
    if (ata_write_sector(0, sec_buf) != 0) return -1;

    /* Write data sectors starting at LBA 1. */
    uint32_t lba = 1;
    for (uint32_t i = 0; i < total; i += 512) {
        if (ata_write_sector(lba, flat_buf + i) != 0) return -1;
        lba++;
    }
    return 0;
}

int fs_load_from_disk(void) {
    if (!ata_present()) return -1;
    if (ata_read_sector(0, sec_buf) != 0) return -1;
    struct sb sb;
    cp((uint8_t *)&sb, sec_buf, sizeof(sb));
    if (sb.magic != MAGIC_SB || sb.version != FS_VERSION) return -1;
    if (sb.node_count == 0) return 0;  /* clean disk; nothing to load */

    /* Estimate how many bytes we need to slurp. We don't have the
     * exact total in the superblock (per-node padding makes it
     * imprecise), so read enough sectors to be safe: count * (header
     * + max name) + total_data_bytes + slack. Cap at 8 MiB so we
     * don't OOM on a corrupted superblock. */
    uint32_t guess = sb.node_count * (uint32_t)(sizeof(struct node_hdr) + FS_NAME_MAX + 8)
                   + sb.total_data_bytes + 4096;
    if (guess > 8 * 1024 * 1024) return -1;
    uint32_t bytes = round_up(guess, 512);
    if (flat_buf) { kfree(flat_buf); flat_buf = 0; }
    flat_buf = (uint8_t *)kmalloc(bytes);
    if (!flat_buf) return -1;
    uint32_t lba = 1;
    for (uint32_t i = 0; i < bytes; i += 512) {
        if (ata_read_sector(lba, flat_buf + i) != 0) return -1;
        lba++;
    }

    /* Wipe whatever fs_init seeded so we don't double-seed. */
    while (root) fs_unlink(root->name);

    uint32_t off = 0;
    for (uint32_t i = 0; i < sb.node_count; i++) {
        if (off + sizeof(struct node_hdr) > bytes) return -1;
        struct node_hdr h;
        cp((uint8_t *)&h, flat_buf + off, sizeof(h));
        off += sizeof(h);
        if (h.magic != MAGIC_NODE) return -1;
        if (h.name_len > FS_NAME_MAX) return -1;
        if (off + h.name_len > bytes) return -1;
        char namebuf[FS_NAME_MAX + 1];
        cp((uint8_t *)namebuf, flat_buf + off, h.name_len);
        namebuf[h.name_len] = 0;
        off += h.name_len;

        fs_node *n = fs_create(namebuf, h.kind);
        if (!n) return -1;
        n->created_ms  = h.created_ms;
        n->modified_ms = h.modified_ms;

        if (h.size) {
            if (off + h.size > bytes) return -1;
            if (ensure_capacity(n, h.size) != 0) return -1;
            cp(n->data, flat_buf + off, h.size);
            n->size = h.size;
            off += h.size;
        }
        off = round_up(off, 8);
    }
    return 0;
}
