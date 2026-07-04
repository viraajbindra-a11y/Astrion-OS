#!/usr/bin/env python3
"""Tiny char-level GPT in pure numpy (manual backprop) for Astrion's on-device
assistant. Single-head attention + ReLU MLP + LayerNorm so the forward pass
ports cleanly to freestanding integer/float C in the kernel.

  python3 train_gpt.py --gradcheck        # verify backprop (numeric vs analytic)
  python3 train_gpt.py --iters 12000      # train + sample + export gpt_weights.h
"""
import sys, math, time, json
import numpy as np

# ---- config ----
BLOCK   = 64      # context length
N_EMBD  = 64
N_LAYER = 4
N_HEAD  = 1       # single head: simplest correct backprop, cleanest kernel port
LR      = 3e-3
BATCH   = 32
SEED    = 1337

rng = np.random.default_rng(SEED)

def load_corpus(path="corpus.txt"):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    chars = sorted(set(text))
    stoi = {c: i for i, c in enumerate(chars)}
    itos = {i: c for i, c in enumerate(chars)}
    data = np.array([stoi[c] for c in text], dtype=np.int32)
    return text, chars, stoi, itos, data

# ---- params ----
def init_params(vocab):
    def randn(*s, scale):
        return (rng.standard_normal(s) * scale).astype(np.float64)
    P = {}
    P["wte"] = randn(vocab, N_EMBD, scale=0.02)
    P["wpe"] = randn(BLOCK, N_EMBD, scale=0.02)
    for l in range(N_LAYER):
        P[f"ln1_g{l}"] = np.ones(N_EMBD); P[f"ln1_b{l}"] = np.zeros(N_EMBD)
        P[f"qkv_w{l}"] = randn(N_EMBD, 3 * N_EMBD, scale=0.02)
        P[f"qkv_b{l}"] = np.zeros(3 * N_EMBD)
        P[f"proj_w{l}"] = randn(N_EMBD, N_EMBD, scale=0.02)
        P[f"proj_b{l}"] = np.zeros(N_EMBD)
        P[f"ln2_g{l}"] = np.ones(N_EMBD); P[f"ln2_b{l}"] = np.zeros(N_EMBD)
        P[f"fc_w{l}"] = randn(N_EMBD, 4 * N_EMBD, scale=0.02)
        P[f"fc_b{l}"] = np.zeros(4 * N_EMBD)
        P[f"mproj_w{l}"] = randn(4 * N_EMBD, N_EMBD, scale=0.02)
        P[f"mproj_b{l}"] = np.zeros(N_EMBD)
    P["lnf_g"] = np.ones(N_EMBD); P["lnf_b"] = np.zeros(N_EMBD)
    P["head_w"] = randn(N_EMBD, vocab, scale=0.02)
    P["head_b"] = np.zeros(vocab)
    return P

# ---- layer primitives (with cache for backward) ----
def layernorm(x, g, b, eps=1e-5):
    mu = x.mean(-1, keepdims=True)
    xc = x - mu
    var = (xc * xc).mean(-1, keepdims=True)
    inv = 1.0 / np.sqrt(var + eps)
    xn = xc * inv
    out = xn * g + b
    return out, (xn, inv, g)

def layernorm_bw(dout, cache):
    xn, inv, g = cache
    C = xn.shape[-1]
    dxn = dout * g
    dg = (dout * xn).reshape(-1, C).sum(0)
    db = dout.reshape(-1, C).sum(0)
    dx = inv / C * (C * dxn - dxn.sum(-1, keepdims=True) - xn * (dxn * xn).sum(-1, keepdims=True))
    return dx, dg, db

def softmax_rows(x):
    m = x.max(-1, keepdims=True)
    e = np.exp(x - m)
    return e / e.sum(-1, keepdims=True)

# causal mask (T,T): True where allowed (j<=i)
def causal_mask(T):
    return np.tril(np.ones((T, T), dtype=bool))

def attention(x, P, l, mask):
    # x: (B,T,C)
    B, T, C = x.shape
    qkv = x @ P[f"qkv_w{l}"] + P[f"qkv_b{l}"]      # (B,T,3C)
    q, k, v = qkv[..., :C], qkv[..., C:2*C], qkv[..., 2*C:]
    scale = 1.0 / math.sqrt(C)
    att = (q @ k.transpose(0, 2, 1)) * scale       # (B,T,T)
    att = np.where(mask[:T, :T], att, -1e9)
    p = softmax_rows(att)                           # (B,T,T)
    y = p @ v                                       # (B,T,C)
    out = y @ P[f"proj_w{l}"] + P[f"proj_b{l}"]
    cache = (x, q, k, v, p, y, scale, l)
    return out, cache

def attention_bw(dout, cache, P, grads):
    x, q, k, v, p, y, scale, l = cache
    B, T, C = x.shape
    # out = y @ proj_w + proj_b
    grads[f"proj_w{l}"] += y.reshape(-1, C).T @ dout.reshape(-1, C)
    grads[f"proj_b{l}"] += dout.reshape(-1, C).sum(0)
    dy = dout @ P[f"proj_w{l}"].T                   # (B,T,C)
    # y = p @ v
    dp = dy @ v.transpose(0, 2, 1)                  # (B,T,T)
    dv = p.transpose(0, 2, 1) @ dy                  # (B,T,C)
    # softmax backward (rows)
    ds = p * (dp - (dp * p).sum(-1, keepdims=True)) # (B,T,T)
    # att = (q @ k^T) * scale  (masked positions had grad already ~0 via softmax)
    dq = (ds @ k) * scale                           # (B,T,C)
    dk = (ds.transpose(0, 2, 1) @ q) * scale        # (B,T,C)
    dqkv = np.concatenate([dq, dk, dv], axis=-1)    # (B,T,3C)
    grads[f"qkv_w{l}"] += x.reshape(-1, C).T @ dqkv.reshape(-1, 3 * C)
    grads[f"qkv_b{l}"] += dqkv.reshape(-1, 3 * C).sum(0)
    dx = dqkv @ P[f"qkv_w{l}"].T                    # (B,T,C)
    return dx

def forward(P, idx, targets=None):
    B, T = idx.shape
    C = N_EMBD
    mask = causal_mask(BLOCK)
    x = P["wte"][idx] + P["wpe"][:T]                # (B,T,C)
    caches = []
    for l in range(N_LAYER):
        a, lc1 = layernorm(x, P[f"ln1_g{l}"], P[f"ln1_b{l}"])
        att, ac = attention(a, P, l, mask)
        x = x + att
        h, lc2 = layernorm(x, P[f"ln2_g{l}"], P[f"ln2_b{l}"])
        fc = h @ P[f"fc_w{l}"] + P[f"fc_b{l}"]      # (B,T,4C)
        relu = np.maximum(fc, 0.0)
        m = relu @ P[f"mproj_w{l}"] + P[f"mproj_b{l}"]
        x = x + m
        caches.append((lc1, ac, lc2, h, fc, relu, l))
    xf, lcf = layernorm(x, P["lnf_g"], P["lnf_b"])
    logits = xf @ P["head_w"] + P["head_b"]         # (B,T,V)
    if targets is None:
        return logits, None, None
    V = logits.shape[-1]
    pr = softmax_rows(logits)
    ll = -np.log(pr.reshape(-1, V)[np.arange(B * T), targets.reshape(-1)] + 1e-12)
    loss = ll.mean()
    cache = (idx, caches, lcf, xf, pr, targets)
    return logits, loss, cache

def backward(P, cache):
    idx, caches, lcf, xf, pr, targets = cache
    B, T = idx.shape
    C = N_EMBD
    V = pr.shape[-1]
    grads = {k: np.zeros_like(v) for k, v in P.items()}
    # cross-entropy + softmax backward
    dlogits = pr.copy()
    dlogits.reshape(-1, V)[np.arange(B * T), targets.reshape(-1)] -= 1.0
    dlogits /= (B * T)
    grads["head_w"] += xf.reshape(-1, C).T @ dlogits.reshape(-1, V)
    grads["head_b"] += dlogits.reshape(-1, V).sum(0)
    dxf = dlogits @ P["head_w"].T
    dx, dg, db = layernorm_bw(dxf, lcf)
    grads["lnf_g"] += dg; grads["lnf_b"] += db
    for l in reversed(range(N_LAYER)):
        lc1, ac, lc2, h, fc, relu, _ = caches[l]
        # MLP residual: x = x + m
        dm = dx
        grads[f"mproj_w{l}"] += relu.reshape(-1, 4 * C).T @ dm.reshape(-1, C)
        grads[f"mproj_b{l}"] += dm.reshape(-1, C).sum(0)
        drelu = dm @ P[f"mproj_w{l}"].T
        dfc = drelu * (fc > 0)
        grads[f"fc_w{l}"] += h.reshape(-1, C).T @ dfc.reshape(-1, 4 * C)
        grads[f"fc_b{l}"] += dfc.reshape(-1, 4 * C).sum(0)
        dh = dfc @ P[f"fc_w{l}"].T
        dln2, dg2, db2 = layernorm_bw(dh, lc2)
        grads[f"ln2_g{l}"] += dg2; grads[f"ln2_b{l}"] += db2
        dx = dx + dln2
        # Attention residual: x = x + att
        datt = dx
        dln1_in = attention_bw(datt, ac, P, grads)
        dln1, dg1, db1 = layernorm_bw(dln1_in, lc1)
        grads[f"ln1_g{l}"] += dg1; grads[f"ln1_b{l}"] += db1
        dx = dx + dln1
    # embeddings
    np.add.at(grads["wte"], idx, dx)
    grads["wpe"][:T] += dx.reshape(-1, C).reshape(B, T, C).sum(0)
    return grads

# ---- gradient check ----
def gradcheck():
    text, chars, stoi, itos, data = load_corpus()
    global BLOCK, N_EMBD, N_LAYER
    BLOCK, N_EMBD, N_LAYER = 8, 16, 2
    V = len(chars)
    P = init_params(V)
    B, T = 2, 6
    idx = rng.integers(0, V, (B, T)).astype(np.int32)
    tgt = rng.integers(0, V, (B, T)).astype(np.int32)
    _, loss, cache = forward(P, idx, tgt)
    grads = backward(P, cache)
    worst = 0.0
    for name in ["head_w", "qkv_w0", "proj_w1", "fc_w0", "ln1_g0", "wte", "wpe", "lnf_g", "head_b"]:
        arr = P[name]
        flat = arr.reshape(-1)
        gflat = grads[name].reshape(-1)
        checks = min(6, flat.size)
        idxs = rng.integers(0, flat.size, checks)
        for i in idxs:
            eps = 1e-5
            old = flat[i]
            flat[i] = old + eps; _, lp, _ = forward(P, idx, tgt)
            flat[i] = old - eps; _, lm, _ = forward(P, idx, tgt)
            flat[i] = old
            num = (lp - lm) / (2 * eps)
            ana = gflat[i]
            rel = abs(num - ana) / max(1e-8, abs(num) + abs(ana))
            worst = max(worst, rel)
        print(f"  {name:10s} max-rel-so-far {worst:.2e}")
    print(f"WORST relative error: {worst:.2e}  ->  {'PASS' if worst < 1e-4 else 'FAIL'}")
    return worst < 1e-4

# ---- Adam ----
class Adam:
    def __init__(self, P, lr):
        self.lr = lr; self.b1, self.b2, self.eps = 0.9, 0.999, 1e-8
        self.m = {k: np.zeros_like(v) for k, v in P.items()}
        self.v = {k: np.zeros_like(v) for k, v in P.items()}
        self.t = 0
    def step(self, P, grads):
        self.t += 1
        for k in P:
            g = grads[k]
            self.m[k] = self.b1 * self.m[k] + (1 - self.b1) * g
            self.v[k] = self.b2 * self.v[k] + (1 - self.b2) * (g * g)
            mh = self.m[k] / (1 - self.b1 ** self.t)
            vh = self.v[k] / (1 - self.b2 ** self.t)
            P[k] -= self.lr * mh / (np.sqrt(vh) + self.eps)

def get_batch(data, B, T):
    ix = rng.integers(0, len(data) - T - 1, B)
    x = np.stack([data[i:i+T] for i in ix]).astype(np.int32)
    y = np.stack([data[i+1:i+T+1] for i in ix]).astype(np.int32)
    return x, y

def sample(P, itos, stoi, prompt, n=240, temp=0.8):
    ids = [stoi.get(c, 0) for c in prompt] or [0]
    out = list(ids)
    for _ in range(n):
        ctx = np.array([out[-BLOCK:]], dtype=np.int32)
        logits, _, _ = forward(P, ctx)
        lg = logits[0, -1] / temp
        p = np.exp(lg - lg.max()); p /= p.sum()
        nxt = int(rng.choice(len(p), p=p))
        out.append(nxt)
    return "".join(itos[i] for i in out)

def export_header(P, chars, path="gpt_weights.h"):
    itos = "".join(chars)
    def arr(name, a):
        flat = a.reshape(-1).astype(np.float32)
        s = ", ".join(f"{x:.6g}f" for x in flat)
        return f"static const float {name}[{flat.size}] = {{ {s} }};\n"
    with open(path, "w") as f:
        f.write("/* Auto-generated by train_gpt.py — Astrion on-device char GPT. */\n")
        f.write("#ifndef ASTRION_GPT_WEIGHTS_H\n#define ASTRION_GPT_WEIGHTS_H\n\n")
        f.write(f"#define GPT_VOCAB   {len(chars)}\n#define GPT_BLOCK   {BLOCK}\n")
        f.write(f"#define GPT_NEMBD   {N_EMBD}\n#define GPT_NLAYER  {N_LAYER}\n\n")
        esc = itos.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")
        f.write(f'static const char gpt_vocab[GPT_VOCAB + 1] = "{esc}";\n\n')
        for k, v in P.items():
            f.write(arr("w_" + k, v))
        f.write("\n#endif\n")
    print(f"exported {path}: {sum(v.size for v in P.values())} params")

def main():
    args = sys.argv[1:]
    if "--gradcheck" in args:
        ok = gradcheck(); sys.exit(0 if ok else 1)
    iters = 12000
    if "--iters" in args: iters = int(args[args.index("--iters") + 1])
    text, chars, stoi, itos, data = load_corpus()
    print(f"corpus {len(text)} chars, vocab {len(chars)}: {''.join(chars)!r}")
    n = int(0.9 * len(data)); train, val = data[:n], data[n:]
    P = init_params(len(chars))
    opt = Adam(P, LR)
    t0 = time.time()
    for it in range(1, iters + 1):
        x, y = get_batch(train, BATCH, BLOCK)
        _, loss, cache = forward(P, x, y)
        grads = backward(P, cache)
        # clip
        for k in grads:
            np.clip(grads[k], -1.0, 1.0, out=grads[k])
        opt.step(P, grads)
        if it % 500 == 0 or it == 1:
            xv, yv = get_batch(val, BATCH, BLOCK)
            _, vl, _ = forward(P, xv, yv)
            dt = time.time() - t0
            print(f"iter {it:6d}  train {loss:.3f}  val {vl:.3f}  {dt:.0f}s", flush=True)
        if it % 3000 == 0:
            print("  sample:", repr(sample(P, itos, stoi, "\n", 160)), flush=True)
    np.savez("gpt_ckpt.npz", **P, _chars="".join(chars))
    export_header(P, chars)
    print("\n=== final samples ===")
    for pr in ["\n", "ROMEO:", "To be"]:
        print(f"--- prompt {pr!r} ---")
        print(sample(P, itos, stoi, pr, 220))

if __name__ == "__main__":
    main()
