# Astrion on-device GPT — training + export

The Assistant window runs a small char-level transformer **inside the kernel**
(`src/gpt.c`), with weights embedded in `src/gpt_weights.h`. No GPU, no
network, no libc — float math lowers to libgcc soft-float (the kernel bans
SSE), and a KV-cache keeps per-token cost low enough to generate live.

## Retrain / regenerate the weights

```bash
cd kernel/tools/gpt
curl -sSL https://raw.githubusercontent.com/karpathy/char-rnn/master/data/tinyshakespeare/input.txt -o corpus.txt
python3 train_gpt.py --gradcheck        # verify backprop (numeric vs analytic)
python3 train_gpt.py --iters 12000      # trains ~8 min on CPU, writes gpt_ckpt.npz
python3 reexport.py                      # gpt_ckpt.npz -> gpt_weights.h (+ pointer tables)
cp gpt_weights.h ../../src/gpt_weights.h
```

Config (see `train_gpt.py`): block 64, n_embd 64, 4 layers, single-head,
ReLU MLP, LayerNorm. ~212K params, ~830 KB as float32.

## Validate the kernel forward pass on the host

`host_test.c` compiles the real `src/gpt.c` with stubbed kernel deps and
greedily decodes; `greedy_ref.py` does the same in numpy. They must match
char-for-char:

```bash
clang -O2 -I../../src -I../../include host_test.c -o host_test && ./host_test
python3 greedy_ref.py
```
