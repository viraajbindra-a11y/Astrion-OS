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
static void needs(enum am_action a, int content, int expect, const char *why)
{
    int got = am_needs_confirm(a, content);
    if (got != expect) {
        printf("  FAIL am_needs_confirm(%s, dst_has_content=%d) = %d, "
               "expected %d  (%s)\n", aname(a), content, got, expect, why);
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
