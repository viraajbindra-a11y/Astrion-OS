#!/usr/bin/env python3
"""
train.py — train a tiny language model FROM SCRATCH.

One file. No magic. It builds a small transformer (the same *shape* as the model
your Astrion kernel runs: RMSNorm + RoPE + SwiGLU), feeds it text, and teaches it
to predict the next character. As it learns, it prints samples so you can WATCH
it go from noise -> gibberish -> real words -> sentences.

Run it with no arguments and it will:
  1. download a small text file (tiny-shakespeare, ~1 MB) if you don't have one,
  2. build a character tokenizer from that text,
  3. train, printing the loss and a sample every so often,
  4. save a checkpoint you can generate from later with  python sample.py

Point it at your own text with:   python train.py --data data/stories.txt

Read the README first — it explains every number this prints.
"""

import argparse, math, os, time, urllib.request
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.utils.checkpoint

# ----------------------------------------------------------------------------
# CONFIG — the whole model is described by these few numbers. Change them here.
# Defaults are tuned to train fast and look good on an RTX 5080 (16 GB).
# ----------------------------------------------------------------------------
CFG = dict(
    # --- model shape (this is what makes it "5-6 million parameters") ---
    dim        = 256,   # width of the model — size of each token's vector
    n_layer    = 6,     # how many transformer blocks stacked on top of each other
    n_head     = 8,     # attention heads (dim must divide evenly by this)
    ffn_dim    = 768,   # width of the MLP inside each block (usually ~3x dim)
    block_size = 256,   # context length: how many chars it sees at once
    rope_theta = 10000.0,  # RoPE base frequency (leave this alone)
    rms_eps    = 1e-5,     # tiny number so we never divide by zero in RMSNorm

    # --- training ---
    batch_size = 64,    # how many chunks of text we learn from at once
    max_iters  = 5000,  # total training steps
    eval_every = 250,   # every N steps: measure val loss + print a sample
    lr         = 3e-4,  # learning rate — how big a step we take each update
    warmup     = 100,   # steps to ramp LR up from 0 (keeps early training stable)
    weight_decay = 0.1, # gentle pull toward smaller weights (fights overfitting)
    grad_clip  = 1.0,   # clip huge gradients so one bad batch can't blow up
    seed       = 1337,
)


# ============================================================================
# 1. THE MODEL
# Read top to bottom. Each class is a small idea; the GPT class stacks them.
# ============================================================================

class RMSNorm(nn.Module):
    """Keeps each token's vector at a sane size before we do math on it.

    Older models used LayerNorm; modern ones (Llama, Qwen, and YOUR kernel) use
    RMSNorm: just divide by the root-mean-square, then scale. Simpler, faster,
    works as well. No mean-subtraction, no bias — that's the whole difference."""
    def __init__(self, dim, eps):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))  # learned per-feature scale

    def forward(self, x):
        dt = x.dtype
        x = x.float()                                  # do the norm in float32
        x = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)
        return x.to(dt) * self.weight


def build_rope(block_size, head_dim, theta, device):
    """Precompute the cos/sin tables RoPE uses to encode position.

    Instead of a lookup table of 'position vectors', RoPE *rotates* each pair of
    numbers in a head by an angle that grows with position. Nearby positions get
    similar rotations, far ones get different ones — so attention can tell where
    each token is. It generalizes better than a lookup table, and it's what your
    kernel's ref_forward.py does (adjacent-pair convention: (0,1),(2,3),...)."""
    i = torch.arange(0, head_dim, 2, device=device).float()   # 0,2,4,...
    freqs = theta ** (-i / head_dim)                          # one freq per pair
    pos = torch.arange(block_size, device=device).float()
    ang = torch.outer(pos, freqs)                             # (T, head_dim/2)
    return torch.cos(ang), torch.sin(ang)


def apply_rope(x, cos, sin):
    """Rotate the even/odd pairs of every head vector by the position angle.
    x is (batch, heads, time, head_dim)."""
    cos = cos[None, None, :x.size(2), :].to(x.dtype)
    sin = sin[None, None, :x.size(2), :].to(x.dtype)
    x_even, x_odd = x[..., 0::2], x[..., 1::2]
    out = torch.empty_like(x)
    out[..., 0::2] = x_even * cos - x_odd * sin
    out[..., 1::2] = x_even * sin + x_odd * cos
    return out


class Attention(nn.Module):
    """Lets each token look back at earlier tokens and pull in what it needs.
    'Causal' = it can only look BACKWARD, never at the future (that would be
    cheating, since predicting the future is the whole job).

    Supports grouped-query attention (GQA): if cfg["n_kv_head"] is smaller than
    n_head, several query heads SHARE one key/value head. That shrinks the k/v
    tables — cheaper, and much smaller KV-cache when the model later runs inside
    Astrion. Leave n_kv_head unset (or equal to n_head) and it's plain attention,
    exactly as before. Your kernel oracle already knows how to read this."""
    def __init__(self, cfg):
        super().__init__()
        self.n_head = cfg["n_head"]
        self.n_kv = cfg.get("n_kv_head", cfg["n_head"])   # default = normal MHA
        assert self.n_head % self.n_kv == 0, "n_head must be a multiple of n_kv_head"
        self.head_dim = cfg["dim"] // cfg["n_head"]
        d = cfg["dim"]
        self.wq = nn.Linear(d, self.n_head * self.head_dim, bias=False)  # questions
        self.wk = nn.Linear(d, self.n_kv   * self.head_dim, bias=False)  # keys (fewer)
        self.wv = nn.Linear(d, self.n_kv   * self.head_dim, bias=False)  # values (fewer)
        self.wo = nn.Linear(self.n_head * self.head_dim, d, bias=False)  # mix heads back
        self.qk_norm = None
        if cfg.get("qk_norm", False):    # optional: RMSNorm on q & k (steadier at scale)
            self.qk_norm = RMSNorm(self.head_dim, cfg["rms_eps"])

    def forward(self, x, cos, sin):
        B, T, C = x.shape
        q = self.wq(x).view(B, T, self.n_head, self.head_dim).transpose(1, 2)
        k = self.wk(x).view(B, T, self.n_kv,   self.head_dim).transpose(1, 2)
        v = self.wv(x).view(B, T, self.n_kv,   self.head_dim).transpose(1, 2)
        if self.qk_norm is not None:
            q, k = self.qk_norm(q), self.qk_norm(k)
        q = apply_rope(q, cos, sin)
        k = apply_rope(k, cos, sin)
        if self.n_kv != self.n_head:            # GQA: fan each kv head out to its group
            rep = self.n_head // self.n_kv
            k = k.repeat_interleave(rep, dim=1)
            v = v.repeat_interleave(rep, dim=1)
        # This one line IS attention (softmax of q·k, weighting v). PyTorch's
        # built-in is the fast "flash attention" kernel; is_causal adds the mask.
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        y = y.transpose(1, 2).contiguous().view(B, T, self.n_head * self.head_dim)
        return self.wo(y)


class SwiGLU(nn.Module):
    """The 'thinking' part of each block. Three matrices: a gate, an up, and a
    down. silu(gate(x)) acts like a soft on/off switch on up(x). Modern models
    and your kernel use this instead of the old 2-matrix GELU MLP."""
    def __init__(self, cfg):
        super().__init__()
        d, h = cfg["dim"], cfg["ffn_dim"]
        self.gate = nn.Linear(d, h, bias=False)
        self.up   = nn.Linear(d, h, bias=False)
        self.down = nn.Linear(h, d, bias=False)

    def forward(self, x):
        return self.down(F.silu(self.gate(x)) * self.up(x))


class Block(nn.Module):
    """One transformer layer: look around (attention), then think (MLP).
    The 'x = x + ...' is the residual connection — we ADD what each part learned
    rather than replacing x, so deep stacks stay trainable."""
    def __init__(self, cfg):
        super().__init__()
        self.ln1 = RMSNorm(cfg["dim"], cfg["rms_eps"])
        self.attn = Attention(cfg)
        self.ln2 = RMSNorm(cfg["dim"], cfg["rms_eps"])
        self.mlp = SwiGLU(cfg)

    def forward(self, x, cos, sin):
        x = x + self.attn(self.ln1(x), cos, sin)
        x = x + self.mlp(self.ln2(x))
        return x


class GPT(nn.Module):
    def __init__(self, cfg):
        super().__init__()
        self.cfg = cfg
        self.embed = nn.Embedding(cfg["vocab"], cfg["dim"])   # char id -> vector
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg["n_layer"])])
        self.final_ln = RMSNorm(cfg["dim"], cfg["rms_eps"])
        self.lm_head = nn.Linear(cfg["dim"], cfg["vocab"], bias=False)  # vector -> next-char scores
        self.embed.weight = self.lm_head.weight   # tie input & output (saves params, helps)
        cos, sin = build_rope(cfg["block_size"], cfg["dim"] // cfg["n_head"],
                              cfg["rope_theta"], "cpu")
        self.register_buffer("cos", cos, persistent=False)
        self.register_buffer("sin", sin, persistent=False)
        self.apply(self._init)

    def _init(self, m):
        if isinstance(m, nn.Linear):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)
        elif isinstance(m, nn.Embedding):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)

    def forward(self, idx, targets=None):
        x = self.embed(idx)
        # gradient checkpointing (optional, cfg["grad_checkpoint"]): during
        # training, don't keep each block's inner activations in memory — recompute
        # them in the backward pass instead. Trades a little extra compute for a lot
        # less VRAM, which is what lets a 341M model fit on a 16GB card.
        use_ckpt = self.training and self.cfg.get("grad_checkpoint", False)
        for b in self.blocks:
            if use_ckpt:
                x = torch.utils.checkpoint.checkpoint(b, x, self.cos, self.sin,
                                                      use_reentrant=False)
            else:
                x = b(x, self.cos, self.sin)
        x = self.final_ln(x)
        logits = self.lm_head(x)
        loss = None
        if targets is not None:
            # cross-entropy = "how surprised was the model by the true next char"
            loss = F.cross_entropy(logits.view(-1, logits.size(-1)),
                                   targets.view(-1))
        return logits, loss

    @torch.no_grad()
    def generate(self, idx, max_new_tokens, temperature=0.8, top_k=40):
        for _ in range(max_new_tokens):
            idx_cond = idx[:, -self.cfg["block_size"]:]      # keep last block_size chars
            logits, _ = self(idx_cond)
            logits = logits[:, -1, :] / temperature          # look at the last position
            if top_k:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = -float("inf")  # only keep top-k choices
            probs = F.softmax(logits, dim=-1)
            nxt = torch.multinomial(probs, num_samples=1)    # roll the dice
            idx = torch.cat([idx, nxt], dim=1)
        return idx


# ============================================================================
# 2. DATA — a character tokenizer. Simplest possible: every unique character
# becomes a number. No external tokenizer library needed.
# ============================================================================

TINY_SHAKESPEARE_URL = ("https://raw.githubusercontent.com/karpathy/"
                        "char-rnn/master/data/tinyshakespeare/input.txt")

def get_data(path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        print(f"no data at {path} — downloading tiny-shakespeare...")
        try:
            urllib.request.urlretrieve(TINY_SHAKESPEARE_URL, path)
            print("  done.")
        except Exception as e:
            raise SystemExit(f"download failed ({e}). Put a .txt file at {path} "
                             f"and pass it with --data, then rerun.")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/input.txt", help="path to a .txt file")
    ap.add_argument("--out", default="checkpoint.pt", help="where to save the model")
    ap.add_argument("--compile", action="store_true", help="torch.compile (faster, slow first step)")
    args = ap.parse_args()

    cfg = dict(CFG)
    torch.manual_seed(cfg["seed"])

    # Pick the fastest device available. cuda = your 5080. mps = Apple GPU (for a
    # quick smoke-test on the Mac). cpu = works but slow.
    if torch.cuda.is_available():
        device, use_bf16 = "cuda", True
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    elif torch.backends.mps.is_available():
        device, use_bf16 = "mps", False
    else:
        device, use_bf16 = "cpu", False
    print(f"device: {device}")

    # --- build the tokenizer from the data ---
    text = get_data(args.data)
    chars = sorted(set(text))
    cfg["vocab"] = len(chars)
    stoi = {c: i for i, c in enumerate(chars)}
    itos = {i: c for i, c in enumerate(chars)}
    data = torch.tensor([stoi[c] for c in text], dtype=torch.long)
    n = int(0.9 * len(data))
    train_data, val_data = data[:n], data[n:]      # last 10% is held out for honesty
    print(f"data: {len(text):,} characters, vocab {cfg['vocab']} unique chars")
    print(f"      {len(train_data):,} train / {len(val_data):,} val")

    def get_batch(split):
        d = train_data if split == "train" else val_data
        ix = torch.randint(len(d) - cfg["block_size"] - 1, (cfg["batch_size"],))
        x = torch.stack([d[i:i + cfg["block_size"]] for i in ix])
        y = torch.stack([d[i + 1:i + 1 + cfg["block_size"]] for i in ix])  # y = x shifted by 1
        return x.to(device), y.to(device)

    # --- build the model ---
    model = GPT(cfg).to(device)
    nparams = sum(p.numel() for p in model.parameters())
    print(f"model: {nparams/1e6:.2f} million parameters "
          f"({cfg['n_layer']} layers, dim {cfg['dim']}, {cfg['n_head']} heads)")
    if args.compile:
        model = torch.compile(model)

    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"],
                            betas=(0.9, 0.95), weight_decay=cfg["weight_decay"])

    def lr_at(step):                                # warmup then cosine decay
        if step < cfg["warmup"]:
            return cfg["lr"] * (step + 1) / cfg["warmup"]
        r = (step - cfg["warmup"]) / max(1, cfg["max_iters"] - cfg["warmup"])
        return cfg["lr"] * 0.5 * (1 + math.cos(math.pi * r))

    @torch.no_grad()
    def estimate_loss():
        model.eval()
        out = {}
        for split in ("train", "val"):
            losses = torch.zeros(20)
            for k in range(20):
                x, y = get_batch(split)
                with torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=use_bf16):
                    _, loss = model(x, y)
                losses[k] = loss.item()
            out[split] = losses.mean().item()
        model.train()
        return out

    def sample(n_chars=300):
        model.eval()
        start = torch.tensor([[stoi["\n"] if "\n" in stoi else 0]], device=device)
        ids = model.generate(start, n_chars)[0].tolist()
        model.train()
        return "".join(itos[i] for i in ids)

    # --- the training loop ---
    print("\ntraining — watch the val loss fall and the samples get better:\n")
    t0 = time.time()
    for step in range(cfg["max_iters"] + 1):
        for g in opt.param_groups:
            g["lr"] = lr_at(step)

        if step % cfg["eval_every"] == 0:
            L = estimate_loss()
            dt = time.time() - t0
            print(f"step {step:>5} | train {L['train']:.3f} | val {L['val']:.3f} "
                  f"| lr {lr_at(step):.1e} | {dt:.0f}s")
            print("   --- sample ---")
            print("   " + sample().replace("\n", "\n   "))
            print("   ---------------\n")
            # save a checkpoint every eval so you never lose progress
            torch.save({"model": (model._orig_mod if hasattr(model, "_orig_mod") else model).state_dict(),
                        "cfg": cfg, "stoi": stoi, "itos": itos}, args.out)

        x, y = get_batch("train")
        with torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=use_bf16):
            _, loss = model(x, y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), cfg["grad_clip"])
        opt.step()

    print(f"done in {time.time()-t0:.0f}s. saved to {args.out}")
    print(f"generate more with:  python sample.py --ckpt {args.out}")


if __name__ == "__main__":
    main()
