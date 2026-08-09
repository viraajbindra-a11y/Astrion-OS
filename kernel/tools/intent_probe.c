/*
 * intent_probe — run phrasings through Astrion's REAL intent matcher and say
 * where each one lands.
 *
 * This is the verifier half of the teaching loop, and it is the half that
 * matters. A big model can generate a thousand ways to ask for the same thing;
 * that is cheap and it is not the hard part. The hard part is knowing which of
 * those the Assistant actually understands, because a training corpus built
 * from unchecked model output is just the model's guesses with extra steps —
 * which is exactly what the research refuted about closed-loop self-training.
 * New information has to enter through something that can say NO.
 *
 * Here that something already existed: am_classify() and am_action_of() in
 * include/assist_match.h are pure static-inline functions over a const char*.
 * No kernel, no QEMU, no framebuffer. So the same routing decision the booted
 * Assistant makes can be made here, thousands of times a second, on the host.
 *
 *   cc -std=c11 -Iinclude tools/intent_probe.c -o build/intent_probe
 *   ./build/intent_probe < phrasings.txt
 *   ./build/intent_probe --expect corpus.tsv     # "phrase<TAB>expected" pairs
 *
 * Plain stdin mode prints where each line routed. --expect mode is the useful
 * one: it reads a corpus of phrasing + intended meaning and reports every line
 * the matcher gets WRONG — those are the gaps, and the gaps are the product.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is an APPROXIMATION of the booted Assistant, not a replica. It runs
 * am_classify() then am_action_of(), which is most of the routing but not all
 * of it — wm.c's try_intent() has further layers (am_open_target among them)
 * and its own ordering. So:
 *
 *   MISS  is high confidence. Neither layer claimed the phrase, and the live
 *         Assistant really does answer "I didn't understand that one" —
 *         confirmed by booting it for "gimme my files".
 *   WRONG is a CANDIDATE and must be confirmed on a real boot before anyone
 *         calls it a bug. "show me the monitor" is reported here as file.read,
 *         and the booted kernel actually gives the honest fallback. A later
 *         layer declines what this one claims.
 *
 * That distinction is the whole reason this file says it out loud. A tool that
 * hands you a confident list of "misroutes", most of which are artefacts of the
 * tool, wastes more time than it saves — and would be precisely the kind of
 * unverified output this pipeline exists to filter OUT.
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#include "assist_match.h"

/* Every routing outcome under one name, because a phrase can be claimed by the
 * classifier, by the action layer, or by the open-a-window layer, and "which
 * one won" is the whole question. am_classify runs first and anything it takes
 * never reaches the others — see the note at the top of assist_match.h. */
static const char *intent_name(enum am_intent i) {
    switch (i) {
    case AM_NONE:        return "none";
    case AM_VERSION:     return "version";
    case AM_IDENTITY:    return "identity";
    case AM_HELP:        return "help";
    case AM_CLOSE:       return "close";
    case AM_SET_CHANGE:  return "settings.change";
    case AM_SET_SHOW:    return "settings.show";
    case AM_MEMORY:      return "memory";
    case AM_DISK:        return "disk";
    case AM_CPU:         return "cpu";
    case AM_TASKS:       return "tasks";
    case AM_CLEAR:       return "clear";
    case AM_SCREEN:      return "screen";
    case AM_APPS:        return "apps";
    case AM_UPTIME:      return "uptime";
    case AM_BOOT:        return "boot";
    case AM_DATE:        return "date";
    case AM_FILES_COUNT: return "files.count";
    case AM_FILES_LIST:  return "files.list";
    }
    return "?";
}

static const char *action_name(enum am_action a) {
    switch (a) {
    case AM_ACT_NONE:   return "none";
    case AM_ACT_RENAME: return "file.rename";
    case AM_ACT_COPY:   return "file.copy";
    case AM_ACT_APPEND: return "file.append";
    case AM_ACT_WRITE:  return "file.write";
    case AM_ACT_CREATE: return "file.create";
    case AM_ACT_DELETE: return "file.delete";
    case AM_ACT_READ:   return "file.read";
    case AM_ACT_OPEN:   return "app.open";
    }
    return "?";
}

/* The single label a phrase routes to, in the same order the Assistant tries
 * them. "none" means the Assistant would answer "I didn't understand that one",
 * which for a corpus line with an expected meaning is a MISS — a real request a
 * real person could type, that Astrion drops on the floor. */
static const char *route(const char *p) {
    enum am_intent i = am_classify(p);
    if (i != AM_NONE) return intent_name(i);
    enum am_action a = am_action_of(p);
    if (a != AM_ACT_NONE) return action_name(a);
    return "none";
}

static void chomp(char *s) {
    size_t n = strlen(s);
    while (n && (s[n-1] == '\n' || s[n-1] == '\r')) s[--n] = 0;
}

int main(int argc, char **argv) {
    int expect_mode = (argc > 1 && strcmp(argv[1], "--expect") == 0);
    FILE *in = stdin;
    if (expect_mode && argc > 2) {
        in = fopen(argv[2], "r");
        if (!in) { fprintf(stderr, "cannot open %s\n", argv[2]); return 2; }
    } else if (!expect_mode && argc > 1) {
        in = fopen(argv[1], "r");
        if (!in) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
    }

    char line[512];
    int total = 0, hit = 0, miss = 0, wrong = 0;

    while (fgets(line, sizeof line, in)) {
        chomp(line);
        if (!line[0] || line[0] == '#') continue;

        if (!expect_mode) {
            printf("%-44s -> %s\n", line, route(line));
            total++;
            continue;
        }

        char *tab = strchr(line, '\t');
        if (!tab) {
            fprintf(stderr, "no TAB in: %s\n", line);
            continue;
        }
        *tab = 0;
        const char *phrase = line, *want = tab + 1;
        const char *got = route(phrase);
        total++;

        if (strcmp(got, want) == 0) {
            hit++;
        } else if (strcmp(got, "none") == 0) {
            /* The common and most fixable case: nobody claimed it. */
            miss++;
            printf("MISS   %-44s want %-16s got nothing\n", phrase, want);
        } else {
            /* Rarer and more dangerous: something else claimed it, so the user
             * gets a confident WRONG action instead of an honest shrug. */
            wrong++;
            printf("CHECK  %-44s want %-16s got %s  (confirm on a real boot)\n",
                   phrase, want, got);
        }
    }

    if (expect_mode) {
        printf("\n%d phrasings: %d understood, %d missed, %d to check\n",
               total, hit, miss, wrong);
        if (total)
            printf("coverage %.1f%%\n", 100.0 * hit / total);
        /* Exit 0 either way. A CHECK line is a candidate for a human to boot
         * and confirm, not a verdict — failing the build on it would be this
         * tool asserting something it cannot actually see. MISS lines are real
         * but they are a coverage backlog, not a regression, and a permanently
         * red gate is one nobody reads. */
        return 0;
    }
    printf("\n%d phrasings routed\n", total);
    return 0;
}
