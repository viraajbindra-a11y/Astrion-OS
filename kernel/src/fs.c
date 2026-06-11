/*
 * Astrion v2.0 - In-memory filesystem
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

/* tiny libc-style helpers - kept here so fs.c is self-contained. */
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
        "type 'sync' to save to disk, then reboot - files come back.\n";
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

/* Hard ceiling on a single file: 8 MiB. The whole heap is 32 MiB, so
 * this keeps one file from eating it all AND bounds the doubling loop. */
#define FS_FILE_MAX (8u * 1024 * 1024)

static int ensure_capacity(fs_node *n, uint32_t need) {
    if (need > FS_FILE_MAX) return -1;       /* refuse oversized files */
    if (n->capacity >= need) return 0;
    uint32_t new_cap = n->capacity ? n->capacity : 64;
    /* Double until it fits. `need <= FS_FILE_MAX < 2^31`, so the next
     * power of two is at most 2^31 - no uint32 overflow, no infinite
     * loop (the old `new_cap *= 2` wrapped to 0 for need > 2^31 and
     * spun forever). */
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
    /* Guard size+len overflow: a wrapped sum would satisfy a small
     * capacity and let the mmemcpy run off the end of the heap block. */
    if (len > FS_FILE_MAX - n->size) return -1;
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
 * journals - all later.
 */

#define MAGIC_SB    0xA570F500u
#define MAGIC_NODE  0xA570F510u
#define FS_VERSION  1u

/* Sanity ceilings for parsing an UNTRUSTED on-disk image. node_count
 * and total_data_bytes come straight off the disk; without caps a
 * crafted superblock could overflow the size math. 4096 nodes / 8 MiB
 * is far more than the MVP ever produces. */
#define FS_MAX_NODES 4096u
#define FS_LOAD_MAX  (8u * 1024 * 1024)

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

/* Free an entire detached node list (used to discard a partial parse
 * or drop the old list after a successful load). */
static void free_list(fs_node *head) {
    while (head) {
        fs_node *nx = head->next;
        if (head->data) kfree(head->data);
        kfree(head);
        head = nx;
    }
}

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
    if (sb.node_count == 0) return 0;            /* clean disk; nothing to load */
    if (sb.node_count > FS_MAX_NODES) return -1; /* corrupt / hostile superblock */

    /* How many bytes to slurp. node_count is now capped at 4096 and
     * total_data_bytes is a uint32, so the whole thing is computed in
     * 64-bit and CANNOT overflow - the old all-uint32 `guess` could
     * wrap below the 8 MiB cap and defeat it. */
    uint64_t guess = (uint64_t)sb.node_count
                       * (uint64_t)(sizeof(struct node_hdr) + FS_NAME_MAX + 8)
                   + (uint64_t)sb.total_data_bytes + 4096;
    if (guess > FS_LOAD_MAX) return -1;
    uint32_t bytes = round_up((uint32_t)guess, 512);

    uint8_t *buf = (uint8_t *)kmalloc(bytes);
    if (!buf) return -1;
    uint32_t lba = 1;
    for (uint32_t i = 0; i < bytes; i += 512) {
        if (ata_read_sector(lba, buf + i) != 0) { kfree(buf); return -1; }
        lba++;
    }

    /* Parse into a FRESH list, leaving the existing one (the seeds, or
     * a previously-mounted FS) untouched until we know the whole image
     * is valid. A corrupt disk must not leave a half-built filesystem
     * NOR double-seed on top of a partial parse (the old code wiped
     * first, then could bail mid-loop). */
    fs_node *saved_root  = root;
    uint32_t saved_count = node_count;
    root = 0;
    node_count = 0;

    uint64_t off = 0;
    int ok = 1;
    for (uint32_t i = 0; i < sb.node_count; i++) {
        if (off + sizeof(struct node_hdr) > bytes) { ok = 0; break; }
        struct node_hdr h;
        cp((uint8_t *)&h, buf + (uint32_t)off, sizeof(h));
        off += sizeof(h);
        if (h.magic != MAGIC_NODE)        { ok = 0; break; }
        if (h.name_len > FS_NAME_MAX)     { ok = 0; break; }
        if (off + h.name_len > bytes)     { ok = 0; break; }
        if (h.kind != FS_FILE && h.kind != FS_DIR) { ok = 0; break; }
        char namebuf[FS_NAME_MAX + 1];
        cp((uint8_t *)namebuf, buf + (uint32_t)off, h.name_len);
        namebuf[h.name_len] = 0;
        off += h.name_len;

        fs_node *n = fs_create(namebuf, h.kind);   /* NULL on dup name → fail */
        if (!n) { ok = 0; break; }
        n->created_ms  = h.created_ms;
        n->modified_ms = h.modified_ms;

        if (h.size) {
            if (h.size > FS_FILE_MAX)     { ok = 0; break; }
            if (off + h.size > bytes)     { ok = 0; break; }
            if (ensure_capacity(n, h.size) != 0) { ok = 0; break; }
            cp(n->data, buf + (uint32_t)off, h.size);
            n->size = h.size;
            off += h.size;
        }
        off = (off + 7) & ~(uint64_t)7;   /* 64-bit round-up: can't wrap under 8 MiB */
    }

    kfree(buf);

    if (!ok) {
        free_list(root);            /* discard the partial parse */
        root = saved_root;          /* restore the prior list */
        node_count = saved_count;
        return -1;
    }
    free_list(saved_root);          /* success: drop the old list */
    return 0;
}
