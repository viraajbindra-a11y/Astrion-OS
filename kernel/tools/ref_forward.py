#!/usr/bin/env python3
"""Reference forward pass for a tiny Qwen-shaped transformer.

This is the ORACLE. The kernel's C forward pass (model.c, not yet written) is
checked layer-by-layer against this, the same way q8_dot was checked against an
exact reference — because a transformer that runs without crashing and produces
subtly wrong numbers reads as a bad model, and that is the failure mode that
costs a week.

Deliberately float64 numpy with no quantization and no cleverness. Its only job
is to be OBVIOUSLY correct, one operation per line, matching the Qwen2
architecture exactly:

    x = x + attn(rmsnorm(x))       # pre-norm residual
    x = x + mlp(rmsnorm(x))
  per layer, then a final rmsnorm and the logit projection.

Qwen2 specifics that differ from the GPT-2 loop in gpt.c, and that the C port
has to get right:
  - RMSNorm, not LayerNorm (no mean-subtraction, no bias).
  - RoPE on Q and K, not learned position embeddings.
  - Grouped-query attention: fewer KV heads than Q heads, each KV head shared
    by a group of Q heads.
  - SwiGLU MLP: silu(gate(x)) * up(x), then down(). Three matrices, not two.
  - QKV biases are present in Qwen2 (unusual — most post-Llama models drop them).

Run with no args to self-check and dump fixtures the C test reads:
    python3 ref_forward.py
"""

import numpy as np
import json
import struct
import sys

# A tiny config — big enough to exercise every code path (GQA needs
# n_kv < n_head; two layers exercise the residual accumulation), small enough
# that a human can eyeball a fixture. NOT Qwen's real dimensions; the point is
# to prove the MATH before the size.
CFG = {
    "dim":       32,
    "n_layers":   2,
    "n_heads":    4,
    "n_kv_heads": 2,     # grouped-query: 2 Q heads share each KV head
    "head_dim":   8,     # dim / n_heads
    "ffn_dim":   64,
    "vocab":     48,
    "rope_theta": 10000.0,
    "rms_eps":   1e-6,
}


def rmsnorm(x, weight, eps):
    # No mean subtraction — that is the LayerNorm/RMSNorm difference the C port
    # must not reintroduce. Scale by the RMS over the feature axis, then weight.
    ms = np.mean(x * x, axis=-1, keepdims=True)
    return x / np.sqrt(ms + eps) * weight


def silu(x):
    return x / (1.0 + np.exp(-x))


def rope(x, pos, theta, head_dim):
    # Rotary embedding. x is (n_heads, head_dim). Rotate each (2i, 2i+1) pair
    # by pos * theta**(-2i/head_dim). The pairing convention (adjacent pairs,
    # not split-halves) has to match what the C port and the weight converter
    # agree on — get it wrong and attention silently attends to the wrong
    # positions.
    out = np.empty_like(x)
    for i in range(head_dim // 2):
        freq = theta ** (-2.0 * i / head_dim)
        ang = pos * freq
        c, s = np.cos(ang), np.sin(ang)
        a = x[..., 2 * i]
        b = x[..., 2 * i + 1]
        out[..., 2 * i]     = a * c - b * s
        out[..., 2 * i + 1] = a * s + b * c
    return out


def attention(x, w, cfg, kv_cache, pos, rec=None):
    H, KV, D = cfg["n_heads"], cfg["n_kv_heads"], cfg["head_dim"]
    group = H // KV

    q = x @ w["wq"].T + w["bq"]           # (dim=H*D,)
    k = x @ w["wk"].T + w["bk"]           # (KV*D,)
    v = x @ w["wv"].T + w["bv"]

    q = q.reshape(H, D)
    k = k.reshape(KV, D)
    v = v.reshape(KV, D)

    for h in range(H):
        q[h] = rope(q[h], pos, cfg["rope_theta"], D)
    for h in range(KV):
        k[h] = rope(k[h], pos, cfg["rope_theta"], D)

    # The C test checks Q and K right here, post-RoPE — the op most likely to be
    # subtly wrong, and the one whose control (drop RoPE) is a no-op at pos 0.
    if rec is not None:
        rec["qrope"] = q.reshape(-1).copy()
        rec["krope"] = k.reshape(-1).copy()

    # Append this step's k,v to the per-layer cache.
    kv_cache["k"].append(k)
    kv_cache["v"].append(v)
    K = np.stack(kv_cache["k"], axis=0)   # (pos+1, KV, D)
    V = np.stack(kv_cache["v"], axis=0)

    out = np.zeros((H, D))
    scale = 1.0 / np.sqrt(D)
    for h in range(H):
        kvh = h // group                  # which KV head this Q head reads
        scores = (K[:, kvh, :] @ q[h]) * scale    # (pos+1,)
        scores = scores - np.max(scores)
        w_ = np.exp(scores)
        w_ = w_ / np.sum(w_)
        out[h] = w_ @ V[:, kvh, :]         # (D,)

    out = out.reshape(-1)
    return out @ w["wo"].T


def mlp(x, w):
    return (silu(x @ w["w_gate"].T) * (x @ w["w_up"].T)) @ w["w_down"].T


def forward(tokens, w, cfg, trace=None):
    """Full stack over a sequence, returning logits at each position.

    When `trace` is a list it is filled with one dict per position, each holding
    every op's output for every layer — the exact points model.c's model_trace
    captures, so the C test can diff op-by-op instead of only at the logits,
    where a mid-layer sign error would hide."""
    caches = [{"k": [], "v": []} for _ in range(cfg["n_layers"])]
    logits_seq = []
    for pos, tok in enumerate(tokens):
        x = w["embed"][tok].astype(np.float64).copy()
        rec = None
        if trace is not None:
            rec = {k: [] for k in ("ln1", "qrope", "krope", "attn",
                                   "ln2", "mlp", "xout")}
        for l in range(cfg["n_layers"]):
            lw = w["layers"][l]
            n1 = rmsnorm(x, lw["ln1"], cfg["rms_eps"])
            arec = {} if rec is not None else None
            a = attention(n1, lw, cfg, caches[l], pos, arec)
            x = x + a
            n2 = rmsnorm(x, lw["ln2"], cfg["rms_eps"])
            m = mlp(n2, lw)
            x = x + m
            if rec is not None:
                rec["ln1"].append(n1.copy())
                rec["qrope"].append(arec["qrope"])
                rec["krope"].append(arec["krope"])
                rec["attn"].append(a.copy())
                rec["ln2"].append(n2.copy())
                rec["mlp"].append(m.copy())
                rec["xout"].append(x.copy())
        xf = rmsnorm(x, w["final_ln"], cfg["rms_eps"])
        lg = xf @ w["lm_head"].T
        if rec is not None:
            rec["final"] = xf.copy()
            rec["logits"] = lg.copy()
            trace.append(rec)
        logits_seq.append(lg)
    return np.array(logits_seq)


def make_weights(cfg, seed=1):
    # Deterministic pseudo-random weights. Small magnitude so activations stay
    # in a sane range and a human can read the fixture. Seed fixed so the C
    # test can hardcode the expected numbers.
    rng = np.random.default_rng(seed)
    D, H, KV, HD = cfg["dim"], cfg["n_heads"], cfg["n_kv_heads"], cfg["head_dim"]
    F = cfg["ffn_dim"]

    def r(*shape):
        return (rng.standard_normal(shape) * 0.08).astype(np.float64)

    layers = []
    for _ in range(cfg["n_layers"]):
        layers.append({
            "ln1": (1.0 + r(D)), "ln2": (1.0 + r(D)),
            "wq": r(H * HD, D),  "bq": r(H * HD),
            "wk": r(KV * HD, D), "bk": r(KV * HD),
            "wv": r(KV * HD, D), "bv": r(KV * HD),
            "wo": r(D, H * HD),
            "w_gate": r(F, D), "w_up": r(F, D), "w_down": r(D, F),
        })
    return {
        "embed":    r(cfg["vocab"], D),
        "layers":   layers,
        "final_ln": (1.0 + r(D)),
        "lm_head":  r(cfg["vocab"], D),
    }


def _carr(f, name, length, flat):
    """Emit `static const double NAME[LENGTH] = { ... };`, flat and 1-D.

    Flat 1-D (not multidimensional) on purpose: a nested-brace initializer trips
    -Wmissing-braces under the test's -Werror, and the C side indexes these with
    plain stride math anyway. repr(float(v)) is the shortest round-trippable
    literal, so the C test reads back the SAME doubles the oracle computed."""
    vals = [repr(float(v)) for v in np.asarray(flat).ravel()]
    assert len(vals) == length, (name, len(vals), length)
    f.write("static const double %s[%d] = {\n" % (name, length))
    for i in range(0, len(vals), 6):
        f.write("  " + ", ".join(vals[i:i + 6]) + ",\n")
    f.write("};\n\n")


def emit_c_header(path, cfg, tokens, w, trace):
    """Dump config + weights + every per-op intermediate as a C header.

    Layout mirrors model.h's structs exactly so test_model.c can convert the
    double weights to int64 fixed-point / int8 and diff the C forward pass
    against RF_T_* op-by-op. Weight rows are [out][in]; per-layer arrays are
    concatenated over layers, intermediates over [pos][layer]."""
    D, NL = cfg["dim"], cfg["n_layers"]
    H, KV, HD = cfg["n_heads"], cfg["n_kv_heads"], cfg["head_dim"]
    F, V = cfg["ffn_dim"], cfg["vocab"]
    HHD, KVD = H * HD, KV * HD
    ntok = len(tokens)
    eps_shift = 40
    rms_eps_fp = int(round(cfg["rms_eps"] * (1 << eps_shift)))

    def layers(key):   # concat one weight over all layers
        return np.concatenate([np.asarray(w["layers"][l][key]).ravel()
                               for l in range(NL)])

    def tr(key):       # concat one intermediate over [pos][layer]
        return np.concatenate([np.asarray(trace[p][key][l]).ravel()
                               for p in range(ntok) for l in range(NL)])

    def trp(key):      # concat a per-position intermediate over [pos]
        return np.concatenate([np.asarray(trace[p][key]).ravel()
                               for p in range(ntok)])

    with open(path, "w") as f:
        f.write("/* GENERATED by tools/ref_forward.py — do not edit by hand.\n"
                " * The oracle's config, weights and per-op intermediates as C\n"
                " * arrays, so kernel/tests/test_model.c needs no JSON parser and\n"
                " * checks the SAME numbers off the SAME weights. */\n")
        f.write("#ifndef REF_FORWARD_FIXTURE_H\n#define REF_FORWARD_FIXTURE_H\n\n")
        for name, val in [("RF_DIM", D), ("RF_NL", NL), ("RF_H", H), ("RF_KV", KV),
                          ("RF_HD", HD), ("RF_HHD", HHD), ("RF_KVD", KVD),
                          ("RF_FFN", F), ("RF_VOCAB", V), ("RF_NTOK", ntok),
                          ("RF_MAX_SEQ", ntok), ("RF_ROPE_THETA", int(cfg["rope_theta"])),
                          ("RF_EPS_SHIFT", eps_shift)]:
            f.write("#define %s %d\n" % (name, val))
        f.write("#define RF_RMS_EPS_FP %dLL\n\n" % rms_eps_fp)
        f.write("static const int RF_TOKENS[RF_NTOK] = { %s };\n\n"
                % ", ".join(str(t) for t in tokens))

        _carr(f, "RF_EMBED",    V * D,        w["embed"])
        _carr(f, "RF_LN1",      NL * D,       layers("ln1"))
        _carr(f, "RF_LN2",      NL * D,       layers("ln2"))
        _carr(f, "RF_WQ",       NL * HHD * D, layers("wq"))
        _carr(f, "RF_BQ",       NL * HHD,     layers("bq"))
        _carr(f, "RF_WK",       NL * KVD * D, layers("wk"))
        _carr(f, "RF_BK",       NL * KVD,     layers("bk"))
        _carr(f, "RF_WV",       NL * KVD * D, layers("wv"))
        _carr(f, "RF_BV",       NL * KVD,     layers("bv"))
        _carr(f, "RF_WO",       NL * D * HHD, layers("wo"))
        _carr(f, "RF_WGATE",    NL * F * D,   layers("w_gate"))
        _carr(f, "RF_WUP",      NL * F * D,   layers("w_up"))
        _carr(f, "RF_WDOWN",    NL * D * F,   layers("w_down"))
        _carr(f, "RF_FINAL_LN", D,            w["final_ln"])
        _carr(f, "RF_LMHEAD",   V * D,        w["lm_head"])

        _carr(f, "RF_T_LN1",    ntok * NL * D,   tr("ln1"))
        _carr(f, "RF_T_QROPE",  ntok * NL * HHD, tr("qrope"))
        _carr(f, "RF_T_KROPE",  ntok * NL * KVD, tr("krope"))
        _carr(f, "RF_T_ATTN",   ntok * NL * D,   tr("attn"))
        _carr(f, "RF_T_LN2",    ntok * NL * D,   tr("ln2"))
        _carr(f, "RF_T_MLP",    ntok * NL * D,   tr("mlp"))
        _carr(f, "RF_T_XOUT",   ntok * NL * D,   tr("xout"))
        _carr(f, "RF_T_FINAL",  ntok * D,        trp("final"))
        _carr(f, "RF_LOGITS",   ntok * V,        trp("logits"))
        f.write("#endif /* REF_FORWARD_FIXTURE_H */\n")


def main():
    cfg = CFG
    w = make_weights(cfg)
    tokens = [3, 14, 7, 0, 41, 2]        # arbitrary, within vocab
    trace = []
    logits = forward(tokens, w, cfg, trace)

    # Sanity the oracle before anyone trusts it as one.
    assert logits.shape == (len(tokens), cfg["vocab"]), logits.shape
    assert np.all(np.isfinite(logits)), "non-finite logits — oracle is broken"
    preds = logits.argmax(axis=-1)
    print(f"config: {cfg['n_layers']}L {cfg['dim']}d {cfg['n_heads']}h/"
          f"{cfg['n_kv_heads']}kv  vocab {cfg['vocab']}")
    print(f"tokens:  {tokens}")
    print(f"argmax:  {preds.tolist()}")
    print(f"logit[0] first 6: {[round(float(v),4) for v in logits[0,:6]]}")

    # The final-position logits are what sampling consumes. Dump them plus the
    # config and a weight checksum so the C test checks the SAME numbers off the
    # SAME weights, not a re-randomization.
    flat = logits[-1].astype(np.float64)
    out = {
        "config": cfg,
        "tokens": tokens,
        "final_logits": [float(v) for v in flat],
        "argmax_seq": preds.tolist(),
    }
    with open("ref_forward_fixture.json", "w") as f:
        json.dump(out, f, indent=1)
    print("wrote ref_forward_fixture.json")

    # The C header is the real gate: config, weights and EVERY per-op
    # intermediate, so test_model.c diffs layer-by-layer, not just at the logits.
    emit_c_header("ref_forward_fixture.h", cfg, tokens, w, trace)
    print("wrote ref_forward_fixture.h  (%d positions x %d layers traced)"
          % (len(tokens), cfg["n_layers"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
