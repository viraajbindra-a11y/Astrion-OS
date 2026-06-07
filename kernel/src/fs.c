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
    /* Seed a couple of files so 'ls' has something to show before
     * the user does anything. */
    fs_create("readme.txt", FS_FILE);
    const char *welcome =
        "welcome to astrion v2.0\n"
        "\n"
        "this is an in-kernel filesystem living in RAM.\n"
        "try: ls, cat readme.txt, write log hi there\n"
        "files vanish at reboot — persistence is the next step.\n";
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
