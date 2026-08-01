/*
 * Astrion v2.0 — the Assistant remembers how YOU say things
 *
 * The first piece of "the operating system that adapts", and deliberately the
 * piece that needs no training at all.
 *
 * Real use looks like this. You ask for something, the Assistant says "I didn't
 * understand that one", you rephrase it, and the second one works. That
 * sequence is a free lesson and Astrion used to throw it away — ask the same
 * way tomorrow and it fails exactly the same way. Nothing in the machine got
 * wiser for having been corrected.
 *
 * So: when a prompt fails and the NEXT one succeeds, remember the pair. Ask the
 * failed way again and it is quietly replayed as the way that worked.
 *
 * What this is not: it does not change a single weight, and it is not the model
 * learning anything. Training needs floating point (the kernel is built with
 * -mno-sse), gigabytes for optimizer state (the heap is 32 MB), and a GPU. All
 * three are real walls and none of them are in the way here, because this is a
 * lookup table on disk. That is the whole trick — the visible half of adapting
 * costs almost nothing, and the expensive half can arrive later without
 * changing any of this.
 *
 * Everything is bounded on purpose: a fixed table, fixed strings, no kmalloc.
 * A feature that grows without limit while the user types is a memory leak with
 * a nice name.
 */

#ifndef ASTRION_LEARN_H
#define ASTRION_LEARN_H

#define LEARN_MAX      32     /* remembered pairs; oldest is evicted */
#define LEARN_TEXT     96     /* longest phrasing kept, including NUL */

/* Read the saved pairs off disk. Safe to call with no disk and no file — a
 * machine with nothing learned yet is the normal first-boot case, not an error. */
void        learn_init(void);

/* If this prompt has failed before AND something worked right after it, return
 * that working phrasing. Otherwise 0. Matching ignores case and outer spaces,
 * because "Open Snake" and "open snake" are the same request from a human. */
const char *learn_lookup(const char *prompt);

/* Record that `worked` is what `failed` was trying to say, and persist it.
 * Ignores empty strings, over-long ones, and pairs that are equal after
 * normalising — a prompt cannot teach you anything about itself. */
void        learn_record(const char *failed, const char *worked);

int         learn_count(void);              /* how many pairs are known */

/* For the Assistant's "what have you learned" answer: the i'th pair, or 0. */
const char *learn_failed_at(int i);
const char *learn_worked_at(int i);

/* Forget everything, on disk too. The user must always be able to undo what the
 * machine decided about them. */
void        learn_forget_all(void);

#endif
