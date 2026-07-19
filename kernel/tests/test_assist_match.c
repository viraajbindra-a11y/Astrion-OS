/* Table-driven gate for Assistant prompt matching.
 *
 * Exists because am_has() is a bare substring test and has now produced two
 * bugs of the same shape. The second one — `read poem.txt` routed into a
 * poetry generator because the prompt contains "poem" — reached a booted
 * build and was caught by a screenshot, not by review. A table catches it in
 * milliseconds. Every new intent keyword should get a row here, especially a
 * NEGATIVE row.
 */
#include <stdio.h>
#include "assist_match.h"

static int failures;

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

    /* Machine questions — the intent table owns these; the model must not. */
    want("how much memory",              0, "real intent");
    want("what's running",               0, "real intent");
    want("who are you",                  0, "real intent");
    want("help",                         0, "real intent");

    /* Unparseable input gets the honest refusal, not invented text. */
    want("banana helicopter thursday",   0, "nonsense -> refusal");
    want("",                             0, "empty prompt");

    printf("failures  %d\n", failures);
    printf(failures ? "\nFAILED\n" : "\nPASS\n");
    return failures ? 1 : 0;
}
