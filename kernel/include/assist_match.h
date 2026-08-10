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

/* How many file-shaped tokens the sentence holds, when the caller wants the
 * COUNT and not the name. Carries its own buffer on purpose: am_file_tokens
 * counts nothing at all when cap is 0 (its length test is `b - a < cap`), so
 * the tempting am_file_tokens(p, 0, 0, 0) silently answers "none" for every
 * sentence ever written. */
static inline int am_count_files(const char *p)
{
    char t[80];
    return am_file_tokens(p, 0, t, (int)sizeof t);
}

/* Is the whole prompt nothing but one of these words?
 *
 * For verbs that are unambiguous ALONE and ambiguous in company. Bare "close"
 * can only mean the window — there is no other object in the sentence to
 * close — while "close notes.txt" names a file and "shut down the machine"
 * names the machine. Matching the whole prompt is what separates them, and it
 * cannot misfire on a longer sentence by construction. */
static inline int am_is_just(const char *p, const char *alts)
{
    int a = 0;
    while (p[a] == ' ' || p[a] == '\t') a++;
    int b = a;
    while (p[b]) b++;
    while (b > a && (p[b-1] == ' ' || p[b-1] == '\t' || am_trimch(p[b-1]))) b--;

    for (const char *s = alts; ; ) {
        const char *e = s;
        while (*e && *e != '|') e++;
        int n = (int)(e - s);
        if (n == b - a) {
            int k = 0;
            while (k < n && am_lc(p[a + k]) == am_lc(s[k])) k++;
            if (k == n) return 1;
        }
        if (!*e) return 0;
        s = e + 1;
    }
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
         am_has(p, "which os")      || am_has(p, "what kind of computer") ||
         /* "who am i talking to" and "what should i call you" are the two
          * commonest openers a stranger types, and both used to get the
          * honest shrug. Both are anchored on "you", so neither can be
          * reached by a sentence about a file — "call notes.txt todo.txt"
          * has the verb and not the pronoun. */
         am_has(p, "talking to")    || am_has(p, "call you")   ||
         /* "are you chatgpt" and "are you an ai" are the first thing a
          * stranger types, and both got the honest shrug. The anchor is broad
          * on purpose — every "are you X" is a question about what this is,
          * and identity is a safe thing to answer with. The two guards below
          * still take back "are you running" and "what are you doing". */
         am_has(p, "are you")) &&
        !am_word_any(p, "running|doing"))
        return AM_IDENTITY;

    /* What can you do. Guarded so "help me delete notes.txt" is a DELETE:
     * a destructive verb, or a filename, means they want the thing done and
     * not a menu. "help me read a file" (no filename) still gets the menu. */
    if ((am_word_any(p, "help|commands|command|capabilities|options") ||
         am_has(p, "what can you")   || am_has(p, "what can i ask") ||
         am_has(p, "what can i say") || am_has(p, "what do you do") ||
         am_has(p, "what else can")  ||
         /* "show me what YOU CAN do" — same question, different word order,
          * and the READ arm was claiming it because it starts with "show".
          * "how do i use this" is the other one a first-time user types. */
         am_has(p, "what you can")   || am_has(p, "how do i use") ||
         am_has(p, "how to use")     || am_has(p, "what do i do") ||
         (am_has(p, "how does") && am_word(p, "work"))            ||
         /* "im stuck" is a person asking for help. "is anything stuck" is a
          * question about the scheduler, and TASKS answers it — which is why
          * this is the two exact phrasings and not the bare word "stuck". */
         am_has(p, "im stuck")       || am_has(p, "i'm stuck")) &&
        !am_word_any(p, "delete|remove") && !am_has(p, ".txt"))
        return AM_HELP;

    /* Close the window. "quit"/"exit" are unambiguous on their own; "close"
     * and "dismiss" need to be pointed at something window-shaped, so that
     * "close notes.txt" is not a window command.
     *
     * The bare word got its own arm because the guard above was refusing the
     * single commonest way to say it. Typing just `close` was answered with
     * "I didn't understand that one" — a sentence with one word in it, and
     * nothing else in it to close. am_is_just matches the WHOLE prompt, so it
     * cannot leak into "close notes.txt" the way relaxing the guard would.
     *
     * "shut" joins the pointed arm minus down/off: "shut this" is the window,
     * "shut this down" is the machine, and there is no power intent here — so
     * claiming it would mean confidently closing a window when the user asked
     * to turn the computer off. Falling through to the menu is the honest
     * answer until a power intent exists. */
    if (am_word_any(p, "quit|exit") ||
        am_is_just(p, "close|shut|dismiss") ||
        /* Ways of leaving that never use the word "close". Whole phrases, not
         * keywords, because "mind", "away" and "out" on their own belong to
         * far too many other sentences. */
        am_has(p, "never mind") || am_has(p, "go away") ||
        am_has(p, "get out of here") ||
        (am_word_any(p, "close|dismiss|hide|shut") &&
         am_word_any(p, "window|windows|assistant|chat|this|it|yourself") &&
         !am_word_any(p, "down|off")))
        return AM_CLOSE;

    /* Change a setting. Needs BOTH a change verb and the name of a settings
     * group, which is what keeps a bare colour word out of it — "write blue
     * to notes.txt" has no change verb and never reaches here. */
    if (((am_word_any(p, "set|change|switch|use|turn|make|want") &&
          am_word_any(p, "accent|colour|color|wallpaper|background|theme|clock")) ||
         /* "make it purple" — a change verb and a VALUE, with the group left
          * unsaid because it is obvious to a person. am_setting_group maps the
          * bare colour back to the accent. */
         ((am_has(p, "make it") || am_has(p, "turn it")) &&
          am_word_any(p, "blue|purple|teal|green|orange|pink")) ||
         /* "12 hour clock" — a value and a group and no verb at all. Above
          * DATE, which owns the word "clock" and was answering it with the
          * time. The digits are what keep the question "what time is it" out. */
         (am_word_any(p, "12|24") && am_word_any(p, "hour|hours|clock"))) &&
        !am_has(p, ".txt"))
        return AM_SET_CHANGE;

    /* Report the current settings. The !open guard matters: "open the
     * settings" is a launch request and belongs to am_action's open handler,
     * which is the LAST thing tried — without the guard this steals it. */
    if ((am_word_any(p, "settings|preferences") ||
         (am_word_any(p, "what|whats|which|show|list|current") &&
          am_word_any(p, "accent|wallpaper|theme"))) &&
        !am_word_any(p, "open|launch") &&
        !am_has(p, "bring up") && !am_has(p, "fire up") && !am_has(p, "pull up"))
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
        am_has(p, "what am i running on") || am_has(p, "how fast"))
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
                        "scheduler|threads|ps|stuck|frozen|hung") ||
         am_has(p, "what are you doing") ||
         /* "what's going on" is how people ask this out loud. Safe here and
          * not higher: MEMORY, DISK and CPU all run above, so "what's going
          * on with the disk" is still a disk answer. */
         am_has(p, "going on")) &&
        !am_word_any(p, "open|launch"))
        return AM_TASKS;

    /* Wipe the answer area. Above SCREEN so "clear the screen" is the action
     * and not a question about the display. "erase" is deliberately NOT here
     * — it belongs to DELETE, and this branch runs first, so having it in
     * both would turn "erase notes.txt" into a screen wipe. The .txt guard is
     * the same idea for "wipe notes.txt". */
    if (am_word_any(p, "clear|wipe|clean") &&
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
        am_has(p, "what can i open") || am_has(p, "what can i run"))
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
        (am_word_any(p, "list|show|see|what|whats|which|how|gimme|have|got") &&
         am_word_any(p, "file|files|folder|folders|directory|directories|"
                        "documents")) ||
        /* "what's on here", "what have I got saved", "list everything" — the
         * way you ask when you do not know the word "file" is the thing to
         * say. All four of these landed on the honest shrug, and two of them
         * were being claimed by the READ arm and answered with "no file
         * called here.txt", which is worse than the shrug.
         *
         * The .txt guard is what keeps it honest in the other direction:
         * "what is saved in notes.txt" names a file and must stay a read. */
        (am_word_any(p, "list|show|see|what|whats|gimme") &&
         (am_has(p, "on here") || am_has(p, "in here") ||
          am_word_any(p, "saved|stored|everything|stuff")) &&
         !am_has(p, ".txt")))
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

/* Which app "open X" means. AM_OPEN_NONE means no app was named — the caller
 * then tries the last word as a filename, so "open notes.txt" works too.
 *
 * Lives ABOVE am_action_of because am_action_of now consults it: whether a
 * sentence names an app is the difference between a launch and a read, and
 * that question has to be askable before the read arm gets its turn. */
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

static inline enum am_action am_action_of(const char *p)
{
    if (am_word_any(p, "rename|move")) return AM_ACT_RENAME;

    /* "change a.txt to b.txt" and "call a.txt b.txt instead" are renames in
     * the words people actually use. Neither verb can be claimed on its own —
     * "change the accent to green" is a setting and "what should i call you"
     * is the identity question — so this arm demands TWO file-shaped tokens,
     * which every rename has by definition and neither of those sentences has
     * even one. The count does the guarding, not a keyword blocklist. */
    if (am_word_any(p, "change|call") && am_count_files(p) == 2)
        return AM_ACT_RENAME;

    /* Above WRITE: "save a copy of notes.txt to backup.txt" is a copy, and
     * treating it as a write would put the literal words "a copy of
     * notes.txt" into backup.txt. */
    if (am_word_any(p, "copy|duplicate")) return AM_ACT_COPY;

    /* "add" as a WORD, so that the natural phrasing "add hi to notes.txt"
     * lands here. Safe now that it is word-matched: as a substring it fires
     * inside "address" and "added". */
    if (am_word_any(p, "append|add|tack|onto")) return AM_ACT_APPEND;

    /* "put" is here as a WORD — as a substring it fires inside "output".
     * Deliberately NOT "log": it is a noun as often as a verb here ("show me
     * the log"), and claiming it turns a read into a failed write. */
    if (am_word_any(p, "write|save|put|store|set|stick")) return AM_ACT_WRITE;

    /* The ".txt" arm is what makes bare "make notes.txt" work. The noun list
     * is what keeps "make up a name for my cat" out — it has the verb and
     * nothing file-shaped, so it falls through to the model, as it must. */
    /* "need" is here and guarded, not in the verb list unguarded: DELETE sits
     * BELOW this branch, so "i need to delete notes.txt" would have been
     * claimed as a CREATE and the file the user asked to remove would have
     * been made instead. The destructive words take it back. */
    if ((am_word_any(p, "make|create|new|touch|mkdir") ||
         (am_word(p, "need") &&
          !am_word_any(p, "delete|remove|rm|erase|trash|unlink"))) &&
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
    /* "wipe" and "bin" are safe as WORDS and would not be as substrings:
     * "bin" fires inside "binary" and "combine", and the word rules are what
     * stop it. "wipe notes.txt" reaches here at all only because AM_CLEAR
     * above refuses anything holding a ".txt". */
    if ((am_word_any(p, "delete|remove|rm|erase|trash|unlink|wipe|bin") ||
         /* The everyday phrasings. Added INSIDE the existing guards, not
          * beside them: they get the same noun-or-.txt requirement and the
          * same negation veto as every other way of saying delete. A new way
          * to ask for a destructive thing must not come with a new way to
          * skip the checks. */
         am_has(p, "get rid of") || am_has(p, "throw away") ||
         am_has(p, "throw out")) &&
        (am_word_any(p, "file|files|folder|folders|directory|note|notes") ||
         am_has(p, ".txt")) &&
        !am_negated(p))
        return AM_ACT_DELETE;

    /* ── naming an APP is what makes this a launch ──
     *
     * Above READ because READ's own "(show|display|see) and no 'file' in it"
     * arm was claiming `show me the monitor`, and on a booted build that came
     * back with the honest menu — it looked for a file called "monitor",
     * found none, and gave up. The user asked for a window and got a shrug.
     *
     * Two things keep this from over-reaching. am_open_target has to actually
     * recognise an app name, so an ordinary sentence never reaches the verb
     * list at all; and a .txt anywhere takes it straight back out, so
     * `show me notes.txt` is still a read even though "files" is a word the
     * open target knows. Everything ambiguous the other way — `show me the
     * files`, `show me the settings` — is claimed by am_classify long before
     * this runs, which is why it can afford to be this permissive. */
    if (am_open_target(p) != AM_OPEN_NONE && !am_has(p, ".txt") &&
        (am_word_any(p, "open|launch|start|play|run|show|see|use|switch") ||
         am_has(p, "bring up") || am_has(p, "fire up")  ||
         am_has(p, "pull up")  || am_has(p, "go to")    || am_has(p, "let me") ||
         am_has(p, "take me")  || am_has(p, "is there")))
        return AM_ACT_OPEN;

    /* "read" as a WORD, or it fires inside "already", "bread", "spreadsheet".
     * "cat " keeps its trailing space rather than becoming a word: as a bare
     * word it would claim every sentence about somebody's cat. */
    if (am_word_any(p, "read|contents|content|print") || am_has(p, "cat ") ||
        (am_word_any(p, "show|display|see") && !am_word_any(p, "file|files")) ||
        (am_word_any(p, "what|whats") && am_word(p, "in")))
        return AM_ACT_READ;

    if (am_word_any(p, "open|launch|start|play|run|go to") ||
        am_has(p, "fire up") || am_has(p, "bring up") || am_has(p, "pull up"))
        return AM_ACT_OPEN;

    return AM_ACT_NONE;
}

/* ─── "it" ──────────────────────────────────────────────────────────────
 *
 * Every prompt here has been standalone, and nobody talks like that:
 *
 *   > make notes.txt
 *   > write hello to it     <- means notes.txt. Made a file called it.txt.
 *   > open it               <- still notes.txt. Failed.
 *
 * So one slot holds the last file that was actually touched, and the referring
 * words resolve to it. ONE slot, not a history: "it" means the most recent
 * file, full stop. A two-deep stack invites "the other one" and there is no
 * way to be sure which was meant — and when we cannot be sure, we ask, which
 * is the same rule the delete gate runs on.
 *
 * The resolution is a REWRITE: "delete it" becomes "delete notes.txt" and then
 * takes the ordinary path, extractor and confirmation gate and all. That is
 * what makes attaching a pronoun to a destructive verb safe — the gate names
 * the file it resolved to, on screen, before anything happens:
 *
 *   > delete it
 *   delete notes.txt (14 B)?
 *
 * A wrong resolution shows a wrong name and the user says no. This feature
 * could not have been built before that gate existed.
 *
 * THREE THINGS IT MUST NOT DO:
 *
 *   Never guess. With nothing recorded, "open it" says so. It must NEVER fall
 *   back to a literal it.txt — a confident action on a name the user never
 *   typed is the exact shape of every bug this file has had.
 *
 *   Never claim an explicit name. "read it.txt" names a real file, so the
 *   pronoun path does not run at all: an explicit filename always wins.
 *
 *   Never rewrite a question. "is it working" and "what is this" are not file
 *   operations; the classifier and the action table both have to want a file
 *   before a word gets replaced. */

/* Where the referring phrase sits in p. Longest alternatives first, so "the
 * same file" is not matched as a bare "file" with debris left around it. */
static inline int am_ref_span(const char *p, int *at, int *len)
{
    static const char *const refs[] = {
        "the same file", "the same one", "that same file", "the same",
        "that file", "this file", "the file", "it", "that", "this", "same",
    };
    for (unsigned k = 0; k < sizeof(refs) / sizeof(refs[0]); k++) {
        int nl = 0; while (refs[k][nl]) nl++;
        for (int i = 0; p[i]; i++) {
            int j = 0;
            while (j < nl && p[i + j] && am_lc(p[i + j]) == am_lc(refs[k][j])) j++;
            if (j != nl) continue;
            if (i > 0 && am_wordch(p, i - 1)) continue;
            if (p[i + nl] && am_wordch(p, i + nl)) continue;
            *at = i; *len = nl; return 1;
        }
    }
    return 0;
}

enum am_ref {
    AM_REF_NONE = 0,   /* no referring word — nothing to do        */
    AM_REF_DONE,       /* rewritten; act on `out`                  */
    AM_REF_UNSET,      /* referring word, nothing recorded: REFUSE */
};

/* How many prompts the slot survives without a file being touched.
 *
 * A pronoun that reaches back through ten minutes and four topics is worse
 * than one that does not resolve at all: it acts confidently on a guess, and
 * the user has long since stopped thinking about that file. So the bound has
 * to be smaller than "a few topics" — three lets an ordinary aside ("how much
 * memory?") sit in the middle of a conversation about a file without breaking
 * it, and stops anything longer. */
#define AM_REF_MAX_AGE 3

static inline int am_ref_expired(int age) { return age > AM_REF_MAX_AGE; }

/* Splice `with` into p in place of the referring phrase. 1 if there was one. */
static inline int am_ref_rewrite(const char *p, const char *with,
                                 char *out, int cap)
{
    int at, len, k = 0;
    if (cap > 0) out[0] = 0;
    if (!am_ref_span(p, &at, &len)) return 0;
    for (int i = 0; i < at && k < cap - 1; i++)      out[k++] = p[i];
    for (int i = 0; with[i] && k < cap - 1; i++)     out[k++] = with[i];
    for (int i = at + len; p[i] && k < cap - 1; i++) out[k++] = p[i];
    out[k] = 0;
    return 1;
}

/* Does this prompt want a file from the slot at all? Kept separate because
 * both the rewrite and the refusal have to agree on it exactly — a sentence
 * we would not rewrite must not produce "I don't know what 'it' refers to"
 * either. Answering a question about the machine with a complaint about
 * pronouns is its own kind of wrong. */
static inline int am_ref_wanted(const char *p)
{
    /* A question is not a file operation. "what is this" is about the OS. */
    if (am_classify(p) != AM_NONE) return 0;
    /* An explicitly named file always wins: "read it.txt" is a filename. */
    { char t[128]; if (am_file_tokens(p, 0, t, (int)sizeof(t)) > 0) return 0; }
    /* Creating names something NEW, so there is nothing to refer back to —
     * and without this "make a file called it" would be rewritten. */
    if (am_action_of(p) == AM_ACT_CREATE) return 0;

    /* The real test: would substituting a filename here even BE a file
     * operation? Splice in a probe and ask. "is it working" becomes "is
     * probe.txt working", which is not an action, so the sentence keeps its
     * own words and never hears about pronouns. "delete it" becomes "delete
     * probe.txt", which plainly is one.
     *
     * This has to be asked on the rewrite rather than the original, because
     * the original is exactly what the action table cannot parse — "delete it"
     * fails DELETE's file-noun guard, which is the whole reason it needed
     * resolving. */
    char probe[192];
    if (!am_ref_rewrite(p, "probe.txt", probe, (int)sizeof(probe))) return 0;
    return am_classify(probe) == AM_NONE && am_action_of(probe) != AM_ACT_NONE;
}

/* Copy the referring word itself out, for the refusal to quote back. */
static inline void am_ref_word(const char *p, char *out, int cap)
{
    int at, len, k = 0;
    if (cap > 0) out[0] = 0;
    if (!am_ref_wanted(p) || !am_ref_span(p, &at, &len)) return;
    while (k < len && k < cap - 1) { out[k] = p[at + k]; k++; }
    out[k] = 0;
}

/* Rewrite p into out with the referring phrase replaced by `last`. */
static inline enum am_ref am_resolve_ref(const char *p, const char *last,
                                         char *out, int cap)
{
    if (cap > 0) out[0] = 0;
    if (!am_ref_wanted(p)) return AM_REF_NONE;
    if (!last || !last[0]) return AM_REF_UNSET;
    return am_ref_rewrite(p, last, out, cap) ? AM_REF_DONE : AM_REF_NONE;
}

/* ─── did you mean? ─────────────────────────────────────────────────────
 * Levenshtein, two rows rather than a full table: a 64x64 table of ints is
 * 16 KiB and the kernel stack is 16 KiB total. Bails early when the lengths
 * are too far apart to come within the caller's threshold. */
#define AM_NAME_CAP 64

static inline int am_edit_distance(const char *a, const char *b)
{
    int la = 0; while (a[la]) la++;
    int lb = 0; while (b[lb]) lb++;
    if (la >= AM_NAME_CAP || lb >= AM_NAME_CAP) return 99;
    int diff = la > lb ? la - lb : lb - la;
    if (diff > 2) return diff;            /* already past any useful threshold */

    int prev[AM_NAME_CAP + 1], cur[AM_NAME_CAP + 1];
    for (int j = 0; j <= lb; j++) prev[j] = j;
    for (int i = 1; i <= la; i++) {
        cur[0] = i;
        for (int j = 1; j <= lb; j++) {
            int sub = prev[j - 1] + (am_lc(a[i - 1]) == am_lc(b[j - 1]) ? 0 : 1);
            int del = prev[j] + 1;
            int ins = cur[j - 1] + 1;
            int m = sub < del ? sub : del;
            cur[j] = m < ins ? m : ins;
        }
        for (int j = 0; j <= lb; j++) prev[j] = cur[j];
    }
    return prev[lb];
}

/* Everything before the last dot. */
static inline int am_stem_len(const char *n)
{
    int len = 0, dot = -1;
    for (int i = 0; n[i]; i++) { if (n[i] == '.') dot = i; len = i + 1; }
    return dot > 0 ? dot : len;
}

/* Is `cand` close enough to `typed` to be worth offering? A bad suggestion is
 * worse than none, so this is tight: within 2 edits, and those edits must be
 * small relative to the STEM.
 *
 * The stem rather than the whole name, because nearly every file here ends in
 * ".txt" — four characters of shared noise that make any two names look
 * alike. By whole-name length "a.txt" and "b.txt" are 80% identical and one
 * edit apart, which would have the assistant suggesting every short file in
 * the directory for every other one. By stem they are completely unrelated,
 * which is the truth. */
static inline int am_did_you_mean(const char *typed, const char *cand)
{
    int d = am_edit_distance(typed, cand);
    if (d == 0 || d > 2) return 0;
    int st = am_stem_len(typed), sc = am_stem_len(cand);
    int shorter = st < sc ? st : sc;
    return shorter >= 3 && d * 3 <= shorter;
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

/* ─── what a submitted line MEANS ───────────────────────────────────────
 *
 * This exists because am_confirm_yes("") == 0 was true, tested, passing — and
 * completely beside the point. The Assistant's key handler dropped empty
 * submissions before dispatch (`if (as_plen > 0)`), so on the real path
 * am_confirm_yes never saw the empty string and the pending action survived
 * the Enter that was supposed to cancel it. The predicate was right and
 * unreachable, which is the same as being wrong.
 *
 * What that cost, before this function existed:
 *
 *   delete modal2.txt   -> armed, question on screen
 *   <Enter>             -> dropped upstream; STILL ARMED, and the user has
 *                          every reason to think they dismissed it
 *   yes                 -> typed a moment later for some unrelated reason
 *                       -> THE FILE IS DELETED, against a question the user
 *                          believed was already gone
 *
 * So the decision moved here, where the empty case cannot be special-cased
 * away by an upstream guard and where a test can drive the whole sequence
 * rather than one predicate out of the middle of it. A pending question
 * consumes EVERY submission, including the empty one.
 *
 * The lesson worth keeping: a host test proves a function is correct. It can
 * never prove the function is reached. When the property matters, test the
 * decision, not the predicate. */
/* ─── a yes to WHAT? ────────────────────────────────────────────────────
 *
 * am_confirm_yes reads the mood of a reply. It cannot read its object, and on
 * a booted build that gap destroyed files:
 *
 *   pending delete k2.txt   "yes delete k3.txt"                -> k2.txt died
 *   pending delete k4.txt   "sure, but delete k3.txt instead"  -> k4.txt died
 *   pending copy  cbig.txt  "yes copy to k3.txt"               -> cbig.txt lost
 *
 * k3.txt is named in every one of those answers and is the only file none of
 * them touched. An affirmative that names a DIFFERENT file is not agreement,
 * it is a correction — the second says so in words, with "instead".
 *
 * Note what is NOT the fix here. am_negated carries "instead of", so a
 * trailing bare "instead" slips past it, and adding the word would patch that
 * one sentence and nothing else: a user can redirect with no keyword at all
 * ("yes, k3.txt"). Reading the mood harder was never going to work. Read the
 * OBJECT instead — a reply may name the pending target, or name no file at
 * all; anything else is about a different file and cancels.
 *
 * Comparison is exact and case-sensitive on purpose. If two names differ in
 * any way we do not know which file is meant, and not knowing must cancel. */

/* The first file named in `reply` that is NOT `target`, or "" when there is
 * none. The decision (am_confirm_targets) and the explanation the user reads
 * both come from this one comparison, so they cannot drift apart. */
static inline void am_confirm_other(const char *reply, const char *target,
                                    char *out, int cap)
{
    /* Sized to hold any token the Assistant's prompt buffer can carry, so
     * am_file_tokens never skips one for want of room — a skipped token would
     * be a named file we silently failed to notice, which is the whole bug. */
    char t[128];
    if (cap > 0) out[0] = 0;
    int n = am_file_tokens(reply, 0, t, (int)sizeof(t));
    for (int i = 0; i < n; i++) {
        am_file_tokens(reply, i, t, (int)sizeof(t));
        int j = 0;
        if (target) { while (t[j] && t[j] == target[j]) j++; }
        if (!target || t[j] || target[j]) {      /* not the pending target */
            int k = 0;
            while (t[k] && k < cap - 1) { out[k] = t[k]; k++; }
            if (cap > 0) out[k] = 0;
            return;
        }
    }
}

static inline int am_confirm_targets(const char *reply, const char *target)
{
    char other[128];
    am_confirm_other(reply, target, other, (int)sizeof(other));
    return other[0] == 0;
}

enum am_submit {
    AM_SUBMIT_IGNORE = 0,  /* empty line, nothing pending — do nothing  */
    AM_SUBMIT_CANCEL,      /* a pending action is called off            */
    AM_SUBMIT_RUN,         /* a pending action is confirmed             */
    AM_SUBMIT_PROMPT,      /* ordinary input — hand it to the intents   */
};

/* `pending_target` is the file the pending question is about, or 0 when
 * nothing is pending. Passing the NAME rather than a bare "is something
 * armed" flag is deliberate: it is what lets this ask both halves of the
 * question, and it makes a pending action without a target unrepresentable.
 *
 * Every gate — delete, copy-over, write-over — routes through here, so both
 * halves apply to all three. Fixing this at one call site would have been
 * half a fix. */
/* ─── is it still the file we DESCRIBED? ────────────────────────────────
 *
 * The confirmation does not merely name a file, it states a fact about it:
 * "delete race.txt (9 B)?". The user reads that number and consents to losing
 * those nine bytes. On a booted build:
 *
 *   write OLDOLDOLD to race.txt     -> 9 B
 *   [arm: the confirm displays "delete race.txt (9 B)?"]
 *   rm race.txt                     ] from the shell, between the
 *   write race.txt NEWNEWNEWNEWNEW  ] question and the answer -> 15 B
 *   yes
 *   -> "deleted race.txt". Fifteen bytes of DIFFERENT content died.
 *
 * The tempting defence — the user said delete race.txt, and race.txt is what
 * went — is wrong, and it is worth being precise about why, because two of us
 * believed it. It would hold if the prompt only named a file. It does not
 * hold once the prompt states a FACT, because the consent was informed by
 * that fact, and we are the ones who displayed it. A confirmation that shows
 * a number which stops being true before it is answered defeats the entire
 * reason for asking.
 *
 * So the question is not "does this name still resolve" — it always did — but
 * "is what it resolves to still the thing the user agreed about". Identity is
 * the SIZE (what we showed them) plus a fingerprint of the CONTENT (what they
 * were actually agreeing to lose).
 *
 * Content, deliberately, and not a modification timestamp: if a file is
 * rewritten with byte-identical contents then destroying it destroys exactly
 * what was described, and an mtime check would refuse for no reason. What
 * matters is the bytes, so the bytes are what gets compared. */
struct am_ident {
    unsigned long size;   /* the count the confirmation put on screen     */
    unsigned long hash;   /* fingerprint of the bytes at that moment      */
    int           valid;  /* 0 when the name resolved to no regular file  */
};

static inline int am_ident_same(struct am_ident then, struct am_ident now)
{
    /* An invalid side always fails: at arm time it means we never had a file
     * to describe, and at confirm time it means the file is gone. Neither is
     * "the thing you agreed about", so neither may act. */
    return then.valid && now.valid &&
           then.size == now.size && then.hash == now.hash;
}

/* Was this submission CONSUMED — must the input buffer be cleared?
 *
 * Everything except IGNORE consumes the line: it was dispatched, so it must
 * not still be sitting there to be dispatched again.
 *
 * `kept_focus` is accepted and deliberately ignored, and that is the entire
 * point of the parameter. wm.c used to clear the buffer only when the
 * Assistant still had focus afterwards, so "open the calculator" — which
 * hands focus to the Calculator — left its own text in the prompt. Esc the
 * Calculator, press a bare Enter, and it opened again.
 *
 * That was harmless only by luck: opening an app destroys nothing. It is the
 * same shape as the Enter bug, one destructive command away from being
 * delete-on-stray-Enter, so it is fixed now rather than after it has teeth.
 * Whether the window kept focus is a question about REDRAWING. It has nothing
 * to do with whether the line was used up. */
static inline int am_submit_consumes(enum am_submit s, int kept_focus)
{
    (void)kept_focus;
    return s != AM_SUBMIT_IGNORE;
}

static inline enum am_submit am_submit_action(const char *line,
                                              const char *pending_target)
{
    /* Pending first, unconditionally. Any ordering that tests the line for
     * emptiness before testing `pending` reintroduces the bug above. */
    if (pending_target)
        return (am_confirm_yes(line) &&
                am_confirm_targets(line, pending_target))
               ? AM_SUBMIT_RUN : AM_SUBMIT_CANCEL;
    return (line && line[0]) ? AM_SUBMIT_PROMPT : AM_SUBMIT_IGNORE;
}

/* Which settings group a change request names, or -1. Mirrors the enum in
 * settings.h (SET_ACCENT / SET_WALL / SET_CLOCK) without including it — this
 * header stays kernel-free so the host test can reach it. */
static inline int am_setting_group(const char *p)
{
    if (am_word_any(p, "accent|colour|color"))                return 0; /* SET_ACCENT */
    if (am_word_any(p, "wallpaper|background|theme|desktop")) return 1; /* SET_WALL   */
    if (am_word_any(p, "clock|hour|hours"))                   return 2; /* SET_CLOCK  */
    /* LAST: a bare accent VALUE, for "make it purple", where the group is
     * obvious to a person and never said. Below the three named groups on
     * purpose — "set the wallpaper to green" names its group explicitly, and
     * putting this first would answer it with the accent list instead of the
     * wallpaper list. None of the wallpaper names (Midnight, Slate, Ember,
     * Forest, Ink) collide with these, so there is nothing else to weigh. */
    if (am_word_any(p, "blue|purple|teal|green|orange|pink"))  return 0;
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
