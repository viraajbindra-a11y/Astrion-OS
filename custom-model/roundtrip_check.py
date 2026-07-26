#!/usr/bin/env python3
"""roundtrip_check.py — the ONE torch step that closes the export seam, run on
the training PC (where torch lives). Proves a real checkpoint, exported by
mkweights.py --ckpt, computes under the kernel's int8 engine the SAME thing the
torch model computes — the last unverified link in the two-track plan.

It does NOT need a trained model. A random-init GPT of the right SHAPE exercises
the identical code path (name mapping, weight orientation, GQA, QK-norm, tied
embeddings, the AMW1 byte layout). Training only changes the NUMBERS, not the
plumbing this checks. So this can run today, before the weekend pretrain — and if
it passes, the whole pipeline is de-risked.

WHAT IT WRITES (both small — send them to the kernel chat / Mac):
  * rt_ckpt.astrion  — the AMW1 brain file, straight through mkweights.py --ckpt
  * rt_ckpt_ref.txt  — ntok, vocab, tokens, and the torch model's logits per
                       position, in the format kernel/tools/ckpt_roundtrip.c reads

THEN, on the Mac (this repo, has cc + the kernel source):
  cd kernel && cc -std=c11 -Iinclude tools/ckpt_roundtrip.c -o build/ckpt_roundtrip
  ./build/ckpt_roundtrip rt_ckpt.astrion rt_ckpt_ref.txt
Expect: "argmax mismatches 0/N ... PASS". A convention/format bug shows up as
argmax mismatches and a big deviation (the harness is control-proven to catch
RoPE and GQA-grouping bugs). If it passes, mkweights.py --ckpt is verified end
to end and a trained Ember will drop straight into Astrion.

  python roundtrip_check.py            # -> rt_ckpt.astrion, rt_ckpt_ref.txt

Deliberately a small, distinct shape (dim 64, 3 layers, GQA 4:2, QK-norm on,
tied embeddings) — the SAME shape kernel/tools/rt_oracle.py uses on the numpy
side, so the two halves of the proof line up.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MKWEIGHTS = os.path.normpath(os.path.join(HERE, "..", "kernel", "tools", "mkweights.py"))

# Ember-shape in miniature. Same fields custom-model/train_best.py's CFG uses, so
# GPT(cfg) builds and mkweights.from_ckpt() reads every key it needs.
CFG = dict(
    dim=64, n_layer=3, n_head=4, n_kv_head=2,   # GQA 2:1, like Ember's 4:1
    ffn_dim=128, block_size=16, vocab=64,
    rope_theta=10000.0, rms_eps=1e-5,
    qk_norm=True,            # Ember trains with QK-norm on
    tie_embeddings=True,     # Ember ties embed <-> lm_head; from_ckpt handles it
)
TOKENS = [5, 12, 33, 1, 60, 7, 20]              # arbitrary, all < vocab
CKPT = os.path.join(HERE, "rt_ckpt.pt")
BLOB = os.path.join(HERE, "rt_ckpt.astrion")
REF = os.path.join(HERE, "rt_ckpt_ref.txt")


def main():
    try:
        import torch
    except ImportError:
        raise SystemExit("roundtrip_check needs torch — run it on the training PC, "
                         "not the Mac. (The Mac runs ckpt_roundtrip, the C side.)")
    if not os.path.exists(MKWEIGHTS):
        raise SystemExit("cannot find %s — is the full repo (kernel/ + custom-model/) here?" % MKWEIGHTS)
    sys.path.insert(0, HERE)
    from train import GPT

    torch.manual_seed(1337)
    model = GPT(CFG).eval()

    # Save in the exact shape train_best.py / finetune.py write, so this exercises
    # the real mkweights.from_ckpt() path, not a special case.
    torch.save({"model": model.state_dict(), "cfg": CFG}, CKPT)
    print("wrote %s (random-init, %d params)"
          % (CKPT, sum(p.numel() for p in model.parameters())))

    # Export through the SAME converter a trained Ember uses.
    cmd = [sys.executable, MKWEIGHTS, "--ckpt", CKPT, BLOB]
    print("  " + " ".join(cmd))
    rc = subprocess.call(cmd)
    if rc != 0:
        raise SystemExit("mkweights.py --ckpt failed (rc=%d) — the export seam is broken" % rc)

    # The reference: what the torch model itself computes. GPT.forward runs the
    # whole sequence in parallel under a causal mask; the C engine runs it
    # autoregressively through the KV cache. For a causal model those agree
    # position-for-position, so this ALSO checks the cache path.
    with torch.no_grad():
        logits, _ = model(torch.tensor([TOKENS], dtype=torch.long))   # [1, T, vocab]
    logits = logits[0]                                                 # [T, vocab]
    assert logits.shape == (len(TOKENS), CFG["vocab"]), tuple(logits.shape)
    assert torch.isfinite(logits).all(), "torch model produced non-finite logits"

    with open(REF, "w") as f:
        f.write("# roundtrip_check: random-init Ember-shape GPT, torch reference\n")
        f.write("%d %d\n" % (len(TOKENS), CFG["vocab"]))
        f.write(" ".join(str(t) for t in TOKENS) + "\n")
        for p in range(len(TOKENS)):
            f.write(" ".join(repr(float(v)) for v in logits[p].tolist()) + "\n")

    print("wrote %s and %s" % (BLOB, REF))
    print()
    print("Send rt_ckpt.astrion + rt_ckpt_ref.txt to the kernel chat, then on the Mac:")
    print("  cd kernel && cc -std=c11 -Iinclude tools/ckpt_roundtrip.c -o build/ckpt_roundtrip")
    print("  ./build/ckpt_roundtrip <path>/rt_ckpt.astrion <path>/rt_ckpt_ref.txt")
    print("Expect: argmax mismatches 0/%d  ->  PASS" % len(TOKENS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
