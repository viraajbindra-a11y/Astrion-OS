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
 * Concurrency: the heap's rule (heap.c). Preemption is on, and ring-3
 * programs reach this tree from THEIR OWN task through the read/write
 * syscalls while the shell, the Assistant and the editor mutate it from
 * task 0 - so every mutation, and every copy-out that another task can
 * race, runs under fs_lock(): interrupts off, saved and restored so it
 * nests. One CPU means cli IS the lock. fs_sync() is the special case:
 * it snapshots the tree under the lock and then writes the disk with
 * interrupts ON (PIO takes seconds; masking the timer that long would
 * stop the machine), guarded by sync_busy so a second sync waits its
 * turn rather than sharing the buffers - two syncs at once used to
 * kfree() the same static image buffer out from under each other.
 * Task 0 walks nodes directly (fs_find, n->data) without the lock; it
 * is the only task that unlinks, so nothing it holds is freed under it,
 * and a ring-3 write to the very file it is reading at that instant can
 * at worst hand it a stale byte, never a wild pointer.
 */

#include <stdint.h>
#include "fs.h"
#include "heap.h"
#include "pit.h"
#include "ata.h"
#include "hello_elf.h"   /* generated: the embedded sample ELF, seeded as /hello.elf */
#include "rogue_elf.h"   /* generated: the hostile ring-3 program, seeded as /rogue.elf */
#include "iodemo_elf.h"  /* generated: the ring-3 file-I/O demo, seeded as /iodemo.elf */
#include "poke_elf.h"    /* generated: writer half of the isolation demo, /poke.elf */
#include "peek_elf.h"    /* generated: reader half of the isolation demo, /peek.elf */

/* kernel_mb2.c owns the serial primitives; borrow the same narrow hooks
 * elf.c and gdt.c use. The FS only ever speaks up when something is about
 * to cost the user data: a sync we refused, or a real image we found on
 * disk and couldn't read back. */
extern void serial_puts_x(const char *s);
extern void serial_put_u64_x(uint64_t v);

static fs_node *nodes;          /* flat list of every node EXCEPT the root */
static uint32_t node_count;
static fs_node  root_node;      /* "/" - never in `nodes`, never freed */
static fs_node *cwd;            /* always non-NULL once fs_init has run */

/* ─── The lock (see the header comment) ───────────────────
 * Save/restore rather than bare cli/sti so a caller that already had
 * interrupts off (a console-locked print, the boot path) gets them back
 * exactly as they were. Identical to heap.c's irq_save/irq_restore. */
static inline uint64_t fs_lock(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void fs_unlock(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}

/* Set while a sync (or the boot-time load) is between taking its snapshot
 * and finishing with the disk. Read and written only under fs_lock(). */
static volatile int sync_busy;

extern void task_yield(void);   /* task.c: let the sync that holds the disk run */

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
    uint64_t f = fs_lock();
    fs_node *n = walk(path, W_NODE, 0);
    if (!n || n->kind != FS_DIR) { fs_unlock(f); return -1; }
    cwd = n;
    fs_unlock(f);
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

    /* Per-process isolation, made visible. `exec poke.elf` writes a sentinel to
     * a fixed user VA and holds its address space open for 30s; `exec peek.elf`
     * run inside that window reads the SAME VA and finds zero, because it is a
     * different process under a different CR3. Seed them together — one without
     * the other proves nothing. */
    fs_create("poke.elf", FS_FILE);
    fs_write("poke.elf", poke_elf, (uint32_t)poke_elf_len);
    fs_create("peek.elf", FS_FILE);
    fs_write("peek.elf", peek_elf, (uint32_t)peek_elf_len);
}

fs_node *fs_find(const char *path) {
    return walk(path, W_NODE, 0);
}

/* The unlocked core: fs_write/fs_append create-on-miss inside their own
 * critical section, so they must not re-take the lock (it would nest fine,
 * but the point is that the miss and the create are ONE atomic step). */
static fs_node *create_locked(const char *path, uint32_t kind) {
    char leaf[FS_NAME_MAX + 1];
    fs_node *dir = walk(path, W_PARENT, leaf);
    if (!dir) return 0;                     /* parent missing, or no leaf to make */
    if (child_of(dir, leaf)) return 0;      /* already there */
    return new_node(dir, leaf, kind);
}

fs_node *fs_create(const char *path, uint32_t kind) {
    uint64_t f = fs_lock();
    fs_node *n = create_locked(path, kind);
    fs_unlock(f);
    return n;
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
    uint64_t f = fs_lock();
    fs_node *n = walk(name, W_NODE, 0);
    if (!n) n = create_locked(name, FS_FILE);
    if (!n || n->kind != FS_FILE)      { fs_unlock(f); return -1; }
    if (ensure_capacity(n, len) != 0)  { fs_unlock(f); return -1; }
    mmemcpy(n->data, data, len);
    n->size = len;
    n->modified_ms = pit_elapsed_ms();
    fs_unlock(f);
    return (int)len;
}

int fs_append(const char *name, const uint8_t *data, uint32_t len) {
    uint64_t f = fs_lock();
    fs_node *n = walk(name, W_NODE, 0);
    if (!n) n = create_locked(name, FS_FILE);
    if (!n || n->kind != FS_FILE)      { fs_unlock(f); return -1; }
    /* Guard size+len overflow: a wrapped sum would satisfy a small
     * capacity and let the mmemcpy run off the end of the heap block. */
    if (len > FS_FILE_MAX - n->size)   { fs_unlock(f); return -1; }
    if (ensure_capacity(n, n->size + len) != 0) { fs_unlock(f); return -1; }
    mmemcpy(n->data + n->size, data, len);
    n->size += len;
    n->modified_ms = pit_elapsed_ms();
    fs_unlock(f);
    return (int)len;
}

/* The copy runs under the lock: this is the read path another task can be
 * standing in when task 0 rewrites or unlinks the file, and a copy that is
 * interrupted halfway would resume from a data pointer krealloc has since
 * freed. At most 8 MiB, so the window is milliseconds. */
int fs_read(const char *name, uint8_t *out, uint32_t cap, uint32_t *out_len) {
    uint64_t f = fs_lock();
    fs_node *n = walk(name, W_NODE, 0);
    if (!n || n->kind != FS_FILE) { fs_unlock(f); return -1; }
    uint32_t copy = n->size < cap ? n->size : cap;
    mmemcpy(out, n->data, copy);
    fs_unlock(f);
    if (out_len) *out_len = copy;
    return (int)copy;
}

int fs_unlink(const char *path) {
    uint64_t f = fs_lock();
    fs_node *gone = walk(path, W_NODE, 0);
    if (!gone || gone == &root_node) { fs_unlock(f); return -1; }   /* you can't rm / */
    /* A directory with anything in it stays. Without this, its children
     * would keep a parent pointer into freed memory - every later path
     * walk would then be reading a dangling node. */
    if (gone->kind == FS_DIR && fs_first_in(gone)) { fs_unlock(f); return -1; }

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
            fs_unlock(f);
            return 0;
        }
        p = &(*p)->next;
    }
    fs_unlock(f);
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
 * On-disk layout (little-endian). TWO SLOTS, A and B, each a superblock
 * sector followed by up to FS_LOAD_MAX of packed image:
 *
 *   slot A: superblock at LBA 0,          image at LBA 1..
 *   slot B: superblock at LBA FS_SLOT_B,  image at LBA FS_SLOT_B+1..
 *
 *   superblock:
 *     u32 magic = 0xA570F500
 *     u32 version = 3
 *     u32 node_count
 *     u32 total_data_bytes (sum of all file sizes)
 *     u64 seq              (v3: this slot's generation; higher is newer)
 *     u32 image_bytes      (v3: packed image length, a multiple of 512)
 *     u32 crc              (v3: CRC-32 of those image_bytes)
 *     u8  reserved[480]
 *
 * WHY TWO SLOTS. A sync used to write the superblock to sector 0 FIRST and
 * the data after it, in place, over the previous image. A crash or reset
 * in the middle - and PIO takes seconds for a big image - left sector 0
 * describing nodes whose bytes were half old image, half new; the next
 * boot failed the parse, seeded, and the sync after that wrote the seeds
 * over what was left. Total loss from one badly-timed power cut. Writing
 * the data first and the superblock last does not fix that on its own,
 * because the data still lands on top of the only copy.
 *
 * So: every sync writes the slot the loaded image is NOT in - data
 * sectors first, superblock last, carrying seq = loaded seq + 1 and a
 * CRC of the image. The loader reads both superblocks, takes the highest
 * seq whose CRC matches its image, and falls back to the other slot if
 * that check fails. A crash at ANY point of a sync leaves the previous
 * image untouched in the other slot; a torn superblock or torn data
 * fails its CRC and the older generation loads instead, saying so. A v2
 * disk (one slot, no seq/CRC) loads as slot A at seq 0, and the next
 * sync writes slot B, so nothing a v2 kernel wrote is disturbed until
 * the sync after that has already replaced it. A disk too small for two
 * slots (under ~16 MiB) uses slot A only, with the torn-write detection
 * but without the fallback, and says so once per sync.
 *
 *   image sectors, packed:
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
 * The serializer rounds the image up to 512 and keeps writing sectors
 * as needed. The deserializer reads a superblock, validates magic +
 * version + CRC, then walks the image, allocating fs_nodes on the heap.
 *
 * Keeping a single contiguous append-style serialization makes
 * this trivially robust for the MVP. Fragmentation, free lists,
 * journals - all later.
 */

#define MAGIC_SB    0xA570F500u
#define MAGIC_NODE  0xA570F510u
#define FS_VERSION  3u
#define FS_VERSION_LEGACY 2u   /* one slot, no seq/CRC: read, never written */

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
    uint64_t seq;               /* v3 */
    uint32_t image_bytes;       /* v3 */
    uint32_t crc;               /* v3 */
    uint8_t  reserved[480];
} __attribute__((packed));

/* Slot geometry, in sectors. An image is at most FS_LOAD_MAX bytes
 * (image_fits), so a slot is one superblock + that many sectors, and
 * slot B starts right after slot A's last possible sector. */
#define FS_SLOT_SECTORS (1u + FS_LOAD_MAX / 512u)     /* 16385 */
#define FS_SLOT_B       FS_SLOT_SECTORS
#define FS_SLOT_LBA(slot) ((slot) ? FS_SLOT_B : 0u)

/* Which slot the tree in RAM came from, and its generation. -1 = none
 * (a fresh or foreign disk): the first sync then writes slot A at seq 1. */
static int      active_slot = -1;
static uint64_t active_seq;

/* CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) over the packed image.
 * Byte-at-a-time from a 256-entry table built on first use: an 8 MiB image
 * is a few tens of ms, and a typical one is kilobytes. This is what tells
 * a torn write from a whole one - the parse alone cannot, since a node
 * record can be perfectly well-formed and still be from the wrong sync. */
static uint32_t crc_table[256];
static int      crc_ready;

static uint32_t crc32_image(const uint8_t *p, uint32_t n) {
    if (!crc_ready) {
        for (uint32_t i = 0; i < 256; i++) {
            uint32_t c = i;
            for (int k = 0; k < 8; k++) c = (c & 1u) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            crc_table[i] = c;
        }
        crc_ready = 1;
    }
    uint32_t c = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < n; i++) c = crc_table[(c ^ p[i]) & 0xFFu] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}

struct node_hdr {
    uint32_t magic;
    uint32_t kind;
    uint32_t size;
    uint32_t path_len;      /* v2: length of the FULL path that follows */
    uint64_t created_ms;
    uint64_t modified_ms;
} __attribute__((packed));

/* The one sector of scratch the superblock goes through, on the way out
 * (fs_sync) and in (fs_load_from_disk). Both run under sync_busy, so it
 * has exactly one user at a time. The packed image itself is kmalloc'd
 * per sync and freed by that same sync - it used to be a static that the
 * NEXT sync freed on entry, which with two syncs in flight was a
 * use-after-free on a buffer one of them was still writing to disk. */
static uint8_t  sec_buf[512];

/* Tiny memcpy / memset locally to avoid SSE-via-memcpy. */
static void cp(uint8_t *d, const uint8_t *s, uint32_t n) { for (uint32_t i = 0; i < n; i++) d[i] = s[i]; }
static void zr(uint8_t *d, uint32_t n) { for (uint32_t i = 0; i < n; i++) d[i] = 0; }
static uint32_t round_up(uint32_t v, uint32_t a) { return (v + a - 1) & ~(a - 1); }

/* ─── The one image budget ────────────────────────────────
 *
 * fs_sync() and fs_load_from_disk() have to agree, exactly, about which
 * images fit - and the only way to guarantee that is to make them ask the
 * same function the same question.
 *
 * They used to each do their own arithmetic, and it did not match. The
 * loader has only two numbers off the superblock (node_count and
 * total_data_bytes) and cannot know the real path lengths until it parses,
 * so it budgets a worst-case FS_PATH_MAX per node. The writer knew the
 * actual paths and summed those instead. The writer's total is therefore
 * always the smaller one, which left a band - roughly FS_MAX_NODES nodes
 * with short paths and more than ~6.8 MiB of data - where sync cheerfully
 * wrote an image that the next boot's loader would refuse. And a refused
 * load falls back to the seed files, so the refusal looked exactly like a
 * factory reset: every file gone, no error, and the next sync writing the
 * seeds over the top of the image that was still down there. Silent total
 * data loss. Hence: one function, and sync asks it about the very numbers
 * it is about to write into the superblock.
 */

/* Worst-case bytes an image advertising these numbers could occupy. Every
 * term is widened to 64-bit BEFORE it is multiplied or added: node_count
 * is capped at FS_MAX_NODES by image_fits() and data_bytes is a uint32, so
 * the total tops out near 4 GiB and cannot wrap a uint64. (The old
 * all-uint32 version could wrap back down under the 8 MiB cap and defeat
 * it completely.) Over-estimating is the safe direction - it can only ever
 * refuse, never under-read. */
static uint64_t image_budget(uint32_t count, uint32_t data_bytes) {
    return (uint64_t)count * (uint64_t)(sizeof(struct node_hdr) + FS_PATH_MAX + 8)
         + (uint64_t)data_bytes + 4096;
}

/* Would an image advertising these numbers load back? BOTH ceilings live
 * in here, so no caller can honour one and forget the other. */
static int image_fits(uint32_t count, uint32_t data_bytes) {
    if (count > FS_MAX_NODES) return 0;
    return image_budget(count, data_bytes) <= FS_LOAD_MAX;
}

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

/* Take the disk for a sync. Waits while another sync holds it - the holder
 * is a task that only needs CPU time to finish, so yield to it - but not
 * forever: a disk that never comes back must not hang the desktop, so
 * after FS_SYNC_WAIT_MS the caller is told "busy" and keeps its RAM copy.
 * Returns 1 holding sync_busy, 0 if it gave up. Interrupts are ON on
 * return either way; the caller takes fs_lock() for its snapshot itself. */
#define FS_SYNC_WAIT_MS 5000u
static int sync_acquire(void) {
    uint64_t t0 = pit_elapsed_ms();
    for (;;) {
        uint64_t f = fs_lock();
        if (!sync_busy) { sync_busy = 1; fs_unlock(f); return 1; }
        fs_unlock(f);
        if (pit_elapsed_ms() - t0 > FS_SYNC_WAIT_MS) return 0;
        task_yield();
    }
}

static void sync_release(void) {
    uint64_t f = fs_lock();
    sync_busy = 0;
    fs_unlock(f);
}

int fs_sync(void) {
    if (!ata_present()) return -1;
    if (!sync_acquire()) {
        serial_puts_x("fs: sync busy - another sync held the disk for 5 s; this one refused\n");
        return -3;   /* busy: the tree is intact in RAM, just not written yet */
    }

    /* Build a single flat layout in RAM first, then split into
     * sectors. That's simpler than tracking partial-sector state
     * mid-write. The sizing and packing passes run under fs_lock() so
     * the tree cannot change between them (they must agree byte for
     * byte); the disk writes below run with interrupts back on.
     *
     * Sizing pass. `needed` is the EXACT packed size of the image, while
     * `count` and `data_bytes` are the two numbers the superblock is about
     * to advertise - which are what the next boot's loader will budget
     * from. All three accumulate in 64-bit, so none of them can wrap. */
    uint64_t lf = fs_lock();
    uint64_t needed = 0;
    uint64_t count = 0;
    uint64_t data_bytes = 0;
    for (fs_node *n = nodes; n; n = n->next) {
        char pbuf[FS_PATH_MAX + 1];
        uint32_t plen = fs_path(n, pbuf, sizeof(pbuf));
        if (plen == 0) { fs_unlock(lf); sync_release(); return -1; }   /* unrepresentable path */
        needed += sizeof(struct node_hdr) + (uint64_t)plen + (uint64_t)n->size;
        needed = (needed + 7) & ~(uint64_t)7;
        count++;
        data_bytes += n->size;
        /* Stop walking once the tree is past either ceiling - purely to
         * keep the work and the accumulators bounded. Both bails are
         * strictly implied by the image_fits() below (`needed` is never
         * more than image_budget()), so breaking out early can only ever
         * refuse something image_fits() refuses too. The partial totals
         * are then a floor, which is all the refusal needs. */
        if (count > FS_MAX_NODES || needed > FS_LOAD_MAX) break;
    }

    /* THE check, and the only one: the same function the next boot's
     * loader uses, handed the same numbers this sync would write into the
     * superblock. If this passes, that load cannot fail on size. If it
     * doesn't, sync is the thing that refuses - loudly, and leaving the
     * image already on disk untouched - because the alternative is a boot
     * that discards the lot without a word. Both casts are safe: the loop
     * above bails the moment either total passes its uint32-sized cap. */
    if (!image_fits((uint32_t)count, (uint32_t)data_bytes)) {
        serial_puts_x("fs: SYNC REFUSED - this tree cannot be loaded back, so writing it\n"
                      "fs: would destroy your files on the next boot. Nothing was written;\n"
                      "fs: the image already on disk is untouched. Delete some files.\n"
                      "fs:   nodes      = ");
        serial_put_u64_x(count);
        serial_puts_x(" (cap ");
        serial_put_u64_x(FS_MAX_NODES);
        serial_puts_x(")\n"
                      "fs:   data bytes = ");
        serial_put_u64_x(data_bytes);
        serial_puts_x("\n"
                      "fs:   would need = ");
        serial_put_u64_x(image_budget((uint32_t)count, (uint32_t)data_bytes));
        serial_puts_x(" bytes (cap ");
        serial_put_u64_x(FS_LOAD_MAX);
        serial_puts_x(")\n");
        fs_unlock(lf); sync_release();
        return -2;   /* refused (data-safe), distinct from a real write error */
    }
    uint32_t total = round_up((uint32_t)needed, 512);
    uint8_t *flat_buf = (uint8_t *)kmalloc(total > 0 ? total : 512);
    if (!flat_buf) { fs_unlock(lf); sync_release(); return -1; }
    zr(flat_buf, total);

    /* Pack nodes into flat_buf. Same fs_path() calls as the sizing pass
     * and nothing mutates in between, so `off` cannot outrun `total`.
     * This pass deliberately does NOT recount: the superblock below
     * carries the very numbers image_fits() approved, so the image can't
     * advertise something the loader was never asked about. */
    uint32_t off = 0;
    for (fs_node *n = nodes; n; n = n->next) {
        char pbuf[FS_PATH_MAX + 1];
        uint32_t plen = fs_path(n, pbuf, sizeof(pbuf));
        if (plen == 0) { fs_unlock(lf); kfree(flat_buf); sync_release(); return -1; }
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
    }
    fs_unlock(lf);      /* snapshot taken; the disk part runs with IRQs on */

    /* Pick the slot: the one the loaded image is NOT in, so the previous
     * generation survives this write whatever happens to it. A disk with
     * no room for slot B gets slot A every time - still CRC-checked, but
     * a crash mid-sync then has nothing older to fall back on. */
    int slot = active_slot == 0 ? 1 : 0;
    if (slot == 1 && (uint64_t)FS_SLOT_B + 1u + total / 512u > ata_total_sectors()) {
        serial_puts_x("fs: disk too small for a second image slot - syncing in place (no crash fallback)\n");
        slot = 0;
    }
    uint32_t base = FS_SLOT_LBA(slot);

    /* Data sectors FIRST, starting one past the slot's superblock. */
    int rc = 0;
    uint32_t lba = base + 1;
    for (uint32_t i = 0; rc == 0 && i < total; i += 512) {
        if (ata_write_sector(lba, flat_buf + i) != 0) rc = -1;
        lba++;
    }

    /* Superblock LAST: until this sector lands, the slot still describes
     * whatever it held before. Both casts are the ones image_fits() vetted. */
    struct sb sb;
    zr((uint8_t *)&sb, sizeof(sb));
    sb.magic = MAGIC_SB;
    sb.version = FS_VERSION;
    sb.node_count = (uint32_t)count;
    sb.total_data_bytes = (uint32_t)data_bytes;
    sb.seq = active_seq + 1u;
    sb.image_bytes = total;
    sb.crc = crc32_image(flat_buf, total);
    zr(sec_buf, 512);
    cp(sec_buf, (const uint8_t *)&sb, sizeof(sb));
    if (rc == 0 && ata_write_sector(base, sec_buf) != 0) rc = -1;

    if (rc == 0) {
        /* The tree in RAM is now this generation, in this slot. */
        active_slot = slot;
        active_seq  = sb.seq;
    }
    kfree(flat_buf);
    sync_release();
    return rc;
}

/* Say so, out loud. Past the magic+version checks the superblock is
 * claiming "I am a v2 Astrion image", so bailing from here on means we are
 * about to discard a real filesystem and boot the seed files in its place
 * - and the next fs_sync() will then write those seeds straight over the
 * image that is still sitting on the platter. That is the one thing in
 * this file worth shouting about, so it never happens quietly again. */
static int load_failed(const char *why) {
    serial_puts_x("fs: !!! a v2 image IS on this disk but FAILED to load: ");
    serial_puts_x(why);
    serial_puts_x("\nfs: !!! booting SEED files instead. Your files are still on disk -\n"
                  "fs: !!! do NOT sync, it would overwrite them with the seeds.\n");
    return -1;
}

/* Boot-time only (fs_init, before any other task exists), but it shares
 * sec_buf with fs_sync and swaps the whole tree at the end, so it holds
 * sync_busy like a sync does and does the swap under fs_lock(). Every
 * early return goes through load_done() so the flag cannot leak. */
static int load_done(int rc) { sync_release(); return rc; }

/* Read one slot's superblock and say whether it names an image we could
 * load: magic, a version we read, and for v3 a sane image length. Fills
 * *out; returns 1 if it is a candidate, 0 if not (a foreign/blank sector,
 * a v2 superblock anywhere but slot A, a torn v3 header). Says nothing:
 * the caller decides what is worth a line. */
static int sb_candidate(int slot, struct sb *out) {
    uint32_t base = FS_SLOT_LBA(slot);
    if (base >= ata_total_sectors()) return 0;               /* slot past the disk */
    if (ata_read_sector(base, sec_buf) != 0) return 0;
    cp((uint8_t *)out, sec_buf, sizeof(*out));
    if (out->magic != MAGIC_SB) return 0;
    if (out->version == FS_VERSION_LEGACY) {
        if (slot != 0) return 0;                             /* v2 only ever lived at 0 */
        out->seq = 0;                                        /* oldest possible */
        out->image_bytes = 0;                                /* "use the budget" */
        out->crc = 0;
        return 1;
    }
    if (out->version != FS_VERSION) return 0;
    if (out->image_bytes == 0 || (out->image_bytes & 511u) != 0) return 0;
    if (out->image_bytes > FS_LOAD_MAX) return 0;
    return 1;
}

/* Read slot `slot`'s image as described by `sb` into a fresh kmalloc buffer
 * of *out_bytes bytes (a multiple of 512), CRC-checked for v3. Returns the
 * buffer, or 0 with a reason in *why. */
static uint8_t *read_image(int slot, const struct sb *sb, uint32_t *out_bytes, const char **why) {
    uint32_t bytes = sb->version == FS_VERSION_LEGACY
        ? round_up((uint32_t)image_budget(sb->node_count, sb->total_data_bytes), 512)
        : sb->image_bytes;
    uint8_t *buf = (uint8_t *)kmalloc(bytes);
    if (!buf) { *why = "out of heap for the read buffer"; return 0; }
    uint32_t lba = FS_SLOT_LBA(slot) + 1;
    for (uint32_t i = 0; i < bytes; i += 512) {
        if (ata_read_sector(lba, buf + i) != 0) { kfree(buf); *why = "disk read error"; return 0; }
        lba++;
    }
    if (sb->version != FS_VERSION_LEGACY && crc32_image(buf, bytes) != sb->crc) {
        kfree(buf); *why = "its CRC does not match (a torn write)"; return 0;
    }
    *out_bytes = bytes;
    return buf;
}

static int load_image(int slot, const struct sb *sb, const uint8_t *buf, uint32_t bytes);

int fs_load_from_disk(void) {
    if (!ata_present()) return -1;
    if (!sync_acquire()) return -1;

    /* Both slots, newest first. Nothing of ours in either - a blank or
     * foreign disk - is not an error and not worth a word: fs_init seeds
     * and moves on. A v-other-than-2-or-3 header IS worth one: those files
     * are real and the next sync would land on top of them. */
    struct sb cand[2];
    int have[2];
    for (int i = 0; i < 2; i++) have[i] = sb_candidate(i, &cand[i]);
    if (!have[0] && !have[1]) {
        struct sb raw;
        if (ata_read_sector(0, sec_buf) == 0) {
            cp((uint8_t *)&raw, sec_buf, sizeof(raw));
            if (raw.magic == MAGIC_SB) {
                serial_puts_x("fs: disk holds a v");
                serial_put_u64_x(raw.version);
                serial_puts_x(" image; this kernel reads v2 and v3 only - ignoring it and booting seeds.\n"
                              "fs: the old image stays on disk until something syncs over it.\n");
            }
        }
        return load_done(-1);
    }
    int order[2];
    if (have[0] && have[1]) {
        order[0] = cand[1].seq > cand[0].seq ? 1 : 0;   /* ties go to A */
        order[1] = 1 - order[0];
    } else {
        order[0] = have[0] ? 0 : 1;
        order[1] = -1;
    }

    for (int k = 0; k < 2 && order[k] >= 0; k++) {
        int slot = order[k];
        const struct sb *sb = &cand[slot];
        if (sb->node_count == 0) {                /* clean image: nothing to load */
            active_slot = slot; active_seq = sb->seq;
            return load_done(0);
        }
        /* How many bytes to slurp - and whether to slurp at all. Same
         * function fs_sync() clears an image through before writing it, so
         * our own sync can no longer produce anything that lands here. A
         * superblock that still fails this is corrupt, hostile, or was
         * written by a kernel with wider caps than ours. */
        if (!image_fits(sb->node_count, sb->total_data_bytes)) {
            serial_puts_x("fs: slot ");
            serial_puts_x(slot ? "B" : "A");
            serial_puts_x(" superblock claims ");
            serial_put_u64_x(sb->node_count);
            serial_puts_x(" nodes / ");
            serial_put_u64_x(sb->total_data_bytes);
            serial_puts_x(" data bytes - that doesn't fit the load caps; skipping it\n");
            continue;
        }
        const char *why = 0;
        uint32_t bytes = 0;
        uint8_t *buf = read_image(slot, sb, &bytes, &why);
        if (!buf) {
            serial_puts_x("fs: slot ");
            serial_puts_x(slot ? "B" : "A");
            serial_puts_x(" (seq ");
            serial_put_u64_x(sb->seq);
            serial_puts_x(") could not be read: ");
            serial_puts_x(why);
            serial_puts_x(k == 0 && order[1] >= 0 ? " - trying the other slot\n" : "\n");
            continue;
        }
        int rc = load_image(slot, sb, buf, bytes);
        kfree(buf);
        if (rc == 0) {
            active_slot = slot; active_seq = sb->seq;
            if (k > 0) {
                serial_puts_x("fs: loaded the OLDER generation from slot ");
                serial_puts_x(slot ? "B" : "A");
                serial_puts_x(" (seq ");
                serial_put_u64_x(sb->seq);
                serial_puts_x("); the newest sync did not complete\n");
            }
            return load_done(0);
        }
        serial_puts_x("fs: slot ");
        serial_puts_x(slot ? "B" : "A");
        serial_puts_x(" has a malformed record");
        serial_puts_x(k == 0 && order[1] >= 0 ? " - trying the other slot\n" : "\n");
    }
    return load_done(load_failed("no slot held a whole image"));
}

/* Parse `bytes` of a slot's image into the live tree. Returns 0 on success
 * (the old tree freed), -1 if a record is malformed (the old tree intact). */
static int load_image(int slot, const struct sb *sb, const uint8_t *buf, uint32_t bytes) {
    (void)slot;
    /* Parse into a FRESH list, leaving the existing one (the seeds, or
     * a previously-mounted FS) untouched until we know the whole image
     * is valid. A corrupt disk must not leave a half-built filesystem
     * NOR double-seed on top of a partial parse (the old code wiped
     * first, then could bail mid-loop).
     *
     * The cwd is saved and restored alongside the list: it points INTO
     * the list, so a failed parse that restored the nodes but not the
     * cwd would leave us standing in a freed directory. */
    uint64_t lf = fs_lock();
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
    for (uint32_t i = 0; i < sb->node_count; i++) {
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

    if (!ok) {
        free_list(nodes);           /* discard the partial parse */
        nodes = saved_nodes;        /* restore the prior list... */
        node_count = saved_count;
        cwd = saved_cwd;            /* ...and where we were standing in it */
        fs_unlock(lf);
        return -1;
    }
    free_list(saved_nodes);         /* success: drop the old list */
    fs_unlock(lf);
    return 0;
}
