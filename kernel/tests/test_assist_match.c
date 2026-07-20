/* Table-driven gate for Assistant prompt matching.
 *
 * Exists because am_has() is a bare substring test and has now produced two
 * bugs of the same shape. The second one — `read poem.txt` routed into a
 * poetry generator because the prompt contains "poem" — reached a booted
 * build and was caught by a screenshot, not by review. A table catches it in
 * milliseconds. Every new intent keyword gets a row here, and a NEGATIVE row:
 * a plausible sentence that contains the keyword and must land somewhere else.
 *
 * The intent-routing rows (cls/act/opn) also gate ORDER, not just keywords.
 * try_intent is first-match-wins, so a broad intent placed above a narrow one
 * silently eats the narrow one's prompts and nothing about the code looks
 * wrong. The only way to see it is to ask "where does this exact sentence
 * land?", which is what every row below does.
 */
#include <stdio.h>
#include <string.h>
#include "assist_match.h"

static int failures;

/* ─── am_word: the word-boundary primitive everything else rests on ─── */

static void wordis(const char *hay, const char *needle, int expect,
                   const char *why)
{
    int got = am_word(hay, needle);
    if (got != expect) {
        printf("  FAIL am_word(\"%s\", \"%s\") = %d, expected %d  (%s)\n",
               hay, needle, got, expect, why);
        failures++;
    }
}

/* ─── am_classify: the pure question/switch intents, in priority order ─── */

static const char *iname(enum am_intent i)
{
    switch (i) {
        case AM_NONE:        return "NONE";
        case AM_VERSION:     return "VERSION";
        case AM_IDENTITY:    return "IDENTITY";
        case AM_HELP:        return "HELP";
        case AM_CLOSE:       return "CLOSE";
        case AM_SET_CHANGE:  return "SET_CHANGE";
        case AM_SET_SHOW:    return "SET_SHOW";
        case AM_MEMORY:      return "MEMORY";
        case AM_DISK:        return "DISK";
        case AM_CPU:         return "CPU";
        case AM_TASKS:       return "TASKS";
        case AM_CLEAR:       return "CLEAR";
        case AM_SCREEN:      return "SCREEN";
        case AM_APPS:        return "APPS";
        case AM_UPTIME:      return "UPTIME";
        case AM_BOOT:        return "BOOT";
        case AM_DATE:        return "DATE";
        case AM_FILES_COUNT: return "FILES_COUNT";
        case AM_FILES_LIST:  return "FILES_LIST";
    }
    return "?";
}

static const char *aname(enum am_action a)
{
    switch (a) {
        case AM_ACT_NONE:   return "none";
        case AM_ACT_RENAME: return "RENAME";
        case AM_ACT_COPY:   return "COPY";
        case AM_ACT_APPEND: return "APPEND";
        case AM_ACT_WRITE:  return "WRITE";
        case AM_ACT_CREATE: return "CREATE";
        case AM_ACT_DELETE: return "DELETE";
        case AM_ACT_READ:   return "READ";
        case AM_ACT_OPEN:   return "OPEN";
    }
    return "?";
}

static const char *oname(enum am_open o)
{
    switch (o) {
        case AM_OPEN_NONE:     return "none";
        case AM_OPEN_EDITOR:   return "EDITOR";
        case AM_OPEN_SNAKE:    return "SNAKE";
        case AM_OPEN_FILES:    return "FILES";
        case AM_OPEN_TERMINAL: return "TERMINAL";
        case AM_OPEN_ASSIST:   return "ASSIST";
        case AM_OPEN_MONITOR:  return "MONITOR";
        case AM_OPEN_CALC:     return "CALC";
        case AM_OPEN_SETTINGS: return "SETTINGS";
    }
    return "?";
}

static void cls(const char *prompt, enum am_intent expect, const char *why)
{
    enum am_intent got = am_classify(prompt);
    if (got != expect) {
        printf("  FAIL \"%s\"\n        expected %s, got %s  (%s)\n",
               prompt, iname(expect), iname(got), why);
        failures++;
    }
}

/* An action prompt has to survive TWO hurdles: the classifier must decline it
 * (it runs first, so anything it claims never reaches the action chain), and
 * the action chain must pick the right verb. Checking both in one row is what
 * makes a classifier steal impossible to miss. */
static void act(const char *prompt, enum am_action expect, const char *why)
{
    enum am_intent c = am_classify(prompt);
    if (c != AM_NONE) {
        printf("  FAIL \"%s\"\n        wanted action %s, but the classifier "
               "claimed it as %s  (%s)\n", prompt, aname(expect), iname(c), why);
        failures++;
        return;
    }
    enum am_action got = am_action_of(prompt);
    if (got != expect) {
        printf("  FAIL \"%s\"\n        expected action %s, got %s  (%s)\n",
               prompt, aname(expect), aname(got), why);
        failures++;
    }
}

static void opn(const char *prompt, enum am_open expect, const char *why)
{
    enum am_open got = am_open_target(prompt);
    if (got != expect) {
        printf("  FAIL \"%s\"\n        expected open target %s, got %s  (%s)\n",
               prompt, oname(expect), oname(got), why);
        failures++;
    }
}

static void grp(const char *prompt, int expect, const char *why)
{
    int got = am_setting_group(prompt);
    if (got != expect) {
        printf("  FAIL \"%s\"\n        expected settings group %d, got %d  (%s)\n",
               prompt, expect, got, why);
        failures++;
    }
}

/* ─── am_named_file: which file the sentence actually NAMES ───
 *
 * These rows assert the exact token, never merely that SOMETHING was found.
 * That distinction is the whole reason this section exists: a red-team prompt
 * once "passed" only because the extractor grabbed the wrong word and the file
 * the tester was watching survived by ACCIDENT. A guard that is right for the
 * wrong reason is not a guard, and "a file survived" is not the assertion —
 * "this exact file was the target" is. */
static const char *nname(enum am_named n)
{
    switch (n) {
        case AM_NAMED_NONE: return "NONE";
        case AM_NAMED_ONE:  return "ONE";
        case AM_NAMED_MANY: return "MANY";
    }
    return "?";
}

static void fileis(const char *prompt, enum am_named expect,
                   const char *target, const char *why)
{
    char got[64];
    enum am_named st = am_named_file(prompt, got, sizeof(got));
    if (st != expect) {
        printf("  FAIL \"%s\"\n        expected %s named, got %s  (%s)\n",
               prompt, nname(expect), nname(st), why);
        failures++;
        return;
    }
    if (strcmp(got, target) != 0) {
        printf("  FAIL \"%s\"\n        expected target \"%s\", got \"%s\"  (%s)\n",
               prompt, target, got, why);
        failures++;
    }
}

/* The nth named file, because a MANY refusal has to be able to name both. */
static void nthfile(const char *prompt, int nth, const char *target,
                    const char *why)
{
    char got[64];
    am_file_tokens(prompt, nth, got, sizeof(got));
    if (strcmp(got, target) != 0) {
        printf("  FAIL \"%s\" [%d]\n        expected \"%s\", got \"%s\"  (%s)\n",
               prompt, nth, target, got, why);
        failures++;
    }
}

static const char *rname(enum am_refuse r)
{
    switch (r) {
        case AM_REFUSE_NONE:    return "none";
        case AM_REFUSE_NEGATED: return "NEGATED";
        case AM_REFUSE_UNNAMED: return "UNNAMED";
    }
    return "?";
}

static void rfz(const char *prompt, enum am_refuse expect, const char *why)
{
    enum am_refuse got = am_delete_refusal(prompt);
    if (got != expect) {
        printf("  FAIL \"%s\"\n        expected refusal %s, got %s  (%s)\n",
               prompt, rname(expect), rname(got), why);
        failures++;
    }
}

static void yes(const char *reply, int expect, const char *why)
{
    int got = am_confirm_yes(reply);
    if (got != expect) {
        printf("  FAIL confirm \"%s\" = %s, expected %s  (%s)\n",
               reply, got ? "YES" : "no", expect ? "YES" : "no", why);
        failures++;
    }
}

/* This exact sentence reaches a destructive action, AND that action cannot run
 * without a deliberate yes.
 *
 * Worth having as its own row rather than trusting the two halves separately.
 * The three negation misses below all name their file at the END of the
 * sentence, so the OLD trailing-token extractor picked the right target for
 * them by pure luck — assert only the target and those rows pass against
 * broken code and tell you nothing. This is the assertion that actually holds
 * them: whatever the word list did or didn't catch, nothing happens on the
 * strength of the sentence alone. */
static void gated(const char *prompt, const char *why)
{
    enum am_action a = am_action_of(prompt);
    if (!am_needs_confirm(a, 0)) {
        printf("  FAIL \"%s\"\n        reaches %s and would run UNCONFIRMED  (%s)\n",
               prompt, aname(a), why);
        failures++;
    }
}

/* `content` is what the kernel side sees at the destination: 1 when a file is
 * already there with bytes in it, 0 when the name is free or the file is
 * empty. It is the whole difference between "this is a create" and "this
 * silently destroys what you had". */
/* ─── "it" — resolution against the one-file slot ─── */
static const char *rfname(enum am_ref r)
{
    switch (r) {
        case AM_REF_NONE:  return "NONE";
        case AM_REF_DONE:  return "DONE";
        case AM_REF_UNSET: return "UNSET";
    }
    return "?";
}

/* `last` is what the slot holds ("" for empty). `expect_out` is the rewritten
 * prompt, asserted in full — "it resolved" is not the property, "it resolved
 * to THIS sentence" is. */
static void ref(const char *prompt, const char *last, enum am_ref expect,
                const char *expect_out, const char *why)
{
    char out[128];
    enum am_ref got = am_resolve_ref(prompt, last, out, sizeof(out));
    if (got != expect) {
        printf("  FAIL ref \"%s\" (slot=%s)\n        expected %s, got %s  (%s)\n",
               prompt, last[0] ? last : "empty", rfname(expect), rfname(got), why);
        failures++;
        return;
    }
    if (got == AM_REF_DONE && strcmp(out, expect_out) != 0) {
        printf("  FAIL ref \"%s\" (slot=%s)\n        rewrote to \"%s\", expected \"%s\"  (%s)\n",
               prompt, last, out, expect_out, why);
        failures++;
    }
}

static void dym(const char *typed, const char *cand, int expect, const char *why)
{
    int got = am_did_you_mean(typed, cand);
    if (got != expect) {
        printf("  FAIL did-you-mean(\"%s\", \"%s\") = %d, expected %d  (%s)\n",
               typed, cand, got, expect, why);
        failures++;
    }
}

static void identis(unsigned long ts, unsigned long th, int tv,
                    unsigned long ns, unsigned long nh, int nv,
                    int expect, const char *why)
{
    struct am_ident then, now;
    then.size = ts; then.hash = th; then.valid = tv;
    now.size  = ns; now.hash  = nh; now.valid  = nv;
    int got = am_ident_same(then, now);
    if (got != expect) {
        printf("  FAIL ident described(%lu B,%lx,v%d) vs now(%lu B,%lx,v%d) "
               "= %s, expected %s  (%s)\n", ts, th, tv, ns, nh, nv,
               got ? "SAME" : "changed", expect ? "SAME" : "changed", why);
        failures++;
    }
}

static void needs(enum am_action a, int content, int expect, const char *why)
{
    int got = am_needs_confirm(a, content);
    if (got != expect) {
        printf("  FAIL am_needs_confirm(%s, dst_has_content=%d) = %d, "
               "expected %d  (%s)\n", aname(a), content, got, expect, why);
        failures++;
    }
}

/* ─── what a submitted line means, WITH a pending question ───
 *
 * These rows drive the decision, not the predicate. am_confirm_yes("") == 0
 * was asserted here, passed, and protected nothing, because the key handler
 * discarded empty submissions before that predicate was ever consulted. The
 * function was correct and unreachable. Everything below asks the question the
 * real path asks: "the user submitted this line while THIS was pending — what
 * happens?" */
static const char *sname(enum am_submit s)
{
    switch (s) {
        case AM_SUBMIT_IGNORE: return "IGNORE";
        case AM_SUBMIT_CANCEL: return "CANCEL";
        case AM_SUBMIT_RUN:    return "RUN";
        case AM_SUBMIT_PROMPT: return "PROMPT";
    }
    return "?";
}

/* `pending` is the FILE the question is about, or NULL for nothing armed. */
static void sub(const char *line, const char *pending, enum am_submit expect,
                const char *why)
{
    enum am_submit got = am_submit_action(line, pending);
    if (got != expect) {
        printf("  FAIL submit \"%s\" (pending=%s)\n"
               "        expected %s, got %s  (%s)\n",
               line, pending ? pending : "nothing", sname(expect), sname(got), why);
        failures++;
    }
}

/* A whole typed sequence, replayed the way a person would type it: each line
 * is submitted in order and the pending flag carries between them, exactly as
 * as_pending does in wm.c. Returns 1 if the armed action ever RAN.
 *
 * This is the shape of test the Enter bug needed and did not have. No single
 * row could have caught it — the defect only exists in the JOIN between one
 * submission and the next. */
/* A model of the Assistant's input path, with a real buffer.
 *
 * Both of the last two bugs lived HERE — not in any predicate, but in what the
 * key handler did with the buffer between one Enter and the next. A test that
 * feeds whole lines to a pure function cannot see either of them. So this
 * carries the state wm.c carries: the typed buffer, the armed action and its
 * target, and whether the Assistant still has focus. */
/* The model carries a small filesystem too, because the last defect needed a
 * SECOND ACTOR: a shell changing a file between the question and the answer.
 * Nothing smaller can express it — the Assistant's own inputs are identical in
 * the safe case and the destructive one. */
#define M_FILES 4
struct m_file { char name[64]; unsigned long size, hash; int present; };

struct as_model {
    char buf[128];   /* as_prompt                          */
    char pend[64];   /* as_pend_a — the file at risk       */
    int  armed;      /* as_pending != AS_PEND_NONE         */
    int  focus;      /* does the Assistant still have it   */
    char died[64];   /* the file a fired action destroyed  */
    int  opens;      /* how many times an app was launched */
    int  blocked;    /* a yes refused because the file changed */
    struct m_file fs[M_FILES];
    struct am_ident armed_id;   /* as_pend_id — what we DESCRIBED */
    char last[64];   /* as_last_file — what "it" means right now  */
    int  last_age;   /* prompts since a file was last touched     */
    int  refused_ref;/* a pronoun with nothing recorded           */
};

static void m_init(struct as_model *m)
{
    m->buf[0] = 0; m->pend[0] = 0; m->died[0] = 0;
    m->armed = 0; m->focus = 1; m->opens = 0; m->blocked = 0;
    m->armed_id.size = 0; m->armed_id.hash = 0; m->armed_id.valid = 0;
    m->last[0] = 0; m->last_age = 0; m->refused_ref = 0;
    for (int i = 0; i < M_FILES; i++) m->fs[i].present = 0;
}

static void m_touch(struct as_model *m, const char *name)
{
    snprintf(m->last, sizeof(m->last), "%s", name);
    m->last_age = 0;
}

static struct m_file *m_fs_get(struct as_model *m, const char *name)
{
    for (int i = 0; i < M_FILES; i++)
        if (m->fs[i].present && !strcmp(m->fs[i].name, name)) return &m->fs[i];
    return 0;
}

/* Create or replace — models `write X to f` from either actor. */
static void m_fs_put(struct as_model *m, const char *name,
                     unsigned long size, unsigned long hash)
{
    struct m_file *f = m_fs_get(m, name);
    if (!f) for (int i = 0; i < M_FILES; i++)
        if (!m->fs[i].present) { f = &m->fs[i]; break; }
    if (!f) return;
    snprintf(f->name, sizeof(f->name), "%s", name);
    f->size = size; f->hash = hash; f->present = 1;
}

static void m_fs_rm(struct as_model *m, const char *name)
{
    struct m_file *f = m_fs_get(m, name);
    if (f) f->present = 0;
}

static struct am_ident m_ident(struct as_model *m, const char *name)
{
    struct am_ident id; id.size = 0; id.hash = 0; id.valid = 0;
    struct m_file *f = m_fs_get(m, name);
    if (f) { id.size = f->size; id.hash = f->hash; id.valid = 1; }
    return id;
}

static void m_type(struct as_model *m, const char *s)
{
    int k = 0; while (m->buf[k]) k++;
    for (int i = 0; s[i] && k < (int)sizeof(m->buf) - 1; i++) m->buf[k++] = s[i];
    m->buf[k] = 0;
}

/* assist_key's '\n' arm, then assist_run, then try_intent — in that order. */
static void m_enter(struct as_model *m)
{
    enum am_submit s = am_submit_action(m->buf, m->armed ? m->pend : 0);
    if (s == AM_SUBMIT_IGNORE) return;

    if (s == AM_SUBMIT_RUN) {
        /* The file has to still be the one the question described, and only
         * then does the operation's own existence check run. Both, in that
         * order, exactly as assist_answer_pending does it. */
        if (!am_ident_same(m->armed_id, m_ident(m, m->pend))) {
            m->blocked = 1;
        } else if (m_fs_get(m, m->pend)) {
            int k = 0; while (m->pend[k]) { m->died[k] = m->pend[k]; k++; }
            m->died[k] = 0;
            m_fs_rm(m, m->pend);
            m->last[0] = 0;   /* "it" must not go on naming a deleted file */
        }
        m->armed = 0; m->pend[0] = 0;
    } else if (s == AM_SUBMIT_CANCEL) {
        m->armed = 0; m->pend[0] = 0;
    } else {                                   /* AM_SUBMIT_PROMPT */
        /* try_intent's order exactly: classify, then age the slot, then
         * resolve "it", then dispatch on the REWRITE. */
        const char *q = m->buf;
        char rp[128];
        if (m->last[0] && am_ref_expired(++m->last_age)) { m->last[0] = 0; m->last_age = 0; }
        enum am_ref r = am_resolve_ref(q, m->last, rp, sizeof(rp));
        if (r == AM_REF_UNSET) {
            m->refused_ref = 1;                /* refuse — never guess a name */
        } else {
            if (r == AM_REF_DONE) q = rp;
            char f[64];
            int named = (am_named_file(q, f, (int)sizeof(f)) == AM_NAMED_ONE);
            enum am_action a = (am_classify(q) == AM_NONE) ? am_action_of(q)
                                                           : AM_ACT_NONE;
            if (a == AM_ACT_OPEN && am_open_target(q) != AM_OPEN_NONE) {
                m->opens++; m->focus = 0;      /* the new window takes focus */
            } else if (a == AM_ACT_CREATE && named) {
                m_fs_put(m, f, 0, 0x0); m_touch(m, f);
            } else if (a == AM_ACT_WRITE && named) {
                m_fs_put(m, f, 5, 0x5EED); m_touch(m, f);
            } else if ((a == AM_ACT_READ || a == AM_ACT_OPEN) && named &&
                       m_fs_get(m, f)) {
                m_touch(m, f);
            } else if (a == AM_ACT_DELETE && named && m_fs_get(m, f)) {
                snprintf(m->pend, sizeof(m->pend), "%s", f);
                /* Arming records what we are about to PUT ON SCREEN. That
                 * snapshot is the thing the user's yes refers to. */
                m->armed_id = m_ident(m, m->pend);
                m->armed = 1;
            }
        }
    }
    if (am_submit_consumes(s, m->focus)) m->buf[0] = 0;
}

/* Type a line and submit it. */
static void m_line(struct as_model *m, const char *s) { m_type(m, s); m_enter(m); }

static int replay(const char *const *lines, int n, char *ran_on, int cap)
{
    struct as_model m; m_init(&m);
    /* Seed every file the sequence mentions — arming has to have a real file
     * to describe, since the description is what the yes refers to. */
    for (int i = 0; i < n; i++) {
        char t[64]; int c = am_file_tokens(lines[i], 0, t, (int)sizeof(t));
        for (int k = 0; k < c; k++) {
            am_file_tokens(lines[i], k, t, (int)sizeof(t));
            if (!m_fs_get(&m, t))
                m_fs_put(&m, t, 8, 0x1000UL + (unsigned long)(unsigned char)t[0]);
        }
    }
    for (int i = 0; i < n; i++) m_line(&m, lines[i]);
    int k = 0; while (m.died[k] && k < cap - 1) { ran_on[k] = m.died[k]; k++; }
    if (cap > 0) ran_on[k] = 0;
    return ran_on[0] != 0;
}

/* `expect_died` is the file the sequence should actually destroy, or "" for
 * none. Naming it rather than passing a ran/didn't-run flag is the same
 * discipline as everywhere else here: "a file survived" is not the property,
 * "this exact file was the one at risk" is. A sequence that fires on the wrong
 * target would satisfy a boolean and fail this. */
static void seq(const char *const *lines, int n, const char *expect_died,
                const char *why)
{
    char died[64];
    replay(lines, n, died, sizeof(died));
    if (strcmp(died, expect_died) != 0) {
        printf("  FAIL sequence [");
        for (int i = 0; i < n; i++)
            printf("%s\"%s\"", i ? ", " : "", lines[i]);
        printf("]\n        fired on %s, expected %s  (%s)\n",
               died[0] ? died : "nothing",
               expect_died[0] ? expect_died : "nothing", why);
        failures++;
    }
}

static void want(const char *prompt, int expect, const char *why)
{
    int got = am_wants_generation(prompt);
    if (got != expect) {
        printf("  FAIL \"%s\"\n        expected %s, got %s  (%s)\n",
               prompt, expect ? "model" : "not-model",
               got ? "model" : "not-model", why);
        failures++;
    }
}

int main(void)
{
    /* ═══ 1. am_word — the primitive. Every negative here is a real bug that
     * the bare substring test would have shipped. ═══ */
    wordis("please confirm notes.txt", "rm",   0, "rm inside confirm — DELETED A FILE");
    wordis("perform the copy",         "rm",   0, "rm inside perform");
    wordis("rm notes.txt",             "rm",   1, "rm as the verb");
    wordis("how much ram do i have",   "ram",  1, "ram as a word");
    wordis("run the program",          "ram",  0, "ram inside program");
    wordis("draw a diagram",           "ram",  0, "ram inside diagram");
    wordis("update notes.txt",         "date", 0, "date inside update");
    wordis("what is the date",         "date", 1, "date as a word");
    wordis("i already did that",       "read", 0, "read inside already");
    wordis("open the spreadsheet",     "read", 0, "read inside spreadsheet");
    wordis("read notes.txt",           "read", 1, "read as the verb");
    wordis("copy it to backup.txt",    "up",   0, "up inside backup.txt");
    wordis("how long have you been up","up",   1, "up as a word");
    wordis("what is the display size", "play", 0, "play inside display");
    wordis("play snake",               "play", 1, "play as the verb");
    wordis("show me the output",       "put",  0, "put inside output");
    wordis("put hi in notes.txt",      "put",  1, "put as the verb");
    wordis("how much storage",         "store",0, "store inside storage");
    wordis("who built this",           "build",0, "built is not build");
    wordis("what processor is this",   "process", 0, "process inside processor");
    wordis("what processes are there", "process", 0, "process inside processes");
    wordis("is that process alive",    "process", 1, "process as a word");
    wordis("i think blue",             "ink",  0, "ink inside think");
    wordis("remember december",        "ember",0, "ember inside remember");
    wordis("list all my tools",        "ls",   0, "ls inside tools");
    wordis("ls",                       "ls",   1, "ls alone");
    wordis("read poem.txt",            "poem", 0, "THE SHIPPED BUG, at the word level");
    wordis("write me a poem",          "poem", 1, "poem as a word");
    wordis("memory?",                  "memory", 1, "trailing punctuation is not word-internal");
    wordis("all my memory.",           "memory", 1, "a full stop ends a word");
    wordis("cat memory.txt",           "memory", 0, "but a dot INSIDE a name does not");
    wordis("",                         "memory", 0, "empty haystack");
    wordis("memory",                   "",     0, "empty needle never matches");

    /* ═══ 2. Phrasing tolerance on intents that already existed. Every one of
     * these is a sentence a person would actually type. ═══ */

    /* memory — the brief's own examples */
    cls("how much memory",             AM_MEMORY, "the original phrasing");
    cls("how much ram do i have",      AM_MEMORY, "ram, not memory");
    cls("memory?",                     AM_MEMORY, "one word and a question mark");
    cls("show me memory",              AM_MEMORY, "imperative");
    cls("am i running out of memory",  AM_MEMORY, "contains 'running' — must NOT be TASKS");
    cls("how much free ram is left",   AM_MEMORY, "free ram");
    cls("whats the heap look like",    AM_MEMORY, "heap");
    cls("run the program",             AM_NONE,   "NEGATIVE: 'ram' inside 'program'");
    cls("draw me a diagram",           AM_NONE,   "NEGATIVE: 'ram' inside 'diagram'");

    /* what's running */
    cls("what's running",              AM_TASKS,  "the original phrasing");
    cls("whats running right now",     AM_TASKS,  "no apostrophe");
    cls("what processes are there",    AM_TASKS,  "processes");
    cls("how many tasks",              AM_TASKS,  "task count — TASKS, not FILES_COUNT");
    cls("show me the scheduler",       AM_TASKS,  "scheduler");
    cls("ps",                          AM_TASKS,  "the shell name for it");
    cls("what are you doing",          AM_TASKS,  "conversational");
    cls("any jobs running",            AM_TASKS,  "jobs");
    cls("open the task manager",       AM_NONE,   "NEGATIVE: a launch, not a report");

    /* disk */
    cls("how much disk space",         AM_DISK,   "the original phrasing");
    cls("am i running out of space",   AM_DISK,   "REGRESSION: 'running' used to steal this");
    cls("do my files persist",         AM_DISK,   "persistence");
    cls("is there a hard drive",       AM_DISK,   "drive");
    cls("will my files survive a reboot", AM_DISK, "the real question behind it");
    cls("how much storage is left",    AM_DISK,   "storage");

    /* who are you */
    cls("who are you",                 AM_IDENTITY, "the original phrasing");
    cls("what are you",                AM_IDENTITY, "what form");
    cls("whats your name",             AM_IDENTITY, "name");
    cls("tell me about yourself",      AM_IDENTITY, "yourself");
    cls("who made you",                AM_IDENTITY, "who made");
    cls("what os is this",             AM_IDENTITY, "os");
    cls("what are you doing",          AM_TASKS,    "NEGATIVE: the doing guard still holds");
    cls("what are you running",        AM_TASKS,    "NEGATIVE: the running guard still holds");

    /* help */
    cls("help",                        AM_HELP,   "bare");
    cls("what can you do",             AM_HELP,   "the original phrasing");
    cls("what commands are there",     AM_HELP,   "commands");
    cls("what can i ask you",          AM_HELP,   "ask form");
    cls("help me read a file",         AM_HELP,   "vague — a menu is the right answer");
    cls("help me delete notes.txt",    AM_NONE,   "NEGATIVE: a real verb + a real file wins");

    /* date / time */
    cls("what time is it",             AM_DATE,   "the original phrasing");
    cls("what is the date",            AM_DATE,   "date");
    cls("what day is it",              AM_DATE,   "day");
    cls("whats the time today",        AM_DATE,   "today");
    cls("update notes.txt with a line", AM_NONE,  "NEGATIVE: 'date' inside 'update'");

    /* uptime — above DATE and BOOT because it contains their words */
    cls("uptime",                      AM_UPTIME, "bare");
    cls("how long have you been up",   AM_UPTIME, "the original phrasing");
    cls("how long has this been on",   AM_UPTIME, "has form");
    cls("how long since you started",  AM_UPTIME, "since form");
    cls("how long have you been running", AM_UPTIME, "contains 'running' — not TASKS");

    /* files */
    cls("list my files",               AM_FILES_LIST,  "the original phrasing");
    cls("what files do i have",        AM_FILES_LIST,  "what form");
    cls("show me my files",            AM_FILES_LIST,  "show form");
    cls("ls",                          AM_FILES_LIST,  "the shell name for it");
    cls("what folders are there",      AM_FILES_LIST,  "folders");
    cls("how many files do i have",    AM_FILES_COUNT, "count, not list");
    cls("read my notes",               AM_NONE,        "NEGATIVE: not a listing — it names a file");

    /* ═══ 3. New intents. Each one answers with a real kernel number. ═══ */

    cls("what version is this",        AM_VERSION, "version");
    cls("what kernel am i on",         AM_VERSION, "kernel");
    cls("what build is this",          AM_VERSION, "build as a phrase");
    cls("who built this",              AM_IDENTITY, "NEGATIVE: 'built' is not 'build'");

    cls("what cpu is this",            AM_CPU,    "cpu");
    cls("what processor do i have",    AM_CPU,    "processor");
    cls("how many cores",              AM_CPU,    "cores");
    cls("what processes are running",  AM_TASKS,  "NEGATIVE: processes is not processor");

    cls("what resolution is the screen", AM_SCREEN, "resolution");
    cls("how big is the screen",       AM_SCREEN, "screen + size word");
    cls("how many pixels",             AM_SCREEN, "pixels");
    cls("display notes.txt",           AM_NONE,   "NEGATIVE: 'display' alone is a file read");

    cls("clear the screen",            AM_CLEAR,  "clear + screen, above SCREEN");
    cls("wipe this",                   AM_CLEAR,  "wipe");
    cls("erase notes.txt",             AM_NONE,   "NEGATIVE: erase belongs to DELETE");
    cls("wipe notes.txt",              AM_NONE,   "NEGATIVE: a filename means the file");

    cls("what apps do i have",         AM_APPS,   "apps");
    cls("what programs can i run",     AM_APPS,   "programs");
    cls("what can i open",             AM_APPS,   "open form");
    cls("open snake",                  AM_NONE,   "NEGATIVE: naming one is a launch");

    cls("what happened at boot",       AM_BOOT,   "boot");
    cls("how did you boot",            AM_BOOT,   "how form");
    cls("what bootloader was it",      AM_BOOT,   "bootloader");
    cls("start snake",                 AM_NONE,   "NEGATIVE: 'start' is not 'startup'");

    cls("close this window",           AM_CLOSE,  "window");
    cls("quit",                        AM_CLOSE,  "bare quit");
    cls("exit",                        AM_CLOSE,  "bare exit");
    cls("close notes.txt",             AM_NONE,   "NEGATIVE: nothing window-shaped named");

    cls("set the accent to teal",      AM_SET_CHANGE, "accent");
    cls("change the wallpaper",        AM_SET_CHANGE, "wallpaper");
    cls("use the 12 hour clock",       AM_SET_CHANGE, "clock");
    cls("what are my settings",        AM_SET_SHOW,   "report, not change");
    cls("what accent is it",           AM_SET_SHOW,   "accent report");
    cls("open the settings",           AM_NONE,       "NEGATIVE: a launch, not a report");
    cls("write blue to notes.txt",     AM_NONE,       "NEGATIVE: a colour word is not a change");

    grp("set the accent to teal",      0, "accent -> SET_ACCENT");
    grp("change the colour to green",  0, "colour spelling");
    grp("change the wallpaper to ember", 1, "wallpaper -> SET_WALL");
    grp("switch the theme",            1, "theme -> SET_WALL");
    grp("use the 12 hour clock",       2, "clock -> SET_CLOCK");
    grp("what time is it",            -1, "NEGATIVE: the clock chip is not a setting");

    /* ═══ 4. The action chain. Each row also asserts the classifier declined
     * it — that is the ordering gate. ═══ */

    act("write hi to notes.txt",       AM_ACT_WRITE,  "write");
    act("save hello to log.txt",       AM_ACT_WRITE,  "save");
    act("put hi in notes.txt",         AM_ACT_WRITE,  "put — not 'output'");
    act("copy notes.txt to backup.txt", AM_ACT_COPY,  "copy");
    act("duplicate notes.txt to b.txt", AM_ACT_COPY,  "duplicate");
    act("save a copy of notes.txt to backup.txt", AM_ACT_COPY,
        "COPY beats WRITE — otherwise the literal words get written");
    act("append bye to notes.txt",     AM_ACT_APPEND, "append");
    act("add hi to notes.txt",         AM_ACT_APPEND, "add — the natural phrasing");
    act("what is my address",          AM_ACT_NONE,   "NEGATIVE: 'add' inside 'address'");
    act("rename notes.txt to todo.txt", AM_ACT_RENAME, "rename");
    act("move notes.txt to done.txt",  AM_ACT_RENAME, "move");
    act("remove notes.txt",            AM_ACT_DELETE,
        "NEGATIVE: 'move' inside 'remove' must not make this a RENAME");
    act("show me the log",             AM_ACT_READ,
        "'log' is a noun here — claiming it for WRITE breaks the read");
    act("make a file called todo",     AM_ACT_CREATE, "make + file");
    act("create a new note",           AM_ACT_CREATE, "note");
    act("make notes.txt",              AM_ACT_CREATE, "bare filename");
    act("delete notes.txt",            AM_ACT_DELETE, "delete");
    act("rm notes.txt",                AM_ACT_DELETE, "rm as a word");
    act("erase notes.txt",             AM_ACT_DELETE, "erase belongs here, not to CLEAR");
    act("please confirm notes.txt",    AM_ACT_NONE,
        "REGRESSION: 'rm' inside 'confirm' used to DELETE this file");

    /* ── every row below is a prompt that DESTROYED A FILE on a booted build ──
     * Rex typed each of these at a running Astrion and watched the file go.
     * They are the reason DELETE now needs a file-noun and a negation check.
     * Do not relax those guards without deleting these rows first, on purpose,
     * having read what they cost. */
    act("do not delete decoy",         AM_ACT_NONE,
        "DATA LOSS: an explicit instruction NOT to delete, deleted decoy.txt");
    act("never delete decoy",          AM_ACT_NONE,
        "DATA LOSS: 'never delete' deleted decoy.txt");
    act("don't delete notes.txt",      AM_ACT_NONE,
        "DATA LOSS: negation with an apostrophe");
    act("remove your assumptions",     AM_ACT_NONE,
        "DATA LOSS: bare verb, no file named -> deleted assumptions.txt");
    act("remove the decoy",            AM_ACT_NONE,
        "DATA LOSS: bare verb, no file named -> deleted decoy.txt");
    act("what does delete do",         AM_ACT_NONE,
        "DATA LOSS: a QUESTION about delete tried to delete do.txt");
    act("cancel the delete of notes.txt", AM_ACT_NONE,
        "'cancel' is a negation — must not perform the thing being cancelled");
    /* ...and the positives must still work, or the guards are too tight. */
    act("delete the file notes.txt",   AM_ACT_DELETE, "verb + noun + filename");
    act("remove notes from my files",  AM_ACT_DELETE, "verb + file-noun, no .txt");
    act("read notes.txt",              AM_ACT_READ,   "read");
    act("cat notes.txt",               AM_ACT_READ,   "cat with its trailing space");
    act("whats in notes.txt",          AM_ACT_READ,   "what + in");
    act("show me notes.txt",           AM_ACT_READ,   "show, no 'file' word");
    act("open snake",                  AM_ACT_OPEN,   "open");
    act("launch the calculator",       AM_ACT_OPEN,   "launch");
    act("start snake",                 AM_ACT_OPEN,   "start");
    act("open notes.txt",              AM_ACT_OPEN,   "a file, resolved by the caller");
    act("i already did that",          AM_ACT_NONE,   "NEGATIVE: 'read' inside 'already'");
    act("show me the output",          AM_ACT_READ,
        "'put' inside 'output' must not make this a WRITE");

    /* ═══ 4b. WHICH FILE. The extractor that replaced last_word(). ═══
     *
     * The two rows at the top are the reason this exists. Both were run at a
     * booted Astrion and both destroyed a file the user had not named — worse
     * than refusing, and worse than any negation miss, because the name that
     * died was never typed. Each asserts the exact target, not "a file lived". */
    fileis("delete edge3.txt later", AM_NAMED_ONE, "edge3.txt",
           "DATA LOSS: last_word took 'later' -> deleted later.txt, edge3.txt survived");
    fileis("delete a.txt and b.txt", AM_NAMED_MANY, "a.txt",
           "DATA LOSS: last_word took 'b.txt' -> deleted b.txt, a.txt survived");
    nthfile("delete a.txt and b.txt", 1, "b.txt",
            "the MANY refusal has to be able to name the second one too");
    fileis("hold off, delete edge3.txt later", AM_NAMED_ONE, "edge3.txt",
           "the sentence Rex built to prove it — the name is mid-sentence");

    /* The punctuation trap: strip the sentence's full stop, keep the
     * extension's dot. Both dots are '.', only one belongs to the filename. */
    fileis("delete notes.txt.",  AM_NAMED_ONE, "notes.txt", "trailing full stop");
    fileis("delete notes.txt!",  AM_NAMED_ONE, "notes.txt", "trailing bang");
    fileis("delete notes.txt?",  AM_NAMED_ONE, "notes.txt", "trailing question mark");
    fileis("delete notes.txt,",  AM_NAMED_ONE, "notes.txt", "trailing comma");
    fileis("delete 'notes.txt'", AM_NAMED_ONE, "notes.txt", "quoted");
    fileis("delete (notes.txt)", AM_NAMED_ONE, "notes.txt", "bracketed");
    fileis("delete notes.txt...", AM_NAMED_ONE, "notes.txt", "an ellipsis is still punctuation");

    /* Nothing file-shaped -> NONE, and the destructive caller refuses rather
     * than falling back to a bare word. Every one of these deleted a file. */
    fileis("remove your assumptions",     AM_NAMED_NONE, "", "no filename -> deleted assumptions.txt");
    fileis("remove the decoy",            AM_NAMED_NONE, "", "no filename -> deleted decoy.txt");
    fileis("what does delete do",         AM_NAMED_NONE, "", "a QUESTION -> tried to delete do.txt");
    fileis("remove notes from my files",  AM_NAMED_NONE, "",
           "classified DELETE for its file-noun, but names no file — refused at extraction");
    fileis("delete all my files",         AM_NAMED_NONE, "", "no wildcard path exists, and none is invented");
    fileis("delete .txt",                 AM_NAMED_NONE, "", "an extension alone is not a filename");
    fileis("delete my notes",             AM_NAMED_NONE, "", "a bare word is never guessed at");

    /* Ordinary single-file forms, all of which must still work. */
    fileis("delete notes.txt",            AM_NAMED_ONE, "notes.txt",  "the plain form");
    fileis("rm decoy.txt",                AM_NAMED_ONE, "decoy.txt",  "rm");
    fileis("delete the file assumptions.txt", AM_NAMED_ONE, "assumptions.txt", "verb + noun + name");
    fileis("delete stop.txt",             AM_NAMED_ONE, "stop.txt",
           "an opaque filename that happens to be a negation word");
    fileis("delete /a/notes.txt",         AM_NAMED_ONE, "/a/notes.txt", "a path stays whole");
    fileis("read poem.txt",               AM_NAMED_ONE, "poem.txt",   "reads name files too");
    fileis("copy notes.txt to backup.txt", AM_NAMED_MANY, "notes.txt",
           "two names is normal for a copy — the SIDES are what disambiguate it");
    fileis("delete edge1.txt, edge2.txt and edge3.txt", AM_NAMED_MANY, "edge1.txt",
           "three is still ambiguous, not 'do the first'");

    /* Known and accepted: a decimal number is file-shaped to this test. It can
     * only ever resolve to a file that genuinely exists, so the worst case is
     * "no file called 3.5" — and the alternative (a smarter extension rule)
     * would start rejecting real filenames, which is the expensive direction. */
    fileis("delete the file 3.5", AM_NAMED_ONE, "3.5",
           "documented: a decimal looks file-shaped, and harmlessly so");

    /* A token that cannot fit is not counted at all. FS_NAME_MAX is 63, so a
     * name this long cannot name a file that exists — and truncating it could
     * land on one the user never typed, which is this whole section's bug. */
    fileis("delete aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt",
           AM_NAMED_NONE, "", "too long for any real name — not truncated onto a real one");

    /* ═══ 4c. Negation, and the ceiling it has. ═══
     *
     * The first four are caught by the word list. The three after them are NOT
     * — they were typed at a booted Astrion and each destroyed a real file.
     * They are kept here asserting exactly what is true: the word list misses
     * them, they reach DELETE, and the thing that saves the file is the
     * confirmation, not the keyword. */
    rfz("do not delete decoy",          AM_REFUSE_NEGATED, "explicit 'do not'");
    rfz("never delete decoy",           AM_REFUSE_NEGATED, "never");
    rfz("don't delete notes.txt",       AM_REFUSE_NEGATED, "apostrophe form");
    rfz("cancel the delete of notes.txt", AM_REFUSE_NEGATED, "cancel");
    rfz("remove your assumptions",      AM_REFUSE_UNNAMED, "verb, no file named");
    rfz("remove the decoy",             AM_REFUSE_UNNAMED, "verb, no file named");
    rfz("what does delete do",          AM_REFUSE_UNNAMED, "a question about the verb");
    rfz("delete notes.txt",             AM_REFUSE_NONE,    "NEGATIVE: this one goes through");
    rfz("read notes.txt",               AM_REFUSE_NONE,    "NEGATIVE: not a destructive verb");
    rfz("how much memory",              AM_REFUSE_NONE,    "NEGATIVE: no verb at all");
    rfz("how do i remove a file",       AM_REFUSE_NONE,
        "NEGATIVE: the classifier owns this as a listing question, not a blocked delete");

    /* Rex's three misses. Each row asserts the honest truth in three parts:
     * the word list does NOT stop it, the target is at least the RIGHT file,
     * and the action is one that cannot happen without a deliberate yes. */
    act("I'd prefer you didn't delete edge1.txt", AM_ACT_DELETE,
        "CEILING: \"didn't\" is not \"don't\" — the word list misses this");
    fileis("I'd prefer you didn't delete edge1.txt", AM_NAMED_ONE, "edge1.txt",
           "...and if it ever does run, it runs on the file that was named");
    gated("I'd prefer you didn't delete edge1.txt",
          "THE ROW THAT HOLDS IT: destroyed edge1.txt on a booted build");

    act("under no circumstances delete edge2.txt", AM_ACT_DELETE,
        "CEILING: bare \"no\" is not in the list, and adding it would false-refuse elsewhere");
    fileis("under no circumstances delete edge2.txt", AM_NAMED_ONE, "edge2.txt",
           "...right target, wrong intent — the confirm is what saves it");
    gated("under no circumstances delete edge2.txt",
          "THE ROW THAT HOLDS IT: destroyed edge2.txt on a booted build");

    act("the last thing I want is to delete edge4.txt", AM_ACT_DELETE,
        "CEILING: no negation token AT ALL. There is no word here to add.");
    fileis("the last thing I want is to delete edge4.txt", AM_NAMED_ONE, "edge4.txt",
           "...purely semantic negation. A keyword list cannot ever reach this.");
    gated("the last thing I want is to delete edge4.txt",
          "THE ROW THAT HOLDS IT: no keyword list will ever catch this sentence");

    /* The two wrong-file prompts get the same treatment: finding the right
     * target is only half of it, and the other half is that even the right
     * target waits for a yes. */
    gated("delete edge3.txt later",  "the wrong-file case still has to ask first");
    gated("delete a.txt and b.txt",  "and so does the ambiguous one, if it ever resolves");

    /* ═══ 4d. The confirmation, which is what bounds all three of those. ═══
     *
     * The rule is "ask when something is genuinely at risk", and BOTH halves
     * of that are asserted. The rows with dst_has_content=0 are not filler:
     * they are what stops this being "simplified" later into asking every
     * time, which would put a y/n in front of the demo's fastest command
     * without protecting anything. */

    /* Delete asks even with nothing to lose — an empty file is still a file
     * the user named, and unlinking it is still unrecoverable. */
    needs(AM_ACT_DELETE, 1, 1, "unlink cannot be undone");
    needs(AM_ACT_DELETE, 0, 1, "...and that holds for an EMPTY file too - the name goes");

    /* Write: the whole point of the qualifier. */
    needs(AM_ACT_WRITE,  0, 0,
          "THE DEMO PATH: 'write hi to notes.txt' onto a FREE name is a create. "
          "It destroys nothing and must stay ONE step with no prompt.");
    needs(AM_ACT_WRITE,  1, 1,
          "the same sentence onto a file with bytes in it silently destroys them");

    /* Copy behaves identically, for the same reason. */
    needs(AM_ACT_COPY,   0, 0, "copy onto a free or empty name loses nothing");
    needs(AM_ACT_COPY,   1, 1, "copy onto a file with bytes replaces them outright");

    /* Append is the interesting NO: it touches an existing file with content
     * and still needs no gate, because it keeps every byte and adds to the
     * end. Confirming it would be ceremony, not safety. */
    needs(AM_ACT_APPEND, 1, 0,
          "append GROWS a file - nothing is lost even with content there");
    needs(AM_ACT_APPEND, 0, 0, "and nothing is lost on a new file either");

    needs(AM_ACT_RENAME, 1, 0, "the bytes survive under the new name, and it won't clobber");
    needs(AM_ACT_CREATE, 1, 0, "create refuses an existing name, so it destroys nothing");
    needs(AM_ACT_READ,   1, 0, "reads change nothing");
    needs(AM_ACT_OPEN,   1, 0, "opening changes nothing");
    needs(AM_ACT_NONE,   1, 0, "nothing to confirm");

    /* An answer is a deliberate keystroke or it is a no. The empty row is the
     * load-bearing one: a stray Enter is known to re-fire the Assistant's last
     * action, so a confirmation that defaulted to yes would weaponise it. */
    yes("",             0, "A BARE ENTER IS NOT A YES — the whole design rests on this");
    yes(" ",            0, "nor is a space");
    yes("y",            1, "the documented key");
    yes("Y",            1, "case-insensitive");
    yes("yes",          1, "spelled out");
    yes("YES",          1, "shouted");
    yes("yeah",         1, "casual");
    yes("yep",          1, "casual");
    yes("ok",           1, "plain agreement");
    yes("okay",         1, "spelled out — 'ok' must not need to match inside it");
    yes("sure",         1, "plain agreement");
    yes("confirm",      1, "the literal word");
    yes("do it",        1, "imperative");
    yes("go ahead",     1, "imperative");
    yes("n",            0, "the other key");
    yes("no",           0, "spelled out");
    yes("nope",         0, "casual");
    yes("wait",         0, "hesitation is not consent");
    yes("actually no",  0, "a change of mind");
    yes("hold on",      0, "not an affirmative");
    yes("yes but not that one", 0, "agrees and then takes it back — negation wins");
    yes("yes, cancel it",       0, "same shape, other negation word");
    yes("why",          0, "'y' inside 'why' must not confirm a delete");
    yes("yesterday",    0, "'yes' inside 'yesterday' must not confirm a delete");
    yes("your files",   0, "'y' is a word here only by accident of spelling — it isn't");
    yes("delete notes.txt", 0,
        "retyping the command is NOT an answer: one question, one deliberate yes");
    yes("list my files",    0, "an unrelated command cancels rather than confirming");

    /* ═══ 4e. THE INPUT PATH. Rex booted this and the property was FALSE. ═══
     *
     * Every row above about the empty string was passing while an armed delete
     * survived a bare Enter on the real build, because the key handler dropped
     * empty submissions before the predicate ran. These rows ask what the real
     * path asks, so the emptiness rule cannot be true here and false there. */
    sub("",               "k2.txt", AM_SUBMIT_CANCEL,
        "THE BUG: a bare Enter at a pending question must CANCEL it, not vanish");
    sub("",               0,        AM_SUBMIT_IGNORE,
        "...but with nothing pending an empty line is still a non-event");
    sub(" ",              "k2.txt", AM_SUBMIT_CANCEL, "whitespace is not a yes either");
    sub("y",              "k2.txt", AM_SUBMIT_RUN,    "the deliberate keystroke");
    sub("yes",            "k2.txt", AM_SUBMIT_RUN,    "spelled out");
    sub("n",              "k2.txt", AM_SUBMIT_CANCEL, "an explicit no");
    sub("list my files",  "k2.txt", AM_SUBMIT_CANCEL,
        "an unrelated command answers the question by cancelling it");
    sub("list my files",  0,        AM_SUBMIT_PROMPT, "...and runs normally when nothing is pending");
    sub("y",              0,        AM_SUBMIT_PROMPT,
        "a stray 'y' with nothing pending is just a prompt - it cannot delete anything");
    sub("delete notes.txt", 0,      AM_SUBMIT_PROMPT, "the arming submission is an ordinary prompt");

    /* ═══ 4f. A YES TO WHAT? Rex booted the fix above and found this. ═══
     *
     * Every row here answers with a REAL AFFIRMATIVE, because that is the
     * input that actually fires the pending payload. Probing with a
     * non-affirmative is what made the bare-Enter case look safe last round —
     * it cancelled for the wrong reason and the gate underneath was still
     * live. So: assert with the input that would destroy the file. */
    sub("yes delete k3.txt",  "k2.txt", AM_SUBMIT_CANCEL,
        "DATA LOSS: a yes naming a DIFFERENT file deleted k2.txt, and k3.txt lived");
    sub("sure, but delete k3.txt instead", "k4.txt", AM_SUBMIT_CANCEL,
        "DATA LOSS: an explicit correction - 'instead' - and it deleted k4.txt anyway");
    sub("yes copy to k3.txt",  "cbig.txt", AM_SUBMIT_CANCEL,
        "DATA LOSS: same hole on the COPY gate - cbig.txt went 20 B -> 3 B");
    sub("yes, k3.txt",         "k2.txt", AM_SUBMIT_CANCEL,
        "the general case: redirection with NO correction word at all to match on");
    sub("yes write to k3.txt", "wbig.txt", AM_SUBMIT_CANCEL,
        "and on the WRITE gate - all three share one decision, so all three are fixed");

    /* ...and the other direction, so this is not "fixed" into uselessness. */
    sub("yes",                 "k2.txt", AM_SUBMIT_RUN, "a plain yes still confirms");
    sub("yes please",          "k2.txt", AM_SUBMIT_RUN, "no file named -> still about k2.txt");
    sub("yes delete k2.txt",   "k2.txt", AM_SUBMIT_RUN,
        "naming the SAME file is agreement, not a correction");
    sub("yes, delete k2.txt.", "k2.txt", AM_SUBMIT_RUN,
        "...and sentence punctuation must not turn agreement into a mismatch");
    sub("go ahead and delete k2.txt", "k2.txt", AM_SUBMIT_RUN, "restated in full");
    sub("no delete k3.txt",    "k2.txt", AM_SUBMIT_CANCEL,
        "not an affirmative either way - cancels on both counts");
    sub("yes delete k2.txt and k3.txt", "k2.txt", AM_SUBMIT_CANCEL,
        "names the target AND another - still ambiguous, still cancels");

    /* The sequences. The defect lived in the JOIN between two submissions, so
     * no single-row assertion could have found it. */
    {
        static const char *const arm_enter_yes[] = { "delete modal2.txt", "", "yes" };
        static const char *const arm_enter_cmd[] = { "delete modal2.txt", "", "list my files" };
        static const char *const arm_yes[]       = { "delete modal2.txt", "yes" };
        static const char *const arm_no_yes[]    = { "delete modal2.txt", "n", "yes" };
        static const char *const arm_enter_ent[] = { "delete modal2.txt", "", "" };

        static const char *const arm_redirect[]  = { "delete k2.txt", "yes delete k3.txt" };
        static const char *const arm_instead[]   = { "delete k4.txt",
                                                     "sure, but delete k3.txt instead" };
        static const char *const arm_redir_yes[] = { "delete k2.txt", "yes delete k3.txt", "yes" };

        seq(arm_enter_yes, 3, "",
            "THE DATA-LOSS PATH: arm, Enter (user believes it is dismissed), then an "
            "unrelated 'yes' -> this DELETED THE FILE before the fix");
        seq(arm_enter_cmd, 3, "",
            "the sequence Rex actually ran: the file survived, but only because the "
            "command was not a yes - the gate was still armed through the Enter");
        seq(arm_yes, 2, "modal2.txt",
            "and the real confirmation must still work - answering yes deletes, and "
            "deletes THE FILE THAT WAS ARMED");
        seq(arm_no_yes, 3, "",
            "a no disarms for good: a later 'yes' must not resurrect the question");
        seq(arm_enter_ent, 3, "",
            "two Enters in a row cannot delete anything");

        /* The new join. Note what the first row asserts: not "k3.txt survived"
         * — k3.txt survived the BUG too — but that NOTHING fired at all. Under
         * the defect this destroyed k2.txt, so a row checking only k3.txt
         * would have passed against broken code. */
        seq(arm_redirect, 2, "",
            "DATA LOSS: 'yes delete k3.txt' fired the pending payload and killed k2.txt");
        seq(arm_instead, 2, "",
            "DATA LOSS: an explicit 'instead' correction killed k4.txt");
        seq(arm_redir_yes, 3, "",
            "and the correction must DISARM, not just skip once - a plain 'yes' "
            "afterwards has nothing left to fire");
    }

    /* ═══ 4g. THE STALE INPUT BUFFER, open three rebuilds. ═══
     *
     * "open the calculator" hands focus to the Calculator, and wm.c used to
     * clear the prompt only when the Assistant KEPT focus — so the text stayed
     * in the buffer and a later bare Enter re-ran it. These need the buffer
     * model above; no amount of predicate testing can see a bug that lives in
     * what happens to the buffer between two Enters. */
    {
        struct as_model m;

        m_init(&m);
        m_line(&m, "open the calculator");
        if (m.buf[0]) {
            printf("  FAIL the prompt still holds \"%s\" after an app-open\n"
                   "        (a dispatched line must be consumed even when "
                   "another window took focus)\n", m.buf);
            failures++;
        }
        m_enter(&m);                     /* the bare Enter, as Rex typed it */
        if (m.opens != 1) {
            printf("  FAIL a bare Enter after 'open the calculator' opened it "
                   "again (%d opens, expected 1)\n", m.opens);
            failures++;
        }

        /* The same shape once the stuck sentence is a DESTRUCTIVE one. This is
         * why it gets fixed while it is still harmless: today the buffer can
         * only stick on an app-open, and this is what it would cost the moment
         * that stopped being true. */
        m_init(&m);
        m_fs_put(&m, "k9.txt", 8, 0x99);
        m_line(&m, "delete k9.txt");      /* arms, and must clear the buffer */
        if (m.buf[0]) {
            printf("  FAIL the prompt still holds \"%s\" after arming a delete\n",
                   m.buf);
            failures++;
        }
        m_enter(&m);                      /* bare Enter -> cancels the gate */
        m_enter(&m);                      /* and again -> nothing to re-fire */
        if (m.died[0]) {
            printf("  FAIL bare Enters after arming a delete destroyed %s\n",
                   m.died);
            failures++;
        }

        /* Normal commands were always fine — assert it so a future change to
         * the clearing rule cannot quietly break the ordinary path either. */
        m_init(&m);
        m_line(&m, "how much memory");
        if (m.buf[0]) {
            printf("  FAIL the prompt still holds \"%s\" after a normal command\n",
                   m.buf);
            failures++;
        }
    }

    /* ═══ 4h. THE CONFIRMATION MUST NOT LIE. ═══
     *
     * The confirm displays a byte count. The user reads it and consents to
     * losing THOSE bytes. If the file is replaced between the question and the
     * answer, the number we showed them has become false and their yes no
     * longer means what they thought it meant.
     *
     * Two of us reasoned this was fine — "they said delete race.txt and
     * race.txt is what went" — and we were both wrong, because the prompt does
     * not merely name the file, it states a fact about it. Rex ran it. */
    identis(9, 0xAA, 1,  9, 0xAA, 1, 1, "unchanged - the yes still means what it meant");
    identis(9, 0xAA, 1, 15, 0xBB, 1, 0, "THE RACE: 9 B described, 15 B present");
    identis(9, 0xAA, 1,  9, 0xBB, 1, 0,
            "SAME SIZE, different bytes - a size check alone would wave this through");
    identis(9, 0xAA, 1,  0, 0,    0, 0, "the file is gone - there is nothing to agree about");
    identis(0, 0,    0,  9, 0xAA, 1, 0, "never had a valid description -> never act");

    {
        struct as_model m;

        /* Rex's serial log, replayed. */
        m_init(&m);
        m_fs_put(&m, "race.txt", 9, 0xA1D);         /* write OLDOLDOLD */
        m_line(&m, "delete race.txt");              /* confirm shows "(9 B)" */
        m_fs_rm(&m, "race.txt");                    /* shell: rm race.txt   */
        m_fs_put(&m, "race.txt", 15, 0x11E7);       /* shell: 15 B, new text */
        m_line(&m, "yes");
        if (m.died[0]) {
            printf("  FAIL THE RACE: yes destroyed %s after it was replaced "
                   "underneath the question (user was shown 9 B, file was 15 B)\n",
                   m.died);
            failures++;
        }
        if (!m.blocked) {
            printf("  FAIL the race was not detected as a change at all\n");
            failures++;
        }

        /* The same trick at an identical size — the one a size-only check
         * would let through, which is why identity includes the content. */
        m_init(&m);
        m_fs_put(&m, "sneak.txt", 9, 0xA1D);
        m_line(&m, "delete sneak.txt");
        m_fs_put(&m, "sneak.txt", 9, 0xBEEF);       /* 9 B still, other bytes */
        m_line(&m, "yes");
        if (m.died[0]) {
            printf("  FAIL a same-size replacement slipped through and "
                   "destroyed %s\n", m.died);
            failures++;
        }

        /* THE NEGATIVE. Nothing touched it, so yes must still delete — and
         * delete the file that was armed. Without this row the whole check
         * could be "return 0" and everything above would pass. */
        m_init(&m);
        m_fs_put(&m, "calm.txt", 9, 0xA1D);
        m_line(&m, "delete calm.txt");
        m_line(&m, "yes");
        if (strcmp(m.died, "calm.txt") != 0) {
            printf("  FAIL an UNCHANGED file did not delete on yes (died=\"%s\") "
                   "- the check is fixed into uselessness\n", m.died);
            failures++;
        }

        /* Churn on a DIFFERENT file must not block the one we asked about. */
        m_init(&m);
        m_fs_put(&m, "t.txt", 9, 0xA1D);
        m_fs_put(&m, "other.txt", 3, 0x111);
        m_line(&m, "delete t.txt");
        m_fs_put(&m, "other.txt", 99, 0x222);       /* unrelated shell activity */
        m_line(&m, "yes");
        if (strcmp(m.died, "t.txt") != 0) {
            printf("  FAIL unrelated file churn blocked a valid delete "
                   "(died=\"%s\")\n", m.died);
            failures++;
        }

        /* Rewritten with BYTE-IDENTICAL content: this must still delete.
         * Destroying identical bytes destroys exactly what was described, so
         * refusing would be false caution. This row is what pins the choice of
         * a content fingerprint over a modification timestamp — swap one in
         * and this is the row that objects. */
        m_init(&m);
        m_fs_put(&m, "same.txt", 9, 0xA1D);
        m_line(&m, "delete same.txt");
        m_fs_rm(&m, "same.txt");
        m_fs_put(&m, "same.txt", 9, 0xA1D);         /* identical rewrite */
        m_line(&m, "yes");
        if (strcmp(m.died, "same.txt") != 0) {
            printf("  FAIL an identical rewrite blocked the delete (died=\"%s\") "
                   "- content identity, not mtime\n", m.died);
            failures++;
        }
    }

    /* ═══ 4i. "IT" — the conversation's one slot. ═══
     *
     * The rewrite is asserted in full, not just "it resolved": a pronoun that
     * resolves to the wrong sentence is the same class of bug as an extractor
     * that picks the wrong token, and this arc has already shipped one of those. */
    ref("write hello to it",  "notes.txt", AM_REF_DONE, "write hello to notes.txt",
        "THE SPEC'S CASE: today this creates a file called it.txt");
    ref("open it",            "notes.txt", AM_REF_DONE, "open notes.txt",     "open");
    ref("actually delete it", "notes.txt", AM_REF_DONE, "actually delete notes.txt",
        "and straight into the confirm gate, which will NAME notes.txt on screen");
    ref("read it",            "notes.txt", AM_REF_DONE, "read notes.txt",     "read");
    ref("delete that",        "notes.txt", AM_REF_DONE, "delete notes.txt",   "that");
    ref("read this",          "notes.txt", AM_REF_DONE, "read notes.txt",     "this");
    ref("delete the file",    "notes.txt", AM_REF_DONE, "delete notes.txt",   "the file");
    ref("read the same file", "notes.txt", AM_REF_DONE, "read notes.txt",
        "longest phrase wins - not 'the' + debris");
    ref("append bye to the same", "notes.txt", AM_REF_DONE, "append bye to notes.txt",
        "bare 'the same'");
    ref("copy it to backup.txt",  "notes.txt", AM_REF_NONE, "",
        "an explicit filename is present, so the pronoun path stands down entirely");

    /* Nothing recorded -> REFUSE. Never a literal it.txt. */
    ref("open it",         "", AM_REF_UNSET, "", "THE RULE: refuse, never invent it.txt");
    ref("delete it",       "", AM_REF_UNSET, "", "and especially not in front of delete");
    ref("write hi to it",  "", AM_REF_UNSET, "", "nor as a write destination");

    /* Negatives — the words appear but nothing may be rewritten. */
    ref("read it.txt",     "notes.txt", AM_REF_NONE, "",
        "SPEC NEGATIVE: it.txt is a real filename, not a pronoun");
    ref("delete it.txt",   "notes.txt", AM_REF_NONE, "",
        "...and that has to hold in front of a destructive verb too");
    ref("is it working",   "notes.txt", AM_REF_NONE, "",
        "SPEC NEGATIVE: a question about the machine, not a file operation");
    ref("what is this",    "notes.txt", AM_REF_NONE, "",
        "the classifier owns this one - IDENTITY, and it must not be rewritten");
    ref("close it",        "notes.txt", AM_REF_NONE, "",
        "CLOSE claims this first: it means the window, not the file");
    ref("what time is it", "notes.txt", AM_REF_NONE, "", "DATE owns it");
    ref("make a file called it", "notes.txt", AM_REF_NONE, "",
        "create NAMES something new - there is nothing to refer back to");
    ref("how much memory", "notes.txt", AM_REF_NONE, "", "no referring word at all");
    ref("delete notes.txt","notes.txt", AM_REF_NONE, "", "an ordinary named delete");
    ref("split it",        "notes.txt", AM_REF_NONE, "",
        "'it' is there but no file action wants a name - nothing to rewrite");

    /* The conversation, end to end. This is the whole feature: it lives in the
     * join between submissions and nothing standalone can express it. */
    {
        struct as_model m;

        m_init(&m);
        m_line(&m, "make notes.txt");
        if (strcmp(m.last, "notes.txt")) {
            printf("  FAIL after 'make notes.txt' the slot holds \"%s\"\n", m.last);
            failures++;
        }
        m_line(&m, "write hello to it");
        if (m_fs_get(&m, "it.txt")) {
            printf("  FAIL 'write hello to it' created a file called it.txt "
                   "- the exact bug this feature exists to kill\n");
            failures++;
        }
        if (!m_fs_get(&m, "notes.txt")) {
            printf("  FAIL 'write hello to it' did not write notes.txt\n");
            failures++;
        }
        m_line(&m, "delete it");
        if (strcmp(m.pend, "notes.txt")) {
            printf("  FAIL 'delete it' armed on \"%s\", expected notes.txt "
                   "- the confirm would have shown the wrong name\n", m.pend);
            failures++;
        }
        m_line(&m, "yes");
        if (strcmp(m.died, "notes.txt")) {
            printf("  FAIL the conversation deleted \"%s\", expected notes.txt\n", m.died);
            failures++;
        }
        if (m.last[0]) {
            printf("  FAIL the slot still names \"%s\" after it was deleted\n", m.last);
            failures++;
        }

        /* Nothing recorded: refuse, and create nothing. */
        m_init(&m);
        m_line(&m, "open it");
        if (!m.refused_ref) {
            printf("  FAIL 'open it' with an empty slot did not refuse\n");
            failures++;
        }
        if (m_fs_get(&m, "it.txt")) {
            printf("  FAIL 'open it' invented it.txt\n");
            failures++;
        }

        /* The slot expires. Four unrelated prompts is further than any pronoun
         * should reach back — resolving there would be a confident guess. */
        m_init(&m);
        m_line(&m, "make notes.txt");
        m_line(&m, "how much memory");
        m_line(&m, "what time is it");
        m_line(&m, "what cpu is this");
        m_line(&m, "who are you");
        m_line(&m, "delete it");
        if (m.armed) {
            printf("  FAIL 'delete it' resolved to \"%s\" after five unrelated "
                   "prompts - the slot never expired\n", m.pend);
            failures++;
        }
        if (!m.refused_ref) {
            printf("  FAIL an expired slot did not produce a refusal\n");
            failures++;
        }

        /* ...but it must survive a NORMAL gap, or the feature is useless. */
        m_init(&m);
        m_line(&m, "make notes.txt");
        m_line(&m, "how much memory");
        m_line(&m, "delete it");
        if (strcmp(m.pend, "notes.txt")) {
            printf("  FAIL the slot expired too eagerly - 'delete it' after one "
                   "unrelated question armed on \"%s\"\n", m.pend);
            failures++;
        }

        /* The slot follows the most recent file, not the first one. */
        m_init(&m);
        m_line(&m, "make a.txt");
        m_line(&m, "make b.txt");
        m_line(&m, "delete it");
        if (strcmp(m.pend, "b.txt")) {
            printf("  FAIL 'it' should mean the most recent file b.txt, got \"%s\"\n",
                   m.pend);
            failures++;
        }
    }

    /* ═══ 4j. did you mean? Suggest, never correct. ═══ */
    dym("notes.txt", "note.txt",  1, "THE SPEC'S CASE: one deletion");
    dym("note.txt",  "notes.txt", 1, "and the other direction");
    dym("notes.txt", "notes.txt", 0, "an exact match is not a suggestion");
    dym("notes.txt", "notez.txt", 1, "one substitution");
    dym("notes.txt", "backup.txt", 0, "nothing like it - say nothing at all");
    dym("a.txt",     "b.txt",     0,
        "one edit apart and 80% identical BY WHOLE NAME - but the stems share "
        "nothing, and these are two different files, not a typo");
    dym("notes.txt", "notes.doc", 0, "three edits - a different extension, not a slip");
    dym("log.txt",   "dog.txt",   1, "3-char stem, one edit: the tightest thing offered");
    dym("ab.txt",    "cd.txt",    0, "2-char stems are below the floor entirely");
    dym("assumptions.txt", "assumption.txt", 1, "long names tolerate an edit");
    dym("",          "notes.txt", 0, "empty input suggests nothing");

    /* ═══ 5. Which app "open X" names. ═══ */
    opn("open the editor",             AM_OPEN_EDITOR,   "editor");
    opn("open snake",                  AM_OPEN_SNAKE,    "snake");
    opn("open my files",               AM_OPEN_FILES,    "files");
    opn("go to the terminal",          AM_OPEN_TERMINAL, "terminal");
    opn("open the shell",              AM_OPEN_TERMINAL, "shell");
    opn("open the system monitor",     AM_OPEN_MONITOR,  "monitor");
    opn("open the task manager",       AM_OPEN_MONITOR,  "task manager");
    opn("open the calculator",         AM_OPEN_CALC,     "calculator");
    opn("open calc",                   AM_OPEN_CALC,     "calc");
    opn("open the settings",           AM_OPEN_SETTINGS, "settings");
    opn("open notes.txt",              AM_OPEN_NONE,     "NEGATIVE: a filename is not an app");
    opn("open the browser",            AM_OPEN_NONE,
        "NEGATIVE: there is no browser — never alias it onto Files");
    opn("open calculations.txt",       AM_OPEN_NONE,     "NEGATIVE: 'calc' inside a filename");

    /* ═══ 6. am_wants_generation — the original table, unchanged. ═══ */

    /* Real requests for invented text — these SHOULD reach the model. */
    want("write me a poem",              1, "explicit creative ask");
    want("write me a story about a dog", 1, "explicit creative ask");
    want("tell me a story",              1, "article form");
    want("make up a name for my cat",    1, "make up");
    want("imagine a world with no cars", 1, "imagine");
    want("pretend you are a pirate",     1, "pretend");
    want("WRITE ME A POEM",              1, "case-insensitive");

    /* File operations — these must NEVER reach the model. The first is the
     * exact prompt that broke on a booted build. */
    want("read poem.txt",                0, "REGRESSION: the shipped bug");
    want("read story.txt",               0, "same shape, other keyword");
    want("open poem.txt",                0, "open verb");
    want("delete story.txt",             0, "delete verb");
    want("copy poem.txt to backup.txt",  0, "copy verb");
    want("append a line to poem.txt",    0, "append verb");
    want("list my files",                0, "list verb");
    want("read notes.txt",               0, "ordinary read");
    want("rename poem.txt to a.txt",     0, "rename verb");
    want("move story.txt to old.txt",    0, "move verb");

    /* Machine questions — the intent table owns these; the model must not. */
    want("how much memory",              0, "real intent");
    want("what's running",               0, "real intent");
    want("who are you",                  0, "real intent");
    want("help",                         0, "real intent");

    /* Unparseable input gets the honest refusal, not invented text. */
    want("banana helicopter thursday",   0, "nonsense -> refusal");
    want("",                             0, "empty prompt");

    /* The creative prompts must ALSO survive both routing passes untouched —
     * an intent that claims them is how the poetry bug happened in reverse. */
    cls("write me a poem",               AM_NONE, "the model owns this");
    cls("tell me a story",               AM_NONE, "the model owns this");
    cls("make up a name for my cat",     AM_NONE, "the model owns this");
    cls("pretend you are a pirate",      AM_NONE, "the model owns this");
    cls("imagine a world with no cars",  AM_NONE, "the model owns this");
    if (am_action_of("make up a name for my cat") != AM_ACT_NONE) {
        printf("  FAIL \"make up a name for my cat\" was claimed as action %s\n",
               aname(am_action_of("make up a name for my cat")));
        failures++;
    }

    /* Nonsense must reach neither table. */
    cls("banana helicopter thursday",    AM_NONE, "nonsense -> refusal");
    cls("",                              AM_NONE, "empty prompt");

    printf("failures  %d\n", failures);
    printf(failures ? "\nFAILED\n" : "\nPASS\n");
    return failures ? 1 : 0;
}
