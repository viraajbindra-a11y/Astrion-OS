#!/usr/bin/env python3
"""
train_best.py — the best ~341M-parameter model a single RTX 5080 can train from
scratch in a weekend.

Same RMSNorm/RoPE/SwiGLU model as train.py (imported unchanged), but scaled up and
trained with every trick that actually helps on one GPU:
  * ~341M params: dim 1024, 24 layers, 16 query heads sharing 4 KV heads (GQA).
  * Muon optimizer on the hidden matrices + AdamW on embeddings/norms — the big
    sample-efficiency win.
  * QK-norm for stable training at this size.
  * Warmup-Stable-Decay learning-rate schedule.
  * Gradient checkpointing so it fits in 16GB, grad accumulation to a 0.5M-token
    batch, bf16, and torch.compile.

    python prepare_fineweb.py --mb 13500     # ~7B tokens (Chinchilla-optimal for 341M)
    python train_best.py --compile           # pretrain Ember: ~2-2.5 days on a 5080
    python finetune.py                       # then teach it to chat + know it's Ember
    python readiness.py                      # check it's ready; python chat.py to talk

This is step 1 of 3 (pretrain). It saves ember-base.pt and auto-resumes every eval,
so a multi-day run survives reboots. Read BEST.md and READY.md for the full path.
"""
import argparse, os, time
import numpy as np
import torch
import torch.nn.functional as F
from train import GPT
from muon import SingleDeviceMuon, split_muon_adamw_params

CFG = dict(
    # --- the ~341M model (same family train.py builds, just bigger + GQA) ---
    dim=1024, n_layer=24, n_head=16, n_kv_head=4,   # GQA 4:1 — 16 Q heads, 4 KV heads
    ffn_dim=3072, block_size=1024, vocab=50304,
    rope_theta=10000.0, rms_eps=1e-5,
    qk_norm=True,           # steadier training with Muon's high LR. (Kernel oracle
                            # updated to match — see ref_forward.py — so weights stay drop-in.)
    grad_checkpoint=True,   # recompute activations in backward -> fits micro-batch 8 on 16GB

    # --- batch: micro_batch * block_size * grad_accum = 8*1024*64 = 524,288 tokens/update ---
    micro_batch=8, grad_accum=64,
    total_steps=13500,      # 13500 * 0.5M = ~7.05B tokens
    # Warmup-Stable-Decay schedule: ramp up 2%, hold flat to 60%, then glide to 0.
    warmup=270, stable_until=8100,
    muon_lr=0.02,  muon_momentum=0.95, muon_wd=0.01,
    adamw_lr=3e-4, adamw_betas=(0.9, 0.95), adamw_wd=0.0,
    eval_every=250, grad_clip=1.0, seed=1337,
)


def wsd_mult(step, cfg):
    """Warmup-Stable-Decay: 0->1 over warmup, flat 1.0, then 1->0 over the tail."""
    if step < cfg["warmup"]:
        return (step + 1) / cfg["warmup"]
    if step < cfg["stable_until"]:
        return 1.0
    return max(0.0, (cfg["total_steps"] - step) / (cfg["total_steps"] - cfg["stable_until"]))


def load_bin(path):
    if not os.path.exists(path):
        raise SystemExit(f"no token file at {path}. Run:  python prepare_fineweb.py --mb 13500")
    return np.memmap(path, dtype=np.uint16, mode="r")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/fineweb.bin")
    ap.add_argument("--val",  default="data/fineweb_val.bin")
    ap.add_argument("--out",  default="ember-base.pt")
    ap.add_argument("--compile", action="store_true")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--sample_only", action="store_true")
    ap.add_argument("--prompt", default="\n")
    args = ap.parse_args()

    cfg = dict(CFG)
    torch.manual_seed(cfg["seed"])
    assert torch.cuda.is_available(), "the 341M run needs the 5080 (CUDA). Use train.py on CPU/MPS."
    device = "cuda"
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    import tiktoken
    enc = tiktoken.get_encoding("gpt2")

    model = GPT(cfg).to(device)
    nparams = sum(p.numel() for p in model.parameters())
    print(f"{nparams/1e6:.1f}M params | dim {cfg['dim']} L{cfg['n_layer']} "
          f"{cfg['n_head']}h/{cfg['n_kv_head']}kv | ctx {cfg['block_size']} | qk_norm {cfg['qk_norm']}")

    muon_params, adamw_params = split_muon_adamw_params(model)
    print(f"Muon: {sum(p.numel() for p in muon_params)/1e6:.0f}M params | "
          f"AdamW: {sum(p.numel() for p in adamw_params)/1e6:.0f}M params")
    opt_muon  = SingleDeviceMuon(muon_params, lr=cfg["muon_lr"],
                                 momentum=cfg["muon_momentum"], weight_decay=cfg["muon_wd"])
    opt_adamw = torch.optim.AdamW(adamw_params, lr=cfg["adamw_lr"],
                                  betas=cfg["adamw_betas"], eps=1e-8, weight_decay=cfg["adamw_wd"])

    start_step = 0
    if os.path.exists(args.out) and not args.fresh:
        ck = torch.load(args.out, map_location=device)
        model.load_state_dict(ck["model"])
        if not args.sample_only:
            opt_muon.load_state_dict(ck["opt_muon"])
            opt_adamw.load_state_dict(ck["opt_adamw"])
        start_step = ck.get("step", 0)
        print(f"resumed at step {start_step}")

    def generate(prompt, n=200, temp=0.8, top_k=200):
        model.eval()
        ids = enc.encode_ordinary(prompt) or [enc.eot_token]
        idx = torch.tensor([ids], device=device)
        with torch.no_grad():
            out = model.generate(idx, n, temperature=temp, top_k=top_k)[0].tolist()
        model.train()
        return enc.decode([t for t in out if t < enc.n_vocab])

    if args.sample_only:
        print(generate(args.prompt, n=400))
        return

    train_data, val_data = load_bin(args.data), load_bin(args.val)
    print(f"train {len(train_data):,} tok | val {len(val_data):,} tok")

    def get_batch(split):
        d = train_data if split == "train" else val_data
        bs, bl = cfg["micro_batch"], cfg["block_size"]
        ix = torch.randint(len(d) - bl - 1, (bs,))
        x = torch.stack([torch.from_numpy(d[i:i+bl].astype(np.int64)) for i in ix])
        y = torch.stack([torch.from_numpy(d[i+1:i+1+bl].astype(np.int64)) for i in ix])
        return x.to(device), y.to(device)

    @torch.no_grad()
    def eval_loss():
        model.eval()
        out = {}
        for split in ("train", "val"):
            L = torch.zeros(20)
            for k in range(20):
                x, y = get_batch(split)
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    _, loss = model(x, y)
                L[k] = loss.item()
            out[split] = L.mean().item()
        model.train()
        return out

    if args.compile:
        model = torch.compile(model)
    def raw():
        return model._orig_mod if hasattr(model, "_orig_mod") else model

    eff = cfg["micro_batch"] * cfg["block_size"] * cfg["grad_accum"]
    print(f"batch {eff:,} tok/update | {cfg['grad_accum']} micro-steps of {cfg['micro_batch']}\n")

    t0 = time.time()
    model.train()
    for step in range(start_step, cfg["total_steps"] + 1):
        m = wsd_mult(step, cfg)
        for g in opt_muon.param_groups:  g["lr"] = cfg["muon_lr"] * m
        for g in opt_adamw.param_groups: g["lr"] = cfg["adamw_lr"] * m

        if step % cfg["eval_every"] == 0:
            L = eval_loss()
            dt = (time.time() - t0) / 60
            print(f"step {step:>6} | train {L['train']:.3f} | val {L['val']:.3f} "
                  f"| lr {cfg['muon_lr']*m:.1e} | {dt:.1f}m")
            print("   " + generate("\n", n=160).replace("\n", " ").strip()[:160])
            torch.save({"model": raw().state_dict(), "opt_muon": opt_muon.state_dict(),
                        "opt_adamw": opt_adamw.state_dict(), "step": step, "cfg": cfg}, args.out)

        opt_muon.zero_grad(set_to_none=True)
        opt_adamw.zero_grad(set_to_none=True)
        for _ in range(cfg["grad_accum"]):
            x, y = get_batch("train")
            with torch.autocast("cuda", dtype=torch.bfloat16):
                _, loss = model(x, y)
                loss = loss / cfg["grad_accum"]
            loss.backward()
        # Muon self-bounds its update size, so we only clip the AdamW group.
        torch.nn.utils.clip_grad_norm_(adamw_params, cfg["grad_clip"])
        opt_muon.step()
        opt_adamw.step()

    print(f"done in {(time.time()-t0)/60:.1f} min -> {args.out}")


if __name__ == "__main__":
    main()
