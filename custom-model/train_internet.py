#!/usr/bin/env python3
"""
train_internet.py — the same model as train.py, but trained on REAL web text
(FineWeb-Edu) with a real word-piece tokenizer, at GPT-2 scale.

Two things change from train.py, and only two:
  1. TOKENIZER: instead of one-character-at-a-time, we use tiktoken's GPT-2
     byte-pair tokenizer (50257 pieces). "the" is one token, not three. This
     lets the model spend its brainpower on meaning instead of spelling.
  2. DATA: the internet doesn't fit in RAM. So prepare_fineweb.py tokenizes it
     once into a flat file of uint16 numbers, and here we memory-map that file
     (np.memmap) — the OS pages in only the little windows we're training on.

Everything else — the RMSNorm/RoPE/SwiGLU model — is imported unchanged from
train.py, so it stays the exact same shape your Astrion kernel expects.

    python prepare_fineweb.py --mb 500          # make data/fineweb.bin first
    python train_internet.py                     # train (auto-resumes)
    python train_internet.py --sample_only       # just generate from checkpoint

It CHECKPOINTS every eval and RESUMES automatically — this is a long run, so a
reboot or Ctrl-C never costs you more than a few minutes.
"""
import argparse, math, os, time
import numpy as np
import torch
import torch.nn.functional as F
from train import GPT   # reuse the identical model (RMSNorm + RoPE + SwiGLU)

# ----------------------------------------------------------------------------
# CONFIG. These are the GPT-2-small ("124M") numbers; the tiers and any tuning
# from the verified research get folded in here. block/vocab must match how the
# .bin was tokenized (tiktoken gpt2 -> vocab 50257, so we round up to 50304 for
# speed — a multiple of 64 makes the GPU matmultiplies faster; the extra unused
# rows never get real tokens so they cost nothing but a little memory).
# ----------------------------------------------------------------------------
CFG = dict(
    dim        = 768,
    n_layer    = 12,
    n_head     = 12,
    ffn_dim    = 2048,       # ~ (8/3)*dim rounded to a multiple of 64 for SwiGLU
    block_size = 1024,
    vocab      = 50304,      # 50257 real gpt2 tokens, padded to a multiple of 64
    rope_theta = 10000.0,
    rms_eps    = 1e-5,

    # --- training ---
    # These are TIER A: "see it work on real web text tonight" (~300M tokens,
    # ~2.5-3 hours on your 5080). Expected val loss ~4.0-4.3 — real English shape,
    # still clearly climbing. A working model, not a finished one.
    #
    # TIER B: "a real GPT-2 reproduction over a weekend" — flip these three:
    #     max_iters = 19073   warmup = 715   eval_every = 250
    #   trains on the full 10B-token sample (~3.5 days), val loss ~3.29, which
    #   actually beats the original GPT-2-124M. See INTERNET.md for the full plan.
    batch_size      = 16,        # sequences per micro-step (lower this if OOM)
    grad_accum      = 32,        # micro-steps per real update -> big effective batch
    #   effective tokens/update = batch_size * block_size * grad_accum
    #   16 * 1024 * 32 = 524,288  (~0.5M tokens, the exact GPT-2 batch size)
    max_iters       = 600,       # real updates (not micro-steps).  Tier B: 19073
    eval_every      = 100,       #                                  Tier B: 250
    lr              = 6e-4,      # peak LR
    min_lr          = 6e-5,      # cosine floor (= 0.1 * peak)
    warmup          = 60,        # LR ramp-up steps.                Tier B: 715
    weight_decay    = 0.1,
    grad_clip       = 1.0,
    seed            = 1337,
)


def get_tokenizer():
    try:
        import tiktoken
    except ImportError:
        raise SystemExit("need tiktoken:  pip install tiktoken")
    return tiktoken.get_encoding("gpt2")


def load_bin(path):
    if not os.path.exists(path):
        raise SystemExit(f"no token file at {path}. Make one first:\n"
                         f"    python prepare_fineweb.py --mb 500")
    # memory-map so we never load the whole corpus into RAM
    return np.memmap(path, dtype=np.uint16, mode="r")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/fineweb.bin")
    ap.add_argument("--val",  default="data/fineweb_val.bin")
    ap.add_argument("--out",  default="internet_ckpt.pt")
    ap.add_argument("--compile", action="store_true")
    ap.add_argument("--fresh", action="store_true", help="ignore any saved checkpoint")
    ap.add_argument("--sample_only", action="store_true")
    ap.add_argument("--prompt", default="\n")
    args = ap.parse_args()

    cfg = dict(CFG)
    torch.manual_seed(cfg["seed"])
    if torch.cuda.is_available():
        device, use_bf16 = "cuda", True
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    elif torch.backends.mps.is_available():
        device, use_bf16 = "mps", False
    else:
        device, use_bf16 = "cpu", False

    enc = get_tokenizer()
    model = GPT(cfg).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"],
                            betas=(0.9, 0.95), weight_decay=cfg["weight_decay"])

    # --- resume if a checkpoint exists ---
    start_step = 0
    if os.path.exists(args.out) and not args.fresh:
        ck = torch.load(args.out, map_location=device)
        model.load_state_dict(ck["model"])
        if "opt" in ck and not args.sample_only:
            opt.load_state_dict(ck["opt"])
        start_step = ck.get("step", 0)
        print(f"resumed from {args.out} at step {start_step}")

    nparams = sum(p.numel() for p in model.parameters())
    print(f"device {device} | {nparams/1e6:.1f}M params | vocab {cfg['vocab']} | "
          f"ctx {cfg['block_size']}")

    def generate(prompt, n=300, temp=0.8, top_k=200):
        model.eval()
        ids = enc.encode(prompt) or [enc.eot_token]
        idx = torch.tensor([ids], device=device)
        with torch.no_grad():
            out = model.generate(idx, n, temperature=temp, top_k=top_k)[0].tolist()
        model.train()
        # our vocab is padded to a multiple of 64 for GPU speed; those extra ids
        # aren't real tokens, so drop them before decoding (matters early on,
        # when the untrained model still picks them sometimes)
        out = [t for t in out if t < enc.n_vocab]
        return enc.decode(out)

    if args.sample_only:
        print(generate(args.prompt, n=400))
        return

    train_data = load_bin(args.data)
    val_data = load_bin(args.val) if os.path.exists(args.val) else train_data
    print(f"train tokens: {len(train_data):,} | val tokens: {len(val_data):,}")

    def get_batch(split):
        d = train_data if split == "train" else val_data
        ix = torch.randint(len(d) - cfg["block_size"] - 1, (cfg["batch_size"],))
        # copy out of the memmap into real tensors
        x = torch.stack([torch.from_numpy(d[i:i+cfg["block_size"]].astype(np.int64)) for i in ix])
        y = torch.stack([torch.from_numpy(d[i+1:i+1+cfg["block_size"]].astype(np.int64)) for i in ix])
        return x.to(device), y.to(device)

    def lr_at(step):
        if step < cfg["warmup"]:
            return cfg["lr"] * (step + 1) / cfg["warmup"]
        if step > cfg["max_iters"]:
            return cfg["min_lr"]
        r = (step - cfg["warmup"]) / max(1, cfg["max_iters"] - cfg["warmup"])
        coeff = 0.5 * (1 + math.cos(math.pi * r))
        return cfg["min_lr"] + coeff * (cfg["lr"] - cfg["min_lr"])

    @torch.no_grad()
    def eval_loss():
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

    if args.compile:
        model = torch.compile(model)

    eff_tokens = cfg["batch_size"] * cfg["block_size"] * cfg["grad_accum"]
    print(f"effective batch: {eff_tokens:,} tokens/update | {cfg['grad_accum']} micro-steps\n")

    t0 = time.time()
    model.train()
    for step in range(start_step, cfg["max_iters"] + 1):
        for g in opt.param_groups:
            g["lr"] = lr_at(step)

        if step % cfg["eval_every"] == 0:
            L = eval_loss()
            dt = time.time() - t0
            print(f"step {step:>6} | train {L['train']:.3f} | val {L['val']:.3f} "
                  f"| lr {lr_at(step):.1e} | {dt/60:.1f}m")
            print("   " + generate("\n", n=200).replace("\n", " ").strip()[:200])
            m = model._orig_mod if hasattr(model, "_orig_mod") else model
            torch.save({"model": m.state_dict(), "opt": opt.state_dict(),
                        "step": step, "cfg": cfg}, args.out)

        # gradient accumulation: sum grads over several micro-batches, then step
        opt.zero_grad(set_to_none=True)
        for micro in range(cfg["grad_accum"]):
            x, y = get_batch("train")
            with torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=use_bf16):
                _, loss = model(x, y)
                loss = loss / cfg["grad_accum"]
            loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), cfg["grad_clip"])
        opt.step()

    print(f"done in {(time.time()-t0)/60:.1f} min. saved {args.out}")


if __name__ == "__main__":
    main()
