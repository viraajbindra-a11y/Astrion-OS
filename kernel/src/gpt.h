/*
 * Astrion v2.0 — on-device char-level GPT inference (see gpt.c).
 *
 * A small transformer (weights trained offline, embedded in gpt_weights.h)
 * that runs entirely in the kernel: no SSE (soft-float via libgcc), no
 * network, no libc. A KV-cache keeps per-token cost low enough to generate
 * live. This is the brain behind the Assistant window.
 */
#ifndef ASTRION_GPT_H
#define ASTRION_GPT_H

void gpt_init(void);   /* allocate the KV-cache; call once at boot */

/* Continue `prompt`, emitting up to max_out generated chars one at a time via
 * emit(). Yields the CPU between tokens so the clock keeps ticking. */
void gpt_generate(const char *prompt, int max_out, void (*emit)(char c));

#endif
