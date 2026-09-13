/*
 * test_vocab_match.c — the tokenizer/brain vocab predicate, on the host.
 *
 * model_rt_init() refuses to enable generation when the installed tokenizer
 * can produce an id the brain has no embedding row for. Before that check
 * existed, the id %= vocab clamp in model_rt_generate() let a 151k-id Qwen
 * table drive the 48-row test brain: it ran, it produced tokens, and the
 * output was nonsense that nothing could tell apart from a broken model. The
 * boot-level proof is tools/vocab_test.py (real ISO, real serial line); this
 * gates the RULE so the boundary cannot drift:
 *
 *   tok_n == 0        no tokenizer, raw-byte fallback     -> usable
 *   tok_n <= vocab    every producible id has a row       -> usable
 *   tok_n >  vocab    some ids have no row                -> refused
 *
 * The <= is the load-bearing character. tiktoken gpt2 has 50257 ids and Ember
 * pads vocab to 50304; an == rule would refuse the real Ember, and a rule of
 * "vocab >= 256" or similar would let the Qwen/Ember mismatch through.
 *
 *   cc -std=c11 -Wall -Wextra -Werror -Iinclude -o build/test_vocab_match tests/test_vocab_match.c
 */
#include <stdio.h>
#include <stdint.h>
#include "model_rt.h"

static int failures;

static void expect(const char *what, uint32_t tok_n, uint32_t vocab, int want) {
    int got = model_rt_vocab_ok(tok_n, vocab);
    printf("  %-50s tok_n=%-7u vocab=%-7u -> %s%s\n", what, tok_n, vocab,
           got ? "usable " : "refused",
           got == want ? "" : "   <<< WRONG");
    if (got != want) failures++;
}

int main(void) {
    printf("vocab match: the rule is tok_n == 0 || tok_n <= vocab\n");
    expect("no tokenizer, raw bytes, test brain",          0,      48,     1);
    expect("no tokenizer, raw bytes, Ember",               0,      50304,  1);
    expect("gpt2 tiktoken (50257) -> Ember (50304)",        50257,  50304,  1);
    expect("exactly equal",                                50257,  50257,  1);
    expect("one id past the last row",                     49,     48,     0);
    expect("Qwen table (151643) -> 48-row test brain",      151643, 48,     0);
    expect("Qwen table (151643) -> Ember (50304)",          151643, 50304,  0);
    expect("gpt2 table (50257) -> 48-row test brain",       50257,  48,     0);
    expect("tiny 300-id table -> 512-row brain",            300,    512,    1);
    expect("tiny 300-id table -> 48-row brain",             300,    48,     0);
    printf("\nfailures  %d\n%s\n", failures, failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
