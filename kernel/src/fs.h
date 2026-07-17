/*
 * Astrion v2.0 - In-memory filesystem
 *
 * A real directory tree. Every node stores only its LEAF name plus a
 * parent pointer; the tree shape lives in those pointers. The root "/"
 * is a fixed node inside fs.c that never appears in the node list, so
 * fs_count() still means "things the user made".
 *
 * Paths are ASCII, '/'-separated, up to FS_PATH_MAX bytes total with
 * each component up to FS_NAME_MAX. Absolute ("/a/b"), relative ("b"),
 * "." and ".." all resolve. Relative paths resolve against the current
 * working directory (fs_cwd / fs_chdir) - one cwd for the whole
 * machine, shared by the shell, the Assistant and ring-3 programs.
 *
 * API is intentionally minimal - just enough for cat / write / ls / rm
 * / mkdir / cd to be real, and for the ELF loader + persistence layer
 * to have a clear boundary.
 */

#ifndef ASTRION_FS_H
#define ASTRION_FS_H

#include <stdint.h>

#define FS_NAME_MAX  63     /* one path component, e.g. "notes.txt" */
#define FS_PATH_MAX  255    /* a whole path, e.g. "/a/b/notes.txt"  */
#define FS_DEPTH_MAX 64     /* how deep the tree may nest           */

enum {
    FS_FILE = 0,
    FS_DIR  = 1,
};

typedef struct fs_node {
    char            name[FS_NAME_MAX + 1];  /* LEAF name only - no separators */
    uint32_t        kind;                   /* FS_FILE | FS_DIR */
    uint32_t        size;
    uint8_t        *data;                   /* kmalloc'd buffer (file only) */
    uint32_t        capacity;               /* data buffer capacity */
    uint64_t        created_ms;             /* pit_elapsed_ms() at create */
    uint64_t        modified_ms;
    struct fs_node *parent;                 /* containing directory; root's is 0 */
    struct fs_node *next;                   /* link in the flat all-nodes list */
} fs_node;

void      fs_init(void);

/* Every one of these takes a PATH, resolved against the cwd when it
 * doesn't start with '/'. fs_create makes only the last component -
 * the parent directory must already exist (no implicit mkdir -p). */
fs_node  *fs_find(const char *path);
fs_node  *fs_create(const char *path, uint32_t kind);
int       fs_write(const char *path, const uint8_t *data, uint32_t len);
int       fs_append(const char *path, const uint8_t *data, uint32_t len);
int       fs_read(const char *path, uint8_t *out, uint32_t cap, uint32_t *out_len);
int       fs_unlink(const char *path);      /* refuses a non-empty directory */

/* Current directory. fs_cwd() is never NULL. fs_chdir returns 0 on
 * success, -1 if the path doesn't exist or isn't a directory. */
fs_node  *fs_root(void);
fs_node  *fs_cwd(void);
int       fs_chdir(const char *path);

/* Full absolute path of a node ("/" for the root). Writes at most `cap`
 * bytes including the NUL and returns the length written, or 0 if it
 * wouldn't fit (out is left empty). */
uint32_t  fs_path(fs_node *n, char *out, uint32_t cap);
uint32_t  fs_cwd_path(char *out, uint32_t cap);

/* Iteration over EVERY node, in no particular order. */
fs_node  *fs_first(void);
fs_node  *fs_next(fs_node *n);
uint32_t  fs_count(void);
uint32_t  fs_total_bytes(void);

/* Iteration over the direct children of one directory (dir = 0 means
 * the root). This is what `ls` and the Files app walk. */
fs_node  *fs_first_in(fs_node *dir);
fs_node  *fs_next_in(fs_node *dir, fs_node *n);

/* Persistence to/from disk. Both return 0 on success, -1 on no disk
 * or I/O error. sync writes everything in the node list to LBA 0
 * upward; load_from_disk does the inverse and rebuilds the tree. */
int fs_sync(void);
int fs_load_from_disk(void);

#endif
