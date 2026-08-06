/*
 * Astrion v2.0 — learn.c. See learn.h for what this is and why it is not
 * training.
 *
 * On-disk format is one pair per line, tab-separated:
 *
 *     open snake<TAB>open the snake game
 *
 * Plain text on purpose. The user can read it, edit it in the Editor, or delete
 * it. Software that decides things about you and stores that decision where you
 * cannot see it is a different kind of product than this one.
 */
#include "learn.h"

#include <stdint.h>
#include "fs.h"
#include "assist_match.h"   /* am_lc — the same lowercase the matcher uses */

#define LEARN_PATH "/learned.txt"

struct pair {
    char failed[LEARN_TEXT];
    char worked[LEARN_TEXT];
};

static struct pair tab[LEARN_MAX];
static int         n_pairs;

/* ─── small string helpers (freestanding: no libc here) ─── */

static int slen(const char *s) { int n = 0; while (s[n]) n++; return n; }

static void scopy(char *dst, const char *src, int cap) {
    int k = 0;
    while (src[k] && k < cap - 1) { dst[k] = src[k]; k++; }
    dst[k] = 0;
}

/* Compare ignoring case and surrounding blanks. Two humans asking the same
 * thing rarely agree on capitalisation, and a trailing space is invisible. */
static int same_norm(const char *a, const char *b) {
    while (*a == ' ' || *a == '\t') a++;
    while (*b == ' ' || *b == '\t') b++;
    int ea = slen(a), eb = slen(b);
    while (ea > 0 && (a[ea-1] == ' ' || a[ea-1] == '\t')) ea--;
    while (eb > 0 && (b[eb-1] == ' ' || b[eb-1] == '\t')) eb--;
    if (ea != eb) return 0;
    for (int i = 0; i < ea; i++)
        if (am_lc(a[i]) != am_lc(b[i])) return 0;
    return 1;
}

static int usable(const char *s) {
    if (!s) return 0;
    int n = slen(s);
    if (n == 0 || n >= LEARN_TEXT) return 0;
    /* A line with a tab or newline in it would corrupt the file format, and a
     * prompt containing one is not a thing a person types anyway. */
    for (int i = 0; i < n; i++)
        if (s[i] == '\t' || s[i] == '\n' || s[i] == '\r') return 0;
    return 1;
}

/* ─── persistence ─── */

static void save(void) {
    /* Bounded buffer, no allocation: LEARN_MAX lines of at most two texts plus
     * a tab and a newline. Sized from the constants so it cannot drift. */
    static char buf[LEARN_MAX * (LEARN_TEXT * 2 + 2) + 1];
    int w = 0;
    for (int i = 0; i < n_pairs; i++) {
        const char *f = tab[i].failed, *g = tab[i].worked;
        for (int k = 0; f[k]; k++) buf[w++] = f[k];
        buf[w++] = '\t';
        for (int k = 0; g[k]; k++) buf[w++] = g[k];
        buf[w++] = '\n';
    }
    buf[w] = 0;
    fs_write(LEARN_PATH, (const uint8_t *)buf, (uint32_t)w);
    fs_sync();          /* survive the reboot, or it was never learned */
}

void learn_init(void) {
    static uint8_t buf[LEARN_MAX * (LEARN_TEXT * 2 + 2) + 1];
    uint32_t got = 0;
    n_pairs = 0;
    /* fs_read returns the BYTE COUNT on success and -1 on failure, so the test
     * is "< 0", not "!= 0". Written the wrong way first, and every boot
     * silently loaded nothing: 33 != 0, so a perfectly good file was discarded
     * as an error. The only file that would ever have loaded is an empty one.
     * Caught by learn_test.py's reboot step, which is the only check in the
     * suite that could have — everything happens in RAM until you power-cycle. */
    if (fs_read(LEARN_PATH, buf, sizeof buf - 1, &got) < 0) return;   /* none yet */
    buf[got] = 0;

    uint32_t i = 0;
    while (i < got && n_pairs < LEARN_MAX) {
        char f[LEARN_TEXT], g[LEARN_TEXT];
        int a = 0, b = 0;
        while (i < got && buf[i] != '\t' && buf[i] != '\n')
            { if (a < LEARN_TEXT - 1) f[a++] = (char)buf[i]; i++; }
        f[a] = 0;
        if (i >= got || buf[i] != '\t') {          /* malformed: skip the line */
            while (i < got && buf[i] != '\n') i++;
            if (i < got) i++;
            continue;
        }
        i++;                                        /* over the tab */
        while (i < got && buf[i] != '\n')
            { if (b < LEARN_TEXT - 1) g[b++] = (char)buf[i]; i++; }
        g[b] = 0;
        if (i < got) i++;                           /* over the newline */
        if (usable(f) && usable(g) && !same_norm(f, g)) {
            scopy(tab[n_pairs].failed, f, LEARN_TEXT);
            scopy(tab[n_pairs].worked, g, LEARN_TEXT);
            n_pairs++;
        }
    }
}

/* ─── the two operations the Assistant uses ─── */

const char *learn_lookup(const char *prompt) {
    if (!usable(prompt)) return 0;
    for (int i = 0; i < n_pairs; i++)
        if (same_norm(tab[i].failed, prompt)) return tab[i].worked;
    return 0;
}

int learn_record(const char *failed, const char *worked) {
    /* Returns whether anything was actually stored, because the caller prints
     * "(learned: ...)" and used to print it unconditionally — claiming a lesson
     * that had been refused, so the very same prompt failed again seconds
     * later. A machine that says it remembered and then did not is worse than
     * one that never offered. */
    if (!usable(failed) || !usable(worked)) return 0;
    if (same_norm(failed, worked)) return 0;     /* teaches nothing */

    /* Already known? Update the answer rather than adding a duplicate: the most
     * recent correction is the one the user meant. */
    for (int i = 0; i < n_pairs; i++) {
        if (same_norm(tab[i].failed, failed)) {
            scopy(tab[i].worked, worked, LEARN_TEXT);
            save();
            return 1;
        }
    }

    /* The table is kept OLDEST-FIRST and appended to, so "drop the oldest"
     * is always index 0 — no matter whether the entries arrived this session or
     * were read off the disk at boot.
     *
     * It used to be a round-robin cursor, and that cursor could not survive a
     * reboot. learn_init set next_slot = n_pairs % LEARN_MAX, which is 0 on a
     * full table — but after the table has wrapped, slot 0 holds the NEWEST
     * pair. So the first lesson after every boot deleted the most recent thing
     * you had taught it and kept the second-oldest. rex caught it: teach 33
     * pairs, power cycle, teach one more, and the pair from just before the
     * reboot is the one that vanishes.
     *
     * A 31-entry shift is nothing next to the disk write that follows it, and
     * ordering that is true on disk as well as in RAM is worth far more than
     * the cursor saved. */
    int slot;
    if (n_pairs < LEARN_MAX) {
        slot = n_pairs++;
    } else {
        for (int i = 1; i < LEARN_MAX; i++) tab[i - 1] = tab[i];
        slot = LEARN_MAX - 1;
    }
    scopy(tab[slot].failed, failed, LEARN_TEXT);
    scopy(tab[slot].worked, worked, LEARN_TEXT);
    save();
    return 1;
}

int learn_count(void) { return n_pairs; }

const char *learn_failed_at(int i) {
    return (i >= 0 && i < n_pairs) ? tab[i].failed : 0;
}

const char *learn_worked_at(int i) {
    return (i >= 0 && i < n_pairs) ? tab[i].worked : 0;
}

void learn_forget_all(void) {
    n_pairs = 0;
    fs_unlink(LEARN_PATH);
    fs_sync();
}
