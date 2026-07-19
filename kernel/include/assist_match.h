#ifndef ASSIST_MATCH_H
#define ASSIST_MATCH_H

/* Prompt matching for the Assistant, split out of wm.c so it can be unit
 * tested on the host. It is pure string logic with no kernel dependency, and
 * it has already produced two bugs of the same shape — a bare substring test
 * matching something the author did not have in mind. That class of bug is
 * invisible in review and obvious in a table of cases, so the table lives in
 * kernel/tests/test_assist_match.c and this header is what it includes.
 *
 * Since 2026-07-19 this header also owns the ORDER intents are tried in
 * (am_classify / am_action). That is deliberate: first-match-wins means a
 * broad intent placed above a narrow one silently eats the narrow one's
 * prompts, and that is a bug you can only see by asking "which intent does
 * this exact sentence land on?" — which is what the host test now asks, by
 * the hundred. The kernel side (wm.c) does the work; this side decides what
 * the work is.
 *
 * Kept dependency-free on purpose: no kernel headers, no libc. */

static inline char am_lc(char c)
{
    return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
}

/* Case-insensitive substring test. Note what this ISN'T: word-aware. "poem"
 * matches inside "poem.txt". Every caller has to hold that in mind — and for
 * anything shorter than a phrase, the caller should be using am_word instead. */
static inline int am_has(const char *h, const char *n)
{
    for (int i = 0; h[i]; i++) {
        int j = 0;
        while (n[j] && am_lc(h[i + j]) == am_lc(n[j])) j++;
        if (!n[j]) return 1;
    }
    return 0;
}

/* ─── word-aware matching ───────────────────────────────────────────────
 * The fix for the whole "poem matched inside poem.txt" family. A keyword is
 * only a match when it stands as its own word, so "rm" no longer fires inside
 * "confirm", "ram" no longer fires inside "program", "up" no longer fires
 * inside "backup.txt" and "date" no longer fires inside "update". */

static inline int am_alnum(char c)
{
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') ||
           (c >= 'A' && c <= 'Z');
}

/* Is h[k] part of a word, or punctuation around one?
 *
 * Alphanumerics always are. A '.', '_', '-' or '/' counts as word-internal
 * ONLY when glued to a word on both sides — which is exactly what makes
 * "notes.txt" a single token (so "notes" is not a word inside it) while
 * "memory." is a word plus a full stop (so "memory" is). Getting this
 * asymmetry right is the whole point: filenames must be opaque, sentences
 * must not be. */
static inline int am_wordch(const char *h, int k)
{
    char c = h[k];
    if (am_alnum(c)) return 1;
    if (c != '.' && c != '_' && c != '-' && c != '/') return 0;
    return k > 0 && am_alnum(h[k - 1]) && am_alnum(h[k + 1]);
}

/* n[0..nlen) must appear in h delimited by non-word characters. */
static inline int am_nword(const char *h, const char *n, int nlen)
{
    for (int i = 0; h[i]; i++) {
        int j = 0;
        while (j < nlen && h[i + j] && am_lc(h[i + j]) == am_lc(n[j])) j++;
        if (j != nlen) continue;
        if (i > 0 && am_wordch(h, i - 1)) continue;
        if (h[i + nlen] && am_wordch(h, i + nlen)) continue;
        return 1;
    }
    return 0;
}

static inline int am_word(const char *h, const char *n)
{
    int nlen = 0; while (n[nlen]) nlen++;
    return nlen ? am_nword(h, n, nlen) : 0;
}

/* Any of several alternatives, written as one '|'-separated string:
 * am_word_any(p, "ram|memory|heap"). Alternatives may contain spaces
 * ("what can you"); the word rules apply to the ends of each alternative. */
static inline int am_word_any(const char *h, const char *alts)
{
    int st = 0;
    for (int i = 0; ; i++) {
        if (alts[i] && alts[i] != '|') continue;
        if (i > st && am_nword(h, alts + st, i - st)) return 1;
        if (!alts[i]) return 0;
        st = i + 1;
    }
}

/* Is this sentence telling us NOT to do something?
 *
 * Only consulted by destructive branches. It is deliberately crude — it does
 * not scope the negation to a clause, so "delete notes.txt, don't keep it"
 * is refused too. That direction is correct: the cost of a false NEGATIVE
 * here is one clarifying reply, and the cost of a false positive is a file
 * the user cannot get back.
 *
 * Written because `do not delete decoy` and `never delete decoy` both DELETED
 * decoy.txt on a booted build. An assistant that acts on an instruction not to
 * act is worse than one that does nothing. */
static inline int am_negated(const char *p)
{
    return am_word_any(p, "not|dont|never|nevermind|cancel|stop|without|avoid") ||
           am_has(p, "don't") || am_has(p, "do nt") ||
           am_has(p, "no need") || am_has(p, "instead of");
}

/* ─── which file did the user actually NAME? ────────────────────────────
 *
 * What this replaces is last_word(): take the trailing token of the sentence
 * and staple ".txt" to it. On a booted build that meant
 *
 *     delete edge3.txt later   ->  deleted later.txt   (edge3.txt survived)
 *     delete a.txt and b.txt   ->  deleted b.txt       (a.txt survived)
 *
 * The user named a file and a DIFFERENT file was destroyed. That is worse
 * than refusing and worse than any negation miss, because the file that died
 * was never mentioned at all.
 *
 * So stop guessing: find the tokens that are genuinely file-shaped and COUNT
 * them. A token is file-shaped when it holds an INTERIOR '.' — a dot with a
 * letter or digit on both sides. Same asymmetry am_wordch() already draws, and
 * it is what separates "notes.txt" (a name) from "memory." (a word and a full
 * stop).
 *
 * The count is the whole point. Three outcomes, and a destructive caller has
 * to treat them differently:
 *
 *   NONE  nothing to act on -> refuse. Never fall back to a bare word.
 *   ONE   act on THAT token, wherever in the sentence it sits.
 *   MANY  refuse as ambiguous. Deleting one of two named files and silently
 *         leaving the other is a partial destructive action — its own bug,
 *         and one the user only finds out about later.
 *
 * Non-destructive callers (read, open) can stay lenient: being wrong there
 * costs a "no such file" line, not a file. */

/* Punctuation that can bracket a token without belonging to it.
 *
 * The trap this has to walk around: strip the full stop off "notes.txt."
 * without eating the extension dot. It works because trimming only ever
 * happens at the ENDS of a token and the file test runs afterwards — so
 * "notes.txt." loses its final stop and keeps its interior one, while
 * "memory." trims to "memory" and stops being file-shaped at all. */
static inline int am_trimch(char c)
{
    return c == '.' || c == ',' || c == '!' || c == '?' || c == ';' ||
           c == ':' || c == '"' || c == '\'' || c == '(' || c == ')';
}

/* Does t[a..b) hold a dot with alphanumerics on both sides? Range-based so no
 * token ever has to be copied out just to be tested. */
static inline int am_dotted_n(const char *t, int a, int b)
{
    for (int i = a + 1; i + 1 < b; i++)
        if (t[i] == '.' && am_alnum(t[i - 1]) && am_alnum(t[i + 1])) return 1;
    return 0;
}

/* Copy the nth (0-based) file-shaped token of p into out; return how many the
 * sentence holds IN TOTAL, so a caller can tell one from many. out is left
 * empty when there is no nth token.
 *
 * A token too long for `out` is not counted at all. FS_NAME_MAX is 63, so a
 * name that doesn't fit cannot name a file that exists — and truncating it
 * could land on one the user never typed, which is the exact bug this whole
 * function exists to stop. */
static inline int am_file_tokens(const char *p, int nth, char *out, int cap)
{
    int found = 0, st = 0;
    if (cap > 0) out[0] = 0;
    for (int i = 0; ; i++) {
        if (p[i] && p[i] != ' ' && p[i] != '\t') continue;
        int a = st, b = i;                       /* one token, [a,b) */
        while (a < b && am_trimch(p[a]))     a++;
        while (b > a && am_trimch(p[b - 1])) b--;
        if (am_dotted_n(p, a, b) && b - a < cap) {
            if (found == nth) {
                int k = 0;
                for (int j = a; j < b; j++) out[k++] = p[j];
                out[k] = 0;
            }
            found++;
        }
        if (!p[i]) return found;
        st = i + 1;
    }
}

enum am_named {
    AM_NAMED_NONE = 0,   /* no file-shaped token — refuse, don't guess */
    AM_NAMED_ONE,        /* exactly one — act on it */
    AM_NAMED_MANY,       /* two or more — ambiguous, refuse */
};

/* out always receives the FIRST file-shaped token (empty when there is none),
 * including in the MANY case: a refusal that can name what it saw is a
 * refusal the user can act on. */
static inline enum am_named am_named_file(const char *p, char *out, int cap)
{
    int n = am_file_tokens(p, 0, out, cap);
    return n == 0 ? AM_NAMED_NONE : (n == 1 ? AM_NAMED_ONE : AM_NAMED_MANY);
}

/* ─── the intent table, in priority order ───────────────────────────────
 *
 * Two passes, because the two halves are genuinely different animals:
 *
 *   am_classify — questions and switches. Pure: the answer depends only on
 *                 the words. Every one of these is terminal (the kernel side
 *                 always has something true to say), so a single ordered
 *                 chain is exactly right.
 *   am_action   — things that take a filename or a chunk of text. The kernel
 *                 side may fail to extract an argument and deliberately fall
 *                 THROUGH to the model ("write me a poem in the style of X"
 *                 must not become a file called "the"), so these can't be
 *                 terminal and can't live in the same chain.
 *
 * am_classify runs first, so anything it claims never reaches am_action. */

enum am_intent {
    AM_NONE = 0,
    AM_VERSION,      /* what build is this            */
    AM_IDENTITY,     /* who/what are you              */
    AM_HELP,         /* what can you do               */
    AM_CLOSE,        /* close this window             */
    AM_SET_CHANGE,   /* set the accent to teal        */
    AM_SET_SHOW,     /* what are my settings          */
    AM_MEMORY,       /* how much ram                  */
    AM_DISK,         /* how much space is left        */
    AM_CPU,          /* what cpu is this              */
    AM_TASKS,        /* what's running                */
    AM_CLEAR,        /* clear the screen              */
    AM_SCREEN,       /* what resolution is the screen */
    AM_APPS,         /* what apps do i have           */
    AM_UPTIME,       /* how long have you been up     */
    AM_BOOT,         /* what happened at boot         */
    AM_DATE,         /* what time is it               */
    AM_FILES_COUNT,  /* how many files do i have      */
    AM_FILES_LIST,   /* list my files                 */
};

static inline enum am_intent am_classify(const char *p)
{
    /* Which build. Above IDENTITY because "what is this" would otherwise eat
     * "what version is this". Safe the other way round: "who BUILT this" is
     * not the word "build", so identity keeps its own prompt. */
    if (am_word_any(p, "version|kernel|release|firmware") ||
        am_has(p, "what build") || am_has(p, "which build") ||
        am_has(p, "build date"))
        return AM_VERSION;

    /* Who/what are you — the honest pitch. The two guards are old and still
     * load-bearing: "what are you DOING" and "what's RUNNING" are questions
     * about the scheduler, not about identity. */
    if ((am_has(p, "who are you")   || am_has(p, "what are you") ||
         am_has(p, "who made")      || am_has(p, "who built")    ||
         am_has(p, "what is this")  || am_has(p, "whats this")   ||
         am_has(p, "introduce")     || am_has(p, "your name")    ||
         am_has(p, "yourself")      || am_has(p, "about astrion")||
         am_has(p, "is astrion")    || am_has(p, "what os")      ||
         am_has(p, "which os")      || am_has(p, "what kind of computer")) &&
        !am_word_any(p, "running|doing"))
        return AM_IDENTITY;

    /* What can you do. Guarded so "help me delete notes.txt" is a DELETE:
     * a destructive verb, or a filename, means they want the thing done and
     * not a menu. "help me read a file" (no filename) still gets the menu. */
    if ((am_word_any(p, "help|commands|command|capabilities|options") ||
         am_has(p, "what can you")   || am_has(p, "what can i ask") ||
         am_has(p, "what can i say") || am_has(p, "what do you do") ||
         am_has(p, "what else can")) &&
        !am_word_any(p, "delete|remove") && !am_has(p, ".txt"))
        return AM_HELP;

    /* Close the window. "quit"/"exit" are unambiguous on their own; "close"
     * and "dismiss" need to be pointed at something window-shaped, so that
     * "close notes.txt" is not a window command. */
    if (am_word_any(p, "quit|exit") ||
        (am_word_any(p, "close|dismiss|hide") &&
         am_word_any(p, "window|windows|assistant|chat|this|it|yourself")))
        return AM_CLOSE;

    /* Change a setting. Needs BOTH a change verb and the name of a settings
     * group, which is what keeps a bare colour word out of it — "write blue
     * to notes.txt" has no change verb and never reaches here. */
    if (am_word_any(p, "set|change|switch|use|turn|make it") &&
        am_word_any(p, "accent|colour|color|wallpaper|background|theme|clock"))
        return AM_SET_CHANGE;

    /* Report the current settings. The !open guard matters: "open the
     * settings" is a launch request and belongs to am_action's open handler,
     * which is the LAST thing tried — without the guard this steals it. */
    if ((am_word_any(p, "settings|preferences") ||
         (am_word_any(p, "what|whats|which|show|list|current") &&
          am_word_any(p, "accent|wallpaper|theme"))) &&
        !am_word_any(p, "open|launch"))
        return AM_SET_SHOW;

    /* Memory. Above DISK so "am i running out of memory" is a memory answer,
     * and above TASKS so the word "running" in it doesn't hijack it. */
    if (am_word_any(p, "memory|ram|heap"))
        return AM_MEMORY;

    /* Disk. ABOVE TASKS on purpose: "am i running out of space" contains the
     * word "running" and used to be answered with the scheduler table. */
    if (am_word_any(p, "disk|disks|storage|space|drive|drives|filesystem") ||
        am_has(p, "persist") || am_has(p, "how much room") ||
        am_has(p, "survive a reboot") || am_has(p, "hard drive"))
        return AM_DISK;

    /* CPU. Above TASKS because "processor" and "process" are neighbours; the
     * word rules already separate them, and the order is the second belt. */
    if (am_word_any(p, "cpu|processor|processors|chip|core|cores") ||
        am_has(p, "what am i running on"))
        return AM_CPU;

    /* Uptime. ABOVE TASKS, BOOT and DATE — all three own a word that a
     * natural uptime question tends to contain ("running", "boot", "time"),
     * and TASKS demonstrably ate "how long have you been running". Kept
     * narrow (a "how long" phrasing, or the literal word) so that
     * "how long is notes.txt" is not answered with the clock. */
    if (am_word(p, "uptime")       || am_has(p, "how long have you") ||
        am_has(p, "how long has")  || am_has(p, "how long since")    ||
        (am_has(p, "how long") && am_word_any(p, "been|on|running|awake")))
        return AM_UPTIME;

    /* The scheduler table. NOT for "open the task manager" — that is a launch
     * request and belongs to am_action's open handler. */
    if ((am_word_any(p, "running|process|processes|task|tasks|job|jobs|"
                        "scheduler|threads|ps") ||
         am_has(p, "what are you doing")) &&
        !am_word_any(p, "open|launch"))
        return AM_TASKS;

    /* Wipe the answer area. Above SCREEN so "clear the screen" is the action
     * and not a question about the display. "erase" is deliberately NOT here
     * — it belongs to DELETE, and this branch runs first, so having it in
     * both would turn "erase notes.txt" into a screen wipe. The .txt guard is
     * the same idea for "wipe notes.txt". */
    if (am_word_any(p, "clear|wipe") &&
        !am_word_any(p, "file|files|history") && !am_has(p, ".txt"))
        return AM_CLEAR;

    /* Screen geometry. Both a screen noun AND a size noun are required, so
     * "display notes.txt" stays a file read. */
    if (am_word_any(p, "resolution|pixels") ||
        (am_word_any(p, "screen|display") &&
         am_word_any(p, "size|big|wide|tall|dimensions|how|what|whats")))
        return AM_SCREEN;

    if (am_word_any(p, "apps|applications") ||
        (am_word_any(p, "what|whats|which|list|show") &&
         am_word_any(p, "programs|software")) ||
        am_has(p, "what can i open"))
        return AM_APPS;

    if (am_word_any(p, "boot|booted|booting|bootloader|startup|grub") ||
        am_has(p, "start up") || am_has(p, "when you started"))
        return AM_BOOT;

    /* "date" as a WORD — as a substring it fires inside "update", which put
     * "update notes.txt with hello" into the clock branch. */
    if (am_word_any(p, "date|time|clock|today") || am_has(p, "what day"))
        return AM_DATE;

    if ((am_has(p, "how many") || am_word_any(p, "count|number")) &&
        am_word_any(p, "file|files"))
        return AM_FILES_COUNT;

    if (am_word_any(p, "ls|dir") ||
        (am_word_any(p, "list|show|see|what|whats|which|how") &&
         am_word_any(p, "file|files|folder|folders|directory|directories|"
                        "documents")))
        return AM_FILES_LIST;

    return AM_NONE;
}

/* ─── argument-taking actions ───────────────────────────────────────────
 * Ordered so that the ones sharing a separator (" to " is used by rename,
 * copy, append and write alike) resolve to the most specific verb present. */

enum am_action {
    AM_ACT_NONE = 0,
    AM_ACT_RENAME,
    AM_ACT_COPY,
    AM_ACT_APPEND,
    AM_ACT_WRITE,
    AM_ACT_CREATE,
    AM_ACT_DELETE,
    AM_ACT_READ,
    AM_ACT_OPEN,
};

static inline enum am_action am_action_of(const char *p)
{
    if (am_word_any(p, "rename|move")) return AM_ACT_RENAME;

    /* Above WRITE: "save a copy of notes.txt to backup.txt" is a copy, and
     * treating it as a write would put the literal words "a copy of
     * notes.txt" into backup.txt. */
    if (am_word_any(p, "copy|duplicate")) return AM_ACT_COPY;

    /* "add" as a WORD, so that the natural phrasing "add hi to notes.txt"
     * lands here. Safe now that it is word-matched: as a substring it fires
     * inside "address" and "added". */
    if (am_word_any(p, "append|add|tack on")) return AM_ACT_APPEND;

    /* "put" is here as a WORD — as a substring it fires inside "output".
     * Deliberately NOT "log": it is a noun as often as a verb here ("show me
     * the log"), and claiming it turns a read into a failed write. */
    if (am_word_any(p, "write|save|put|store")) return AM_ACT_WRITE;

    /* The ".txt" arm is what makes bare "make notes.txt" work. The noun list
     * is what keeps "make up a name for my cat" out — it has the verb and
     * nothing file-shaped, so it falls through to the model, as it must. */
    if (am_word_any(p, "make|create|new|touch|mkdir") &&
        (am_word_any(p, "file|files|folder|folders|directory|note|notes") ||
         am_has(p, ".txt")))
        return AM_ACT_CREATE;

    /* ── DELETE: the only branch here that destroys data, so it is the only
     * one that has to be wrong in the SAFE direction ──
     *
     * Three guards, each earning its place from a case that actually deleted
     * a file on a booted build:
     *
     *   word-matched   "rm" as a substring fires inside "confirm", "alarm",
     *                  "perform" — `please confirm notes.txt` unlinked it.
     *   noun required  same guard CREATE already had. Without it the bare verb
     *                  claimed any sentence containing it and then deleted
     *                  whatever the last word resolved to:
     *                  `remove your assumptions` -> deleted assumptions.txt,
     *                  `what does delete do` -> tried to delete do.txt.
     *   not negated    `do not delete decoy` and `never delete decoy` BOTH
     *                  deleted decoy.txt. An instruction not to do a thing
     *                  triggering the thing is the worst failure this can
     *                  have, and no amount of noun-guarding catches it.
     *
     * A miss here costs one clarifying reply. A false positive costs the
     * user's file, with no undo and no confirmation prompt. Not symmetric. */
    if (am_word_any(p, "delete|remove|rm|erase|trash|unlink") &&
        (am_word_any(p, "file|files|folder|folders|directory|note|notes") ||
         am_has(p, ".txt")) &&
        !am_negated(p))
        return AM_ACT_DELETE;

    /* "read" as a WORD, or it fires inside "already", "bread", "spreadsheet".
     * "cat " keeps its trailing space rather than becoming a word: as a bare
     * word it would claim every sentence about somebody's cat. */
    if (am_word_any(p, "read|contents|content|print") || am_has(p, "cat ") ||
        (am_word_any(p, "show|display|see") && !am_word_any(p, "file|files")) ||
        (am_word_any(p, "what|whats") && am_word(p, "in")))
        return AM_ACT_READ;

    if (am_word_any(p, "open|launch|start|play|run|go to"))
        return AM_ACT_OPEN;

    return AM_ACT_NONE;
}

/* ─── why a destructive sentence was turned down ────────────────────────
 *
 * am_action_of() answers "what should I do", and for a refused delete the
 * answer is AM_ACT_NONE — indistinguishable from a sentence nobody could
 * parse. On a booted build that meant a blocked delete came back as the
 * generic "I didn't understand that one", so the user could not tell they had
 * been refused ON PURPOSE rather than misread. A guard the user can't see
 * looks like a bug, and the natural response to it is to retype the sentence.
 *
 * This is a second question asked ONLY after the action chain declined: the
 * verb was destructive, so which guard stopped it? Deliberately separate from
 * am_action_of rather than folded into it — the safe default has to stay
 * "return no action", and a caller that forgets to ask this loses a message,
 * not a file. */
enum am_refuse {
    AM_REFUSE_NONE = 0,  /* not a refused destructive sentence */
    AM_REFUSE_NEGATED,   /* told not to: "never delete decoy" */
    AM_REFUSE_UNNAMED,   /* destructive verb, nothing file-shaped named */
};

static inline enum am_refuse am_delete_refusal(const char *p)
{
    /* Both passes have to have declined it, or this is not a refusal at all:
     * the classifier owns "how do i remove a file" (a listing question) and
     * the action chain owns "show me what delete does" (a read). Neither is a
     * blocked delete and neither should be answered as one. */
    if (am_classify(p) != AM_NONE)          return AM_REFUSE_NONE;
    if (am_action_of(p) != AM_ACT_NONE)     return AM_REFUSE_NONE;
    if (!am_word_any(p, "delete|remove|rm|erase|trash|unlink"))
        return AM_REFUSE_NONE;
    return am_negated(p) ? AM_REFUSE_NEGATED : AM_REFUSE_UNNAMED;
}

/* ─── confirmation: the bound on everything a word list can't catch ─────
 *
 * Three negation misses survived the word list on a booted build, each one a
 * real file destroyed:
 *
 *   "I'd prefer you didn't delete edge1.txt"        ("didn't" isn't "don't")
 *   "under no circumstances delete edge2.txt"       (bare "no")
 *   "the last thing I want is to delete edge4.txt"  (no negation token AT ALL)
 *
 * The third one is the proof that adding words is the wrong shape of fix:
 * there is no keyword in it to add. Every list has a ceiling and every miss
 * above that ceiling costs a file.
 *
 * So bound it instead. A destructive action names its exact target and waits
 * for a yes. That converts every present AND future negation miss from data
 * loss into one keystroke, which is what real systems do — and it makes the
 * word list a convenience rather than the last line of defence. */
/* Would this operation destroy something the user cannot get back?
 *
 * `dst_has_content` is the kernel side's answer to the one question this
 * header cannot ask for itself: is there already a file at the destination,
 * with bytes in it? Passing it in rather than hard-coding a per-action yes/no
 * is what keeps the whole rule in one testable place — and the rule has a
 * shape that matters:
 *
 *   ASK when something is genuinely at risk. Not otherwise.
 *
 * `write hi to notes.txt` where notes.txt does NOT exist destroys nothing —
 * it is a create, it is the fastest thing the Assistant does, and it is the
 * demo's headline command. Putting a y/n in front of THAT would be a real cost
 * paid for no safety at all. Where notes.txt already holds 47 bytes, the same
 * sentence silently destroys 47 bytes, and that is worth one keystroke.
 *
 * So the negative case is load-bearing, not an optimisation, and the test
 * asserts it explicitly. If a later change "simplifies" this into asking every
 * time, that row is what catches it. */
static inline int am_needs_confirm(enum am_action a, int dst_has_content)
{
    switch (a) {
    /* Unlink is unrecoverable even when the file is empty: what is destroyed
     * is the named file itself, not merely its bytes. Always asks. */
    case AM_ACT_DELETE:
        return 1;

    /* Both replace the destination outright — fs_write does not merge, it
     * overwrites. Destructive only when there is something there to lose. */
    case AM_ACT_WRITE:
    case AM_ACT_COPY:
        return dst_has_content;

    /* Append only ever GROWS a file: it keeps every byte already in it and
     * adds to the end. There is nothing to lose, so there is nothing to ask
     * about, and gating it would be ceremony rather than safety. */
    case AM_ACT_APPEND:

    /* Rename keeps the bytes under the new name and already refuses to
     * clobber an existing destination. Create refuses a name that is taken.
     * Reads and opens change nothing at all. */
    case AM_ACT_RENAME:
    case AM_ACT_CREATE:
    case AM_ACT_READ:
    case AM_ACT_OPEN:
    case AM_ACT_NONE:
        return 0;
    }
    return 0;
}

/* Does this reply mean yes?
 *
 * A closed list of explicit affirmatives, and everything else — including the
 * empty string — means no. The empty case is load-bearing, not tidiness: a
 * stray Enter is known to re-fire the last thing the Assistant did, so a
 * confirmation that defaulted to yes would turn that into a weapon. It has to
 * take a deliberate keystroke to destroy a file, so silence is a decline.
 *
 * The negation check catches the answer that agrees and then takes it back
 * ("yes but not that one"). Retyping the command is NOT an answer either: one
 * question gets one deliberate yes, and anything else cancels. */
static inline int am_confirm_yes(const char *p)
{
    if (!p || !p[0]) return 0;
    if (am_negated(p)) return 0;
    return am_word_any(p, "y|yes|yeah|yep|yup|ok|okay|sure|confirm|"
                          "proceed|do it|go ahead");
}

/* Which app "open X" means. AM_OPEN_NONE means no app was named — the caller
 * then tries the last word as a filename, so "open notes.txt" works too. */
enum am_open {
    AM_OPEN_NONE = 0,
    AM_OPEN_EDITOR,
    AM_OPEN_SNAKE,
    AM_OPEN_FILES,
    AM_OPEN_TERMINAL,
    AM_OPEN_ASSIST,
    AM_OPEN_MONITOR,
    AM_OPEN_CALC,
    AM_OPEN_SETTINGS,
};

static inline enum am_open am_open_target(const char *p)
{
    /* No "browser" alias anywhere in here: there is no browser, and pointing
     * the word at Files would be the assistant inventing a capability. */
    if (am_word_any(p, "editor|edit|notepad"))           return AM_OPEN_EDITOR;
    if (am_word_any(p, "snake|game"))                    return AM_OPEN_SNAKE;
    if (am_word_any(p, "files|file manager|finder"))     return AM_OPEN_FILES;
    if (am_word_any(p, "terminal|shell|console|prompt")) return AM_OPEN_TERMINAL;
    if (am_word_any(p, "assistant|chat"))                return AM_OPEN_ASSIST;
    if (am_word_any(p, "monitor|task manager|activity")) return AM_OPEN_MONITOR;
    if (am_word_any(p, "calculator|calc|maths|math"))    return AM_OPEN_CALC;
    if (am_word_any(p, "settings|preferences"))          return AM_OPEN_SETTINGS;
    return AM_OPEN_NONE;
}

/* Which settings group a change request names, or -1. Mirrors the enum in
 * settings.h (SET_ACCENT / SET_WALL / SET_CLOCK) without including it — this
 * header stays kernel-free so the host test can reach it. */
static inline int am_setting_group(const char *p)
{
    if (am_word_any(p, "accent|colour|color"))                return 0; /* SET_ACCENT */
    if (am_word_any(p, "wallpaper|background|theme|desktop")) return 1; /* SET_WALL   */
    if (am_word_any(p, "clock|hour|hours"))                   return 2; /* SET_CLOCK  */
    return -1;
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
        am_has(p, "rename ") || am_has(p, "move ")   ||
        am_has(p, ".txt")) return 0;

    return am_has(p, "write me") || am_has(p, "make up") ||
           am_has(p, "a story")  || am_has(p, "a poem")  ||
           am_has(p, "imagine")  || am_has(p, "pretend");
}

#endif /* ASSIST_MATCH_H */
