/*
 * Astrion v2.0 - In-memory filesystem
 *
 * A real tree, stored as ONE flat linked list of fs_node entries plus a
 * parent pointer on each. A node's `name` is only its leaf ("todo.txt");
 * the path is recovered by walking `parent` up to the root. Files have a
 * kmalloc'd data buffer that grows via krealloc when fs_write/fs_append
 * need more room; directories are entries with kind=FS_DIR + data=NULL.
 *
 * Why a flat list and not per-directory child lists: this fs is tiny
 * (thousands of nodes at most) and every operation that matters is a
 * path walk, which is dominated by string compares either way. A flat
 * list keeps fs_sync/fs_load, fs_count and free_list exactly as simple
 * as they were before directories existed. The cost is that listing one
 * directory scans the whole list (fs_first_in/fs_next_in), i.e. O(n) per
 * step. Fine at this size; swap in child lists when it stops being fine.
 *
 * The root "/" is `root_node`, a static that is NEVER linked into the
 * list. So fs_count() still counts only what the user made, fs_sync()
 * never serialises the root, and free_list() can never free it.
 *
 * Concurrency: same single-thread invariant as the heap. When
 * preemptive multitasking lands, we wrap mutations in a lock.
 */

#include <stdint.h>
#include "fs.h"
#include "heap.h"
#include "pit.h"
#include "ata.h"
#include "hello_elf.h"   /* generated: the embedded sample ELF, seeded as /hello.elf */
#include "rogue_elf.h"   /* generated: the hostile ring-3 program, seeded as /rogue.elf */
#include "iodemo_elf.h"  /* generated: the ring-3 file-I/O demo, seeded as /iodemo.elf */

static fs_node *nodes;          /* flat list of every node EXCEPT the root */
static uint32_t node_count;
static fs_node  root_node;      /* "/" - never in `nodes`, never freed */
static fs_node *cwd;            /* always non-NULL once fs_init has run */

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

/* ─── The tree ────────────────────────────────────────────
 *
 * Root is a real node so that "/" resolves to something and `..` has a
 * ceiling, but it lives outside the list (see the header comment).
 */

fs_node *fs_root(void) { return &root_node; }
fs_node *fs_cwd(void)  { return cwd ? cwd : &root_node; }

/* Direct child of `dir` by leaf name, or 0. */
static fs_node *child_of(fs_node *dir, const char *name) {
    for (fs_node *n = nodes; n; n = n->next)
        if (n->parent == dir && sstreq(n->name, name)) return n;
    return 0;
}

/* Length the full path of "<dir>/<leaf>" WOULD have, or 0 if it busts
 * FS_PATH_MAX / FS_DEPTH_MAX. Accumulated in 64-bit: with the depth cap
 * bounding the loop at 64 iterations and each component at 64 bytes, the
 * running total can't exceed ~4 KiB, so it physically cannot wrap - no
 * `total + x` compare needed anywhere. */
static uint32_t prospective_path_len(fs_node *dir, const char *leaf) {
    uint32_t leaf_len = sstrlen(leaf);
    if (leaf_len == 0 || leaf_len > FS_NAME_MAX) return 0;
    uint64_t total = 1 + (uint64_t)leaf_len;          /* the "/leaf" part */
    uint32_t depth = 1;
    for (fs_node *q = dir; q && q != &root_node; q = q->parent) {
        if (++depth > FS_DEPTH_MAX) return 0;
        total += 1 + (uint64_t)sstrlen(q->name);
        if (total > FS_PATH_MAX) return 0;
    }
    return (uint32_t)total;
}

/* Link a fresh node into `dir`. Rejects anything whose full path would
 * exceed FS_PATH_MAX - a node we couldn't serialise is a node that would
 * silently vanish on the next reboot, so it must never exist. */
static fs_node *new_node(fs_node *dir, const char *leaf, uint32_t kind) {
    if (!dir || dir->kind != FS_DIR) return 0;
    if (kind != FS_FILE && kind != FS_DIR) return 0;
    if (prospective_path_len(dir, leaf) == 0) return 0;
    fs_node *n = (fs_node *)kmalloc(sizeof(fs_node));
    if (!n) return 0;
    sstrcpy_n(n->name, leaf, FS_NAME_MAX + 1);
    n->kind = kind;
    n->size = 0;
    n->data = 0;
    n->capacity = 0;
    n->created_ms = pit_elapsed_ms();
    n->modified_ms = n->created_ms;
    n->parent = dir;
    n->next = nodes;
    nodes = n;
    node_count++;
    return n;
}

/* ─── Path resolution ─────────────────────────────────────
 *
 * One walker serves find, create and the disk loader.
 *
 *   W_NODE      resolve the whole path -> the node it names, or 0.
 *   W_PARENT    resolve all but the last component -> the directory that
 *               would CONTAIN it, with that component copied into `leaf`.
 *   W_PARENT_MK same, but conjure missing intermediate directories. Only
 *               the disk loader uses this (it recreates nodes by path in
 *               whatever order they come off the platter).
 *
 * Absolute paths start at the root, relative ones at the cwd. "." holds
 * still, ".." climbs (and stops dead at the root - you cannot escape).
 */
enum { W_NODE = 0, W_PARENT = 1, W_PARENT_MK = 2 };

static fs_node *walk(const char *path, int mode, char *leaf) {
    if (leaf) leaf[0] = 0;
    if (!path || !*path) return 0;
    if (sstrlen(path) > FS_PATH_MAX) return 0;    /* bound the input up front */

    const char *p = path;
    fs_node *cur;
    if (*p == '/') { cur = &root_node; while (*p == '/') p++; }
    else           { cur = fs_cwd(); }

    while (*p) {
        /* Carve out one component: [p, q). */
        const char *q = p;
        while (*q && *q != '/') q++;
        uint32_t len = (uint32_t)(q - p);
        if (len > FS_NAME_MAX) return 0;
        char comp[FS_NAME_MAX + 1];
        for (uint32_t i = 0; i < len; i++) comp[i] = p[i];
        comp[len] = 0;

        /* Look past the separators: is anything meaningful left? */
        const char *r = q;
        while (*r == '/') r++;
        int last = (*r == 0);

        int is_dot    = sstreq(comp, ".");
        int is_dotdot = sstreq(comp, "..");

        /* The parent modes stop one short - but only for a real name.
         * A path ending in "." or ".." names a directory, not a slot
         * you can create something in, so those fall through and the
         * walker runs out of components (-> 0 below). */
        if (mode != W_NODE && last && !is_dot && !is_dotdot) {
            if (cur->kind != FS_DIR) return 0;
            if (leaf) sstrcpy_n(leaf, comp, FS_NAME_MAX + 1);
            return cur;
        }

        if (is_dot) {
            /* stay put */
        } else if (is_dotdot) {
            cur = cur->parent ? cur->parent : &root_node;
        } else {
            fs_node *ch = child_of(cur, comp);
            if (!ch) {
                if (mode != W_PARENT_MK) return 0;
                ch = new_node(cur, comp, FS_DIR);
                if (!ch) return 0;
            }
            if (ch->kind != FS_DIR && !last) return 0;   /* "notes.txt/x" is nonsense */
            cur = ch;
        }
        p = r;
    }

    /* Fell off the end. In W_NODE that's the answer ("/" -> root). In the
     * parent modes it means there was no final name to hand back. */
    if (mode != W_NODE) return 0;
    return cur;
}

uint32_t fs_path(fs_node *n, char *out, uint32_t cap) {
    if (!out || cap == 0) return 0;
    out[0] = 0;
    if (!n) return 0;
    if (n == &root_node) {
        if (cap < 2) return 0;
        out[0] = '/'; out[1] = 0;
        return 1;
    }

    /* Collect the chain leaf-first, then emit it root-first. The depth cap
     * bounds the array AND makes this terminate even if the parent chain
     * were ever corrupted into a cycle. */
    fs_node *chain[FS_DEPTH_MAX];
    uint32_t d = 0;
    for (fs_node *q = n; q && q != &root_node; q = q->parent) {
        if (d >= FS_DEPTH_MAX) return 0;
        chain[d++] = q;
    }

    uint32_t pos = 0;                       /* invariant: pos < cap */
    while (d) {
        fs_node *q = chain[--d];
        uint32_t l = sstrlen(q->name);
        /* Need 1 ('/') + l + 1 (NUL) bytes. Written as subtraction so it
         * can't wrap: pos < cap holds, so cap - pos >= 1 always. */
        if (cap - pos < 2)          { out[pos] = 0; return 0; }
        if (l > cap - pos - 2)      { out[pos] = 0; return 0; }
        out[pos++] = '/';
        for (uint32_t i = 0; i < l; i++) out[pos++] = q->name[i];
    }
    out[pos] = 0;
    return pos;
}

uint32_t fs_cwd_path(char *out, uint32_t cap) { return fs_path(fs_cwd(), out, cap); }

int fs_chdir(const char *path) {
    fs_node *n = walk(path, W_NODE, 0);
    if (!n || n->kind != FS_DIR) return -1;
    cwd = n;
    return 0;
}

void fs_init(void) {
    nodes = 0;
    node_count = 0;

    /* Build the root by hand: it has no name, no parent and no place in
     * the list. Everything else hangs off it. */
    root_node.name[0]   = 0;
    root_node.kind      = FS_DIR;
    root_node.size      = 0;
    root_node.data      = 0;
    root_node.capacity  = 0;
    root_node.created_ms = root_node.modified_ms = pit_elapsed_ms();
    root_node.parent    = 0;
    root_node.next      = 0;
    cwd = &root_node;

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

    /* Seed the sample program as a real file so `exec hello.elf` reads
     * its bytes back out of the FS (exactly like cat/run) — the embedded
     * array is only the boot seed; cmd_exec never references it. This
     * branch runs only when NOT disk-loaded, so a user's saved copy on
     * disk is never clobbered. */
    fs_create("hello.elf", FS_FILE);
    fs_write("hello.elf", hello_elf, (uint32_t)hello_elf_len);

    /* The ring-3 isolation proof: `exec rogue.elf` runs a program that tries
     * to scribble on the kernel and gets killed for it, kernel surviving. */
    fs_create("rogue.elf", FS_FILE);
    fs_write("rogue.elf", rogue_elf, (uint32_t)rogue_elf_len);

    /* Ring-3 file I/O demo: `exec iodemo.elf` writes + reads a file from CPL 3
     * through the read/write syscalls, then `cat ring3.txt` shows the result. */
    fs_create("iodemo.elf", FS_FILE);
    fs_write("iodemo.elf", iodemo_elf, (uint32_t)iodemo_elf_len);
}

fs_node *fs_find(const char *path) {
    return walk(path, W_NODE, 0);
}

fs_node *fs_create(const char *path, uint32_t kind) {
    char leaf[FS_NAME_MAX + 1];
    fs_node *dir = walk(path, W_PARENT, leaf);
    if (!dir) return 0;                     /* parent missing, or no leaf to make */
    if (child_of(dir, leaf)) return 0;      /* already there */
    return new_node(dir, leaf, kind);
}

/* Loader-side create: makes missing parents, and ADOPTS a directory that
 * an earlier record already caused us to conjure. Node order on disk is
 * arbitrary, so "/a/b.txt" can legitimately be read before "/a" - when
 * "/a" finally shows up it must update the auto-made dir, not fail as a
 * duplicate. Anything else that collides is a corrupt image: return 0. */
static fs_node *fs_mkpath(const char *path, uint32_t kind) {
    char leaf[FS_NAME_MAX + 1];
    fs_node *dir = walk(path, W_PARENT_MK, leaf);
    if (!dir) return 0;
    fs_node *ex = child_of(dir, leaf);
    if (ex) return (ex->kind == FS_DIR && kind == FS_DIR) ? ex : 0;
    return new_node(dir, leaf, kind);
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

int fs_unlink(const char *path) {
    fs_node *gone = walk(path, W_NODE, 0);
    if (!gone || gone == &root_node) return -1;       /* you can't rm / */
    /* A directory with anything in it stays. Without this, its children
     * would keep a parent pointer into freed memory - every later path
     * walk would then be reading a dangling node. */
    if (gone->kind == FS_DIR && fs_first_in(gone)) return -1;

    fs_node **p = &nodes;
    while (*p) {
        if (*p == gone) {
            *p = gone->next;
            /* If we just deleted the directory we're standing in, step
             * out to its parent before the memory goes away. */
            if (cwd == gone) cwd = gone->parent ? gone->parent : &root_node;
            if (gone->data) kfree(gone->data);
            kfree(gone);
            node_count--;
            return 0;
        }
        p = &(*p)->next;
    }
    return -1;
}

fs_node  *fs_first(void)            { return nodes; }
fs_node  *fs_next(fs_node *n)       { return n ? n->next : 0; }
uint32_t  fs_count(void)            { return node_count; }

/* Children of one directory. The flat list means this is a scan per
 * step (see the header comment); at this fs's size that's a rounding
 * error next to the string compares a path walk already does. */
fs_node *fs_first_in(fs_node *dir) {
    if (!dir) dir = &root_node;
    for (fs_node *n = nodes; n; n = n->next)
        if (n->parent == dir) return n;
    return 0;
}

fs_node *fs_next_in(fs_node *dir, fs_node *n) {
    if (!dir) dir = &root_node;
    if (!n) return 0;
    for (fs_node *q = n->next; q; q = q->next)
        if (q->parent == dir) return q;
    return 0;
}

uint32_t fs_total_bytes(void) {
    uint32_t t = 0;
    for (fs_node *n = nodes; n; n = n->next) t += n->size;
    return t;
}

/* ─── Persistence ─────────────────────────────────────────
 *
 * On-disk layout (little-endian):
 *
 *   sector 0 = superblock:
 *     u32 magic = 0xA570F500
 *     u32 version = 2
 *     u32 node_count
 *     u32 total_data_bytes (sum of all file sizes)
 *     u8  reserved[496]
 *
 *   sectors 1..N = node table, packed:
 *     u32 magic_node = 0xA570F510
 *     u32 kind
 *     u32 size           (payload bytes in data, file only)
 *     u32 path_len
 *     u64 created_ms
 *     u64 modified_ms
 *     char path[path_len]            (FULL absolute path, no nul)
 *     u8   data[size]                (file only; pad to 8 bytes)
 *
 * v2 (directories): the string is the node's FULL path ("/a/b.txt"),
 * not its leaf, and its cap went from FS_NAME_MAX to FS_PATH_MAX. That
 * keeps the format flat - no parent ids, no ordering rules - because a
 * path is a self-contained description of where a node belongs. The
 * loader recreates each node by path and conjures any parent it hasn't
 * seen yet, so records may arrive in any order. FS_VERSION is 2, so a
 * v1 image is REJECTED by the version check rather than misread (a v1
 * leaf name would otherwise parse as a bogus relative path).
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
#define FS_VERSION  2u

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
    uint32_t path_len;      /* v2: length of the FULL path that follows */
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
     * mid-write.
     *
     * Sizing pass. Accumulated in 64-bit and bailed out at FS_LOAD_MAX:
     * the old uint32 `needed` could in principle wrap on a big enough
     * tree and under-allocate flat_buf, and refusing to WRITE an image
     * we could never read back is better than writing one that bricks
     * the next boot. */
    uint64_t needed = 0;
    for (fs_node *n = nodes; n; n = n->next) {
        char pbuf[FS_PATH_MAX + 1];
        uint32_t plen = fs_path(n, pbuf, sizeof(pbuf));
        if (plen == 0) return -1;                  /* unrepresentable path */
        needed += sizeof(struct node_hdr) + (uint64_t)plen + (uint64_t)n->size;
        needed = (needed + 7) & ~(uint64_t)7;
        if (needed > FS_LOAD_MAX) return -1;       /* too big to ever load back */
    }
    uint32_t total = round_up((uint32_t)needed, 512);
    if (flat_buf) { kfree(flat_buf); flat_buf = 0; }
    flat_buf = (uint8_t *)kmalloc(total > 0 ? total : 512);
    if (!flat_buf) return -1;
    zr(flat_buf, total);

    /* Pack nodes into flat_buf. Same fs_path() calls as the sizing pass
     * and nothing mutates in between, so `off` cannot outrun `total`. */
    uint32_t off = 0;
    uint32_t count = 0;
    uint32_t total_data = 0;
    for (fs_node *n = nodes; n; n = n->next) {
        char pbuf[FS_PATH_MAX + 1];
        uint32_t plen = fs_path(n, pbuf, sizeof(pbuf));
        if (plen == 0) return -1;
        struct node_hdr h;
        h.magic       = MAGIC_NODE;
        h.kind        = n->kind;
        h.size        = n->size;
        h.path_len    = plen;
        h.created_ms  = n->created_ms;
        h.modified_ms = n->modified_ms;
        cp(flat_buf + off, (const uint8_t *)&h, sizeof(h));
        off += sizeof(h);
        cp(flat_buf + off, (const uint8_t *)pbuf, plen);
        off += plen;
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
     * wrap below the 8 MiB cap and defeat it. v2 budgets FS_PATH_MAX
     * per node instead of FS_NAME_MAX (the header now carries a full
     * path), so this over-estimates by more than v1 did and rejects a
     * little sooner. That's the safe direction: it only ever refuses to
     * load, never under-reads. */
    uint64_t guess = (uint64_t)sb.node_count
                       * (uint64_t)(sizeof(struct node_hdr) + FS_PATH_MAX + 8)
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
     * first, then could bail mid-loop).
     *
     * The cwd is saved and restored alongside the list: it points INTO
     * the list, so a failed parse that restored the nodes but not the
     * cwd would leave us standing in a freed directory. */
    fs_node *saved_nodes = nodes;
    uint32_t saved_count = node_count;
    fs_node *saved_cwd   = cwd;
    nodes = 0;
    node_count = 0;
    cwd = &root_node;               /* the fresh tree starts at / */

    /* Invariant for the bounds below: off <= bytes at the top of every
     * check. Each check is written `x > bytes - off` (never `off + x >
     * bytes`) so a hostile length can't wrap the comparison. `bytes` is
     * 512-aligned, so the 8-byte round-up at the bottom can't push off
     * past it either. */
    uint64_t off = 0;
    int ok = 1;
    for (uint32_t i = 0; i < sb.node_count; i++) {
        if (sizeof(struct node_hdr) > bytes - off) { ok = 0; break; }
        struct node_hdr h;
        cp((uint8_t *)&h, buf + (uint32_t)off, sizeof(h));
        off += sizeof(h);
        if (h.magic != MAGIC_NODE)        { ok = 0; break; }
        if (h.path_len == 0)              { ok = 0; break; }
        if (h.path_len > FS_PATH_MAX)     { ok = 0; break; }
        if (h.path_len > bytes - off)     { ok = 0; break; }
        if (h.kind != FS_FILE && h.kind != FS_DIR) { ok = 0; break; }
        char pathbuf[FS_PATH_MAX + 1];
        cp((uint8_t *)pathbuf, buf + (uint32_t)off, h.path_len);
        pathbuf[h.path_len] = 0;
        off += h.path_len;

        /* Must be an absolute path: a relative one would resolve against
         * whatever the loader happened to be standing in. */
        if (pathbuf[0] != '/')            { ok = 0; break; }

        /* Recreate by path, conjuring parents we haven't met yet. 0 means
         * a collision or a malformed path -> the image is bad. */
        fs_node *n = fs_mkpath(pathbuf, h.kind);
        if (!n) { ok = 0; break; }
        /* Cap the REAL node total, not just the record count: each record
         * can conjure up to FS_DEPTH_MAX parents, so 4096 deep paths could
         * otherwise mint a quarter-million nodes and eat the heap. */
        if (node_count > FS_MAX_NODES) { ok = 0; break; }
        n->created_ms  = h.created_ms;
        n->modified_ms = h.modified_ms;

        if (h.size) {
            if (h.kind != FS_FILE)        { ok = 0; break; }   /* dirs have no payload */
            if (h.size > FS_FILE_MAX)     { ok = 0; break; }
            if (h.size > bytes - off)     { ok = 0; break; }
            if (ensure_capacity(n, h.size) != 0) { ok = 0; break; }
            cp(n->data, buf + (uint32_t)off, h.size);
            n->size = h.size;
            off += h.size;
        }
        off = (off + 7) & ~(uint64_t)7;   /* 64-bit round-up: can't wrap under 8 MiB */
    }

    kfree(buf);

    if (!ok) {
        free_list(nodes);           /* discard the partial parse */
        nodes = saved_nodes;        /* restore the prior list... */
        node_count = saved_count;
        cwd = saved_cwd;            /* ...and where we were standing in it */
        return -1;
    }
    free_list(saved_nodes);         /* success: drop the old list */
    return 0;
}
