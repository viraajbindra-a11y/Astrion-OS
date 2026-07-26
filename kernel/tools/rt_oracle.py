#!/usr/bin/env python3
"""rt_oracle.py — self-check for ckpt_roundtrip.c, numpy only (no torch).

The checkpoint round-trip's real reference comes from torch on the training PC.
But the Mac half — mkweights.emit_blob -> model_load -> model_forward — can be
proven here with numpy alone, on a RANDOM Ember-shape model, using the same
numpy oracle (ref_forward.forward) the whole engine is gated against.

This writes two files ckpt_roundtrip.c then consumes:
  * rt_oracle.astrion  — the AMW1 blob, straight through mkweights.emit_blob
  * rt_oracle_ref.txt  — ntok, vocab, tokens, and ref_forward's logits per position

If `ckpt_roundtrip rt_oracle.astrion rt_oracle_ref.txt` PASSes, the Mac-side
chain is correct for an arbitrary config — so the ONLY thing the real torch
checkpoint adds is mkweights.from_ckpt (the .pt reader + name map), which the PC
script custom-model/roundtrip_check.py exercises with the identical harness.

Deliberately a DIFFERENT shape from ref_forward.CFG (dim 64 not 32, 3 layers,
head_dim 16, ffn 128, vocab 64, qk-norm ON) so a pass means config-independent,
not a re-run of the baked fixture's numbers.

    python3 tools/rt_oracle.py           # writes build/rt_oracle.{astrion,_ref.txt}
    ./build/ckpt_roundtrip build/rt_oracle.astrion build/rt_oracle_ref.txt
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ref_forward as rf          # make_weights / forward — the numpy oracle
import mkweights                  # emit_blob / blob_config — the converter

# Ember-shape, but tiny and distinct from ref_forward.CFG so this is an
# independent test of config-independence, not a fixture re-run.
CFG = {
    "dim":        64,
    "n_layers":    3,
    "n_heads":     4,
    "n_kv_heads":  2,     # grouped-query, like Ember (16:4)
    "head_dim":   16,     # dim / n_heads
    "ffn_dim":   128,
    "vocab":      64,
    "rope_theta": 10000.0,
    "rms_eps":    1e-5,
    "qk_norm":    True,   # Ember trains with QK-norm on
}
TOKENS = [5, 12, 33, 1, 60, 7, 20]     # arbitrary, all < vocab
MAX_SEQ = 16                            # >= len(TOKENS)


def main():
    out_dir = os.path.join(os.path.dirname(HERE), "build")
    os.makedirs(out_dir, exist_ok=True)
    blob_path = os.path.join(out_dir, "rt_oracle.astrion")
    ref_path = os.path.join(out_dir, "rt_oracle_ref.txt")

    # One weight set, fed to BOTH the converter and the oracle — so any
    # disagreement the harness reports is the engine's, not a weight mismatch.
    w = rf.make_weights(CFG, seed=7)
    blob = mkweights.emit_blob(mkweights.blob_config(CFG, MAX_SEQ), w)
    with open(blob_path, "wb") as f:
        f.write(blob)

    logits = rf.forward(TOKENS, w, CFG)          # [ntok, vocab] float64
    assert logits.shape == (len(TOKENS), CFG["vocab"]), logits.shape
    assert np.all(np.isfinite(logits)), "oracle produced non-finite logits"

    with open(ref_path, "w") as f:
        f.write("# rt_oracle: random Ember-shape model, qk_norm on — numpy oracle reference\n")
        f.write("%d %d\n" % (len(TOKENS), CFG["vocab"]))
        f.write(" ".join(str(t) for t in TOKENS) + "\n")
        for p in range(len(TOKENS)):
            f.write(" ".join(repr(float(v)) for v in logits[p]) + "\n")

    print("wrote %s (%d bytes) and %s" % (blob_path, len(blob), ref_path))
    print("config: %dL dim %d %dh/%dkv head_dim %d ffn %d vocab %d qk_norm %s"
          % (CFG["n_layers"], CFG["dim"], CFG["n_heads"], CFG["n_kv_heads"],
             CFG["head_dim"], CFG["ffn_dim"], CFG["vocab"], CFG["qk_norm"]))
    print("now run:  ./build/ckpt_roundtrip %s %s" % (blob_path, ref_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
