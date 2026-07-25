#!/usr/bin/env python3
"""Convert a trained transformer into the flat "brain file" the kernel maps.

This is the host half of M6. It quantizes and serialises a model into ONE flat
little-endian blob (magic "AMW1"), the exact byte layout src/model_load.c reads
back and points struct model_weights at (zero-copy). Because the pipeline is
quantize -> serialise here, then C-deserialise -> forward in the kernel, any
byte-layout disagreement between this file and model_load.c shows up as a logit
mismatch in tests/test_model_load.c — the format is self-checking.

WHY THIS RUNS ON THE HOST, same reason as mktok.py: a trained checkpoint is a
float file we did not write, and turning it into int8 needs numpy (and, for a
real Ember, torch). Doing that at boot over an untrusted file is the parser class
that has bitten this kernel repeatedly. So it happens once, here, and the kernel
receives something it validates with bounds checks alone.

THE FORMAT is defined once, in the comment block at the top of src/model_load.c
("ON-DISK FORMAT AMW1"). This file MUST match it byte-for-byte; the two reference
the same spec. In short:
  * header (80 B): magic, version, the full model_config, file_len, n_matrices.
  * then fixed-order sections, each 8-byte aligned: embed, per-layer
    {ln1, ln2, bq, bk, bv, [qk_g], wq, wk, wv, wo, w_gate, w_up, w_down},
    final_ln, lm_head.
  * norm weights, QKV biases, qk_g, embed and final_ln are int64 fixed-point at
    Q8_SCALE_SHIFT (=20); rms_eps is fixed-point at MODEL_EPS_SHIFT (=40).
  * lm_head and the seven projections are int8, quantised EXACTLY as q8.h's
    q8_quantize does: grouped along the (zero-padded) input axis, GROUP=64,
    scale = ceil(peak/127), round-to-nearest-away, never -128. Each matrix
    section carries rows, padded cols, the int8 codes, then the q8_group scales.

TWO INPUT MODES:
  * --oracle / --oracle-qk  reproduce tools/ref_forward.py's tiny weights (the
    SAME make_weights the fixture was generated from), qk-norm off / on. This is
    what tests/test_model_load.c converts and round-trips.
  * --ckpt EMBER.pt         a real Ember checkpoint from custom-model/train_best.py.
    STRUCTURED BUT UNVERIFIED — see from_ckpt() and the report; no .pt exists yet.

    python3 mkweights.py --oracle     build/oracle.bin
    python3 mkweights.py --oracle-qk  build/oracle_qk.bin
    python3 mkweights.py --ckpt custom-model/ember.pt  build/ember.bin
"""
import argparse
import os
import struct
import sys

import numpy as np

# ── format constants — must match src/model_load.c and include/q8.h / model.h ──
AMW_MAGIC       = 0x31574D41   # "AMW1"
AMW_VERSION     = 1
AMW_HDR         = 80           # header size, a multiple of 8
Q8_GROUP        = 64           # q8.h Q8_GROUP
Q8_SCALE_SHIFT  = 20           # q8.h Q8_SCALE_SHIFT — activation/weight fixed-point
EPS_SHIFT       = 40           # model.h MODEL_EPS_SHIFT — rms_eps fixed-point


# ── fixed-point + quantization, ported to match q8.h / test_model.c EXACTLY ──

def w2fix_arr(arr):
    """double -> int64 fixed-point at Q8_SCALE_SHIFT, matching test_model.c's
    w2fix bit-for-bit: v*2^20, then round HALF AWAY FROM ZERO (C's
    `(int64_t)(v*2^20 + (v>=0?0.5:-0.5))` — add the half then truncate toward
    zero). Vectorised so the ~340M-weight Ember export is not a Python loop."""
    a = np.asarray(arr, dtype=np.float64) * float(1 << Q8_SCALE_SHIFT)
    # floor(a+0.5) for a>=0 and ceil(a-0.5) for a<0 are both "add half, truncate
    # toward zero" — identical to the C cast, no per-element branch needed.
    r = np.where(a >= 0.0, np.floor(a + 0.5), np.ceil(a - 0.5))
    return r.astype(np.int64)


def quantize_matrix(fix):
    """int64 fixed-point matrix [rows, cols] (cols already padded to a multiple
    of GROUP with zeros) -> (int8 codes [rows, cols], int32 scales [rows, groups]).

    A faithful vectorised port of q8_quantize (q8.h): per group of GROUP along
    the input axis, scale_num = ceil(peak/127), then each weight rounds to
    nearest AWAY FROM ZERO and clips to [-127, 127] (never -128, so negation
    stays representable). An all-zero group gets scale 0 and codes 0, exactly as
    q8.h reconstructs it with no divide-by-zero."""
    rows, cols = fix.shape
    assert cols % Q8_GROUP == 0, cols
    groups = cols // Q8_GROUP
    g = fix.reshape(rows * groups, Q8_GROUP)

    peak = np.abs(g).max(axis=1)                       # unsigned magnitude per group
    nz = peak > 0
    num = (peak + 126) // 127                          # ceil(peak/127); floor div, peak>0
    num = np.clip(num, 1, 0x7FFFFFFF)
    scale = np.where(nz, num, 0).astype(np.int64)      # zero group -> scale 0

    den = np.where(nz, scale, 1)                       # never 0 in the divisor
    half = den // 2
    add = np.where(g >= 0, g + half[:, None], g - half[:, None])
    # C integer division truncates toward zero; numpy // floors — emulate trunc.
    q = np.abs(add) // den[:, None]
    q = np.where(add < 0, -q, q)
    q = np.clip(q, -127, 127)
    q = np.where(nz[:, None], q, 0)                    # zero group -> all codes 0

    codes = q.reshape(rows, cols).astype(np.int8)
    scales = scale.reshape(rows, groups).astype("<i4")
    return codes, scales


def pad64(n):
    return (n + (Q8_GROUP - 1)) & ~(Q8_GROUP - 1)      # model.h model_pad()


def align8(buf):
    while len(buf) & 7:
        buf.append(0)


# ── section emitters ──

def emit_vec(body, arr):
    """int64 fixed-point vector, 8-aligned. Length is a multiple of 8, so the
    next section stays aligned with no trailing pad."""
    fix = w2fix_arr(np.asarray(arr).ravel())
    align8(body)
    body += fix.astype("<i8").tobytes()


def emit_matrix(body, W, rows_exp, cols_in):
    """One int8 MATRIX section: {rows, cols}, then row-major int8 codes, then
    row-major q8_group scales, each run 8-aligned. The input axis is zero-padded
    to a multiple of GROUP before quantization."""
    W = np.asarray(W, dtype=np.float64)
    assert W.shape == (rows_exp, cols_in), (W.shape, (rows_exp, cols_in))
    cols = pad64(cols_in)
    fix = w2fix_arr(W)                                  # [rows, cols_in]
    if cols > cols_in:
        pad = np.zeros((rows_exp, cols - cols_in), dtype=np.int64)
        fix = np.concatenate([fix, pad], axis=1)       # zero pad columns
    codes, scales = quantize_matrix(fix)

    align8(body)
    body += struct.pack("<II", rows_exp, cols)         # 8 B, keeps alignment
    body += codes.tobytes()                            # [rows][cols] int8
    align8(body)
    body += scales.tobytes()                           # [rows][groups] int32 LE
    align8(body)


def emit_blob(config, w):
    """Assemble the whole AMW1 blob. `config` is the header dict; `w` mirrors
    tools/ref_forward.py's make_weights structure (embed, layers[l]{...},
    final_ln, lm_head), matmul weights [out][in]."""
    dim = config["dim"]; NL = config["n_layers"]
    H = config["n_heads"]; KV = config["n_kv_heads"]; HD = config["head_dim"]
    F = config["ffn_dim"]; V = config["vocab"]; qk = config["qk_norm"]
    HHD, KVD = H * HD, KV * HD

    body = bytearray()
    emit_vec(body, w["embed"])                         # [V][dim]
    for l in range(NL):
        lw = w["layers"][l]
        emit_vec(body, lw["ln1"])
        emit_vec(body, lw["ln2"])
        emit_vec(body, lw["bq"])
        emit_vec(body, lw["bk"])
        emit_vec(body, lw["bv"])
        if qk:
            emit_vec(body, lw["qk_g"])
        emit_matrix(body, lw["wq"], HHD, dim)
        emit_matrix(body, lw["wk"], KVD, dim)
        emit_matrix(body, lw["wv"], KVD, dim)
        emit_matrix(body, lw["wo"], dim, HHD)
        emit_matrix(body, lw["w_gate"], F, dim)
        emit_matrix(body, lw["w_up"],   F, dim)
        emit_matrix(body, lw["w_down"], dim, F)
    emit_vec(body, w["final_ln"])
    emit_matrix(body, w["lm_head"], V, dim)

    file_len = AMW_HDR + len(body)
    n_matrices = 7 * NL + 1
    hdr = struct.pack("<11I", AMW_MAGIC, AMW_VERSION, dim, NL, H, KV, HD, F, V,
                      config["max_seq"], qk)
    hdr += struct.pack("<I", 0)                                    # reserved
    hdr += struct.pack("<qq", config["rope_theta"], config["rms_eps_fp"])
    hdr += struct.pack("<Q", file_len)
    hdr += struct.pack("<II", n_matrices, 0)                       # n_matrices, reserved2
    assert len(hdr) == AMW_HDR, len(hdr)
    return bytes(hdr) + bytes(body)


# ── input mode 1: the oracle's tiny weights (the tested path) ──

def blob_config(cfg, max_seq):
    return {
        "dim": cfg["dim"], "n_layers": cfg["n_layers"], "n_heads": cfg["n_heads"],
        "n_kv_heads": cfg["n_kv_heads"], "head_dim": cfg["head_dim"],
        "ffn_dim": cfg["ffn_dim"], "vocab": cfg["vocab"], "max_seq": max_seq,
        "qk_norm": 1 if cfg.get("qk_norm", False) else 0,
        "rope_theta": int(round(cfg["rope_theta"])),
        "rms_eps_fp": int(round(cfg["rms_eps"] * (1 << EPS_SHIFT))),
    }


def from_oracle(qk_on, max_seq):
    """Reproduce tools/ref_forward.py's weights EXACTLY — same make_weights(seed=1),
    and for qk-on the same rng-2 gain injection ref_forward.main() uses — so the
    C round-trip reproduces RF_LOGITS / RF_QK_LOGITS off the identical weights."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ref_forward as rf
    cfg = dict(rf.CFG)
    w = rf.make_weights(cfg, seed=1)
    if qk_on:
        rng2 = np.random.default_rng(2)               # identical to ref_forward.main
        HD = cfg["head_dim"]
        for l in range(cfg["n_layers"]):
            w["layers"][l]["qk_g"] = (1.0 + rng2.standard_normal(HD) * 0.08).astype(np.float64)
        cfg["qk_norm"] = True
    return blob_config(cfg, max_seq), w


# ── input mode 2: a real Ember checkpoint — STRUCTURED, NOT YET VERIFIED ──
#
# This path cannot be tested end to end: no Ember .pt exists (the weekend pretrain
# is pending), and torch is not a dependency of the tested oracle path. It is
# written from the known state_dict shape of custom-model/train_best.py (RMSNorm +
# RoPE + SwiGLU + GQA 16:4 + QK-norm — the SAME architecture as model.c) and the
# name mapping already proven in custom-model/export_ember.py, but until a real
# checkpoint round-trips through the C engine, treat it as UNVERIFIED. Do not
# claim it works. The oracle path above is the one the gate exercises.

def oracle_name(k):
    """train_best.py's tensor name -> ref_forward.py's name. Copied verbatim from
    custom-model/export_ember.py; the two MUST stay in sync (both describe the
    same model). Kept local so the tested --oracle path needs no torch import."""
    k = k.replace("blocks.", "layers.")
    k = k.replace(".attn.wq.weight", ".wq").replace(".attn.wk.weight", ".wk")
    k = k.replace(".attn.wv.weight", ".wv").replace(".attn.wo.weight", ".wo")
    k = k.replace(".attn.qk_norm.weight", ".qk_g")
    k = k.replace(".mlp.gate.weight", ".w_gate").replace(".mlp.up.weight", ".w_up")
    k = k.replace(".mlp.down.weight", ".w_down")
    k = k.replace(".ln1.weight", ".ln1").replace(".ln2.weight", ".ln2")
    k = k.replace("embed.weight", "embed").replace("final_ln.weight", "final_ln")
    return k


def from_ckpt(path, max_seq_override):
    """Map an Ember checkpoint's state_dict onto the AMW sections. UNVERIFIED."""
    import torch  # lazy: only the untested real-model path needs it
    ck = torch.load(path, map_location="cpu")
    cfg, sd = ck["cfg"], ck["model"]

    dim = cfg["dim"]; n_head = cfg["n_head"]
    n_kv = cfg.get("n_kv_head", n_head)
    head_dim = dim // n_head
    NL = cfg["n_layer"]
    qk = bool(cfg.get("qk_norm", False))

    named = {}
    for k, t in sd.items():
        arr = t.detach().float().numpy()
        named["lm_head" if k == "lm_head.weight" else oracle_name(k)] = arr

    # lm_head is a SEPARATE int8 matrix in this format even when Ember ties it to
    # embed (Ember reuses the embedding for the output projection). Synthesise it
    # from embed when tied — the engine's logit head needs its own quantised copy.
    if "lm_head" not in named:
        if cfg.get("tie_embeddings", False):
            named["lm_head"] = named["embed"]
        else:
            raise SystemExit("checkpoint has no lm_head.weight and tie_embeddings is false")

    w = {"embed": named["embed"], "final_ln": named["final_ln"],
         "lm_head": named["lm_head"], "layers": []}
    for l in range(NL):
        p = "layers.%d." % l
        lw = {key: named[p + key] for key in
              ("ln1", "ln2", "wq", "wk", "wv", "wo", "w_gate", "w_up", "w_down")}
        # Qwen carries QKV biases; Ember (has_qkv_bias=False) does not. This format
        # always has a bias section — emit a zero vector when the model has none.
        lw["bq"] = named.get(p + "bq", np.zeros(n_head * head_dim, np.float64))
        lw["bk"] = named.get(p + "bk", np.zeros(n_kv * head_dim, np.float64))
        lw["bv"] = named.get(p + "bv", np.zeros(n_kv * head_dim, np.float64))
        if qk:
            lw["qk_g"] = named[p + "qk_g"]
        w["layers"].append(lw)

    config = {
        "dim": dim, "n_layers": NL, "n_heads": n_head, "n_kv_heads": n_kv,
        "head_dim": head_dim, "ffn_dim": cfg["ffn_dim"], "vocab": cfg["vocab"],
        "max_seq": max_seq_override or cfg["block_size"],
        "qk_norm": 1 if qk else 0,
        "rope_theta": int(round(cfg["rope_theta"])),
        "rms_eps_fp": int(round(cfg["rms_eps"] * (1 << EPS_SHIFT))),
    }
    return config, w


def print_summary(config, blob, out_path):
    c = config
    print("wrote %s" % out_path)
    print("  config: %dL  dim %d  %dh/%dkv  head_dim %d  ffn %d  vocab %d  max_seq %d"
          % (c["n_layers"], c["dim"], c["n_heads"], c["n_kv_heads"], c["head_dim"],
             c["ffn_dim"], c["vocab"], c["max_seq"]))
    print("  qk_norm %d  rope_theta %d  rms_eps_fp %d  (int8 matrices, int64 vectors)"
          % (c["qk_norm"], c["rope_theta"], c["rms_eps_fp"]))
    print("  size:   %d bytes (%.2f MB)" % (len(blob), len(blob) / 1e6))


def main():
    ap = argparse.ArgumentParser(description="convert a model into the AMW1 brain file")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--oracle", action="store_true",
                     help="reproduce ref_forward.py's tiny weights, qk-norm OFF (tested path)")
    src.add_argument("--oracle-qk", action="store_true",
                     help="reproduce ref_forward.py's tiny weights, qk-norm ON (Ember-shape)")
    src.add_argument("--ckpt", metavar="EMBER.pt",
                     help="a real Ember PyTorch checkpoint (UNVERIFIED — no .pt exists yet)")
    ap.add_argument("--max-seq", type=int, default=0,
                    help="KV-cache capacity recorded in the header (0 = default: 12 for oracle, block_size for a ckpt)")
    ap.add_argument("out", help="output blob path")
    args = ap.parse_args()

    if args.oracle or args.oracle_qk:
        config, w = from_oracle(args.oracle_qk, args.max_seq or 12)
    else:
        print("WARNING: --ckpt is the UNVERIFIED real-model path; no Ember .pt has "
              "round-tripped through the C engine yet.", file=sys.stderr)
        config, w = from_ckpt(args.ckpt, args.max_seq)

    blob = emit_blob(config, w)
    with open(args.out, "wb") as f:
        f.write(blob)
    print_summary(config, blob, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
