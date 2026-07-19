#ifndef ASSIST_MATCH_H
#define ASSIST_MATCH_H

/* Prompt matching for the Assistant, split out of wm.c so it can be unit
 * tested on the host. It is pure string logic with no kernel dependency, and
 * it has already produced two bugs of the same shape — a bare substring test
 * matching something the author did not have in mind. That class of bug is
 * invisible in review and obvious in a table of cases, so the table lives in
 * kernel/tests/test_assist_match.c and this header is what it includes.
 *
 * Kept dependency-free on purpose: no kernel headers, no libc. */

static inline char am_lc(char c)
{
    return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
}

/* Case-insensitive substring test. Note what this ISN'T: word-aware. "poem"
 * matches inside "poem.txt". Every caller has to hold that in mind. */
static inline int am_has(const char *h, const char *n)
{
    for (int i = 0; h[i]; i++) {
        int j = 0;
        while (n[j] && am_lc(h[i + j]) == am_lc(n[j])) j++;
        if (!n[j]) return 1;
    }
    return 0;
}

/* Did the user actually ask for invented text, rather than just say something
 * the intent table failed to parse? Only these reach the 212K model.
 *
 * The obvious version of this — testing for "poem" — turns `read poem.txt`
 * into a poetry request. It did exactly that on a booted build. Two defences:
 * a file operation always wins, and the creative words are matched with their
 * article ("a poem", never bare "poem") so a filename cannot trip them. */
static inline int am_wants_generation(const char *p)
{
    if (am_has(p, "read ")   || am_has(p, "open ")   || am_has(p, "delete ") ||
        am_has(p, "copy ")   || am_has(p, "append ") || am_has(p, "list ")   ||
        am_has(p, ".txt")) return 0;

    return am_has(p, "write me") || am_has(p, "make up") ||
           am_has(p, "a story")  || am_has(p, "a poem")  ||
           am_has(p, "imagine")  || am_has(p, "pretend");
}

#endif /* ASSIST_MATCH_H */
