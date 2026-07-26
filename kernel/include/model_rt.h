#ifndef MODEL_RT_H
#define MODEL_RT_H

#include <stdint.h>
#include "model.h"

/*
 * Astrion v2.0 — the model RUNTIME: the glue that makes the in-kernel engine
 * (model.c / model_load.c / tok.c) an actually-running brain instead of a
 * host-tested library nothing calls.
 *
 * Two jobs, both offline, both allocation-bounded:
 *   1. AT BOOT — model_rt_init() scans the multiboot2 modules GRUB handed us,
 *      identifies the tokenizer (ATK1) and the brain (AMW1) by their MAGIC (not
 *      by filename), installs the tokenizer and model_load()s the brain, then
 *      allocates the forward-pass scratch + KV cache from the heap. The weight
 *      bytes are NOT copied — every pointer in struct model_weights points
 *      straight into the module's already-mapped pages (real Ember is hundreds
 *      of MB; a memcpy is not on the table). It logs the loaded config on serial
 *      and can never fault: a missing or malformed module just leaves the
 *      runtime "not ready" and the kernel boots on.
 *   2. AT RUNTIME — model_rt_generate() is the greedy-decode loop the Assistant
 *      calls: tokenize -> model_forward/model_argmax up to a hard cap -> detok
 *      -> stream bytes out. No float anywhere; the engine is integer end to end.
 */

/* Scan modules, install the tokenizer + load the brain, allocate scratch. Logs
 * the outcome (and the config: dim / n_layers / n_heads / vocab) to serial.
 * Call ONCE, after heap_init() (it kmalloc's the KV cache + scratch) and after
 * the multiboot2 modules have been recorded. Idempotent-safe on a second call
 * only in that it will simply re-report; do not rely on that — call it once. */
void model_rt_init(void);

/* 1 once a brain is loaded AND its scratch is allocated (generation is live),
 * else 0. The Assistant checks this to say "no brain loaded" rather than fault. */
int model_rt_ready(void);

/* The loaded model's config, or NULL if no brain is ready. Read-only; the UI
 * uses it to name the model's size honestly. */
const struct model_config *model_rt_config(void);

/* Greedy-decode from the C-string `prompt`. Tokenizes it (real BPE if a
 * tokenizer module is installed, else a raw-byte fallback), runs the
 * forward/argmax loop for up to `max_new` NEW tokens — stopping early on EOS or
 * when the KV cache fills (cfg.max_seq) — detokenizes, and streams the decoded
 * bytes through emit(), one char at a time (same contract the old GPT backend
 * used). Returns the number of new tokens generated, or -1 if no brain is ready.
 *
 * Every token fed to the engine is reduced into [0, vocab) first, so a
 * tokenizer whose vocab is larger than the model's (e.g. the real Qwen table in
 * front of the tiny test brain) can never index past the embedding table. */
int model_rt_generate(const char *prompt, uint32_t max_new, void (*emit)(char));

#endif /* MODEL_RT_H */
