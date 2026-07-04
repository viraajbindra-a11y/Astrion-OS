/* Host harness: compile the kernel's gpt.c with stubbed deps and greedily
 * generate, so we can diff against a numpy reference and prove the C forward
 * pass (weight layout + math) matches the trained model. */
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include "heap.h"   /* ksize_t */

void *kmalloc(ksize_t n)              { return malloc(n); }
void *kcalloc(ksize_t a, ksize_t b)   { return calloc(a, b); }
void *krealloc(void *p, ksize_t n)    { return realloc(p, n); }
void  kfree(void *p)                  { free(p); }
uint64_t pit_elapsed_ms(void)         { return 0; }
void task_yield(void)                 {}

#define GPT_HOST_TEST
#include "gpt.c"

int main(void) {
    gpt_init();
    gpt_test_reset();
    int t = 0;
    for (int i = 0; i < GPT_VOCAB; i++) if (gpt_vocab[i] == '\n') t = i;
    for (int n = 0; n < 60; n++) {
        gpt_test_step(t);
        t = gpt_test_argmax();
        putchar(gpt_vocab[t] == '\n' ? '#' : gpt_vocab[t]);
    }
    putchar('\n');
    return 0;
}
