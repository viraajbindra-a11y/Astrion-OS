#!/usr/bin/env python3
"""
export_ember.py — turn a trained Ember (float, ~1.3 GB) into a single int8 file
your Astrion kernel can load (~340 MB). THIS is the bridge the two-track plan is
built around: same engine, swap the weight file.

What it does:
  * Quantizes every 2D weight matrix to 8-bit integers with a per-row scale
    (the standard for LLM weights — one float multiplier per output row keeps the
    error tiny). Norm weights stay in fp16 because they're small and sensitive.
  * Writes the Astrion model-file format from TWO-TRACKS.md:
        [magic][JSON header: config + tensor table][int8/fp16 weight blob][sha256]
    The kernel reads the model's SHAPE from the header, not from #defines — so
    Qwen and Ember are the same code, different file.
  * Verifies the quantized model still behaves: it reloads the int8 weights and
    checks the logits barely move (cosine ~1.0) vs the original float model.

    python export_ember.py                       # ember.pt   -> ember.astrion
    python export_ember.py --ckpt ember-base.pt  # export the base model instead
    python export_ember.py --verify              # also run the accuracy check

Tensor names match kernel/tools/ref_forward.py exactly (wq/wk/wv/wo, w_gate/w_up/
w_down, ln1/ln2, embed, final_ln, qk_g), so the oracle can run these weights.
"""
import argparse, hashlib, json, os, struct
import numpy as np
import torch

MAGIC = b"ASTRION\x01"

# how train.py names a tensor -> how the kernel oracle (ref_forward.py) names it
def oracle_name(k):
    k = k.replace("blocks.", "layers.")
    k = k.replace(".attn.wq.weight", ".wq").replace(".attn.wk.weight", ".wk")
    k = k.replace(".attn.wv.weight", ".wv").replace(".attn.wo.weight", ".wo")
    k = k.replace(".attn.qk_norm.weight", ".qk_g")
    k = k.replace(".mlp.gate.weight", ".w_gate").replace(".mlp.up.weight", ".w_up")
    k = k.replace(".mlp.down.weight", ".w_down")
    k = k.replace(".ln1.weight", ".ln1").replace(".ln2.weight", ".ln2")
    k = k.replace("embed.weight", "embed").replace("final_ln.weight", "final_ln")
    return k


def quantize_rows(W):
    """Per-row symmetric int8. Each output row gets its own scale = max|w|/127."""
    amax = np.abs(W).max(axis=1)
    scale = np.maximum(amax / 127.0, 1e-12)
    q = np.round(W / scale[:, None]).clip(-127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def dequant_rows(q, scale):
    return q.astype(np.float32) * scale[:, None]


def build_config(cfg):
    """The header the kernel loads its shape from — every dim is a field, not a #define."""
    return {
        "dim": cfg["dim"], "n_layer": cfg["n_layer"],
        "n_head": cfg["n_head"], "n_kv_head": cfg.get("n_kv_head", cfg["n_head"]),
        "head_dim": cfg["dim"] // cfg["n_head"], "ffn_dim": cfg["ffn_dim"],
        "vocab": cfg["vocab"], "block_size": cfg["block_size"],
        "rope_theta": cfg["rope_theta"], "rms_eps": cfg["rms_eps"],
        "qk_norm": bool(cfg.get("qk_norm", False)),
        "tie_embeddings": True, "has_qkv_bias": False,
    }


def export(ckpt_path, out_path):
    ck = torch.load(ckpt_path, map_location="cpu")
    cfg, sd = ck["cfg"], ck["model"]
    config = build_config(cfg)

    tensors, blob = [], bytearray()
    for name, t in sd.items():
        if name == "lm_head.weight":
            continue                       # tied to embed — kernel reuses embed
        arr = t.detach().float().numpy()
        rec = {"name": oracle_name(name), "shape": list(arr.shape), "offset": len(blob)}
        if arr.ndim == 2:                  # matmul weight -> int8 + per-row scale
            q, scale = quantize_rows(arr)
            rec["dtype"] = "int8"
            blob += scale.tobytes()        # nscale = shape[0] fp32 scales, then the int8 rows
            blob += q.tobytes()
        else:                              # norm weights (1D) -> fp16
            rec["dtype"] = "fp16"
            blob += arr.astype(np.float16).tobytes()
        rec["nbytes"] = len(blob) - rec["offset"]
        tensors.append(rec)

    header = json.dumps({"format": 1, "config": config, "tensors": tensors,
                         "wsize": len(blob)}).encode("utf-8")
    checksum = hashlib.sha256(bytes(blob)).digest()
    with open(out_path, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", len(header)))
        f.write(header)
        f.write(blob)
        f.write(checksum)

    n_int8 = sum(1 for t in tensors if t["dtype"] == "int8")
    print(f"exported {out_path}")
    print(f"  {config['n_layer']} layers, {config['vocab']} vocab, qk_norm={config['qk_norm']}")
    print(f"  {len(tensors)} tensors ({n_int8} int8, {len(tensors)-n_int8} fp16)")
    print(f"  file size: {os.path.getsize(out_path)/1e6:.1f} MB   (float was "
          f"~{sum(t.numel() for t in sd.values())*4/1e6:.0f} MB)")
    return out_path


def load_astrion(path):
    """Reference loader — reads the file back into {name: float array}. The C kernel
    mirrors exactly this: read header, seek per tensor, dequantize int8 by its scales.
    Also proves the format round-trips."""
    with open(path, "rb") as f:
        assert f.read(len(MAGIC)) == MAGIC, "not an Astrion model file"
        (hlen,) = struct.unpack("<I", f.read(4))
        header = json.loads(f.read(hlen))
        blob = f.read(header["wsize"])
        checksum = f.read(32)
    assert hashlib.sha256(blob).digest() == checksum, "checksum mismatch — file corrupt"
    out = {"config": header["config"]}
    for t in header["tensors"]:
        region = blob[t["offset"]:t["offset"] + t["nbytes"]]
        if t["dtype"] == "int8":
            rows = t["shape"][0]
            scale = np.frombuffer(region[:rows * 4], dtype=np.float32)
            q = np.frombuffer(region[rows * 4:], dtype=np.int8).reshape(t["shape"])
            out[t["name"]] = dequant_rows(q, scale)
        else:
            out[t["name"]] = np.frombuffer(region, dtype=np.float16).astype(np.float32).reshape(t["shape"])
    return out


def verify(ckpt_path, out_path):
    """Load the int8 file back into the model and confirm the logits barely moved."""
    from train import GPT
    ck = torch.load(ckpt_path, map_location="cpu")
    cfg = ck["cfg"]
    loaded = load_astrion(out_path)

    # rebuild a float state_dict from the dequantized int8 weights
    sd = {}
    inv = {oracle_name(k): k for k in ck["model"] if k != "lm_head.weight"}
    for oname, arr in loaded.items():
        if oname == "config":
            continue
        sd[inv[oname]] = torch.tensor(arr, dtype=torch.float32)
    sd["lm_head.weight"] = sd["embed.weight"]        # retie

    fp = GPT(cfg); fp.load_state_dict(ck["model"]); fp.eval()
    q = GPT(cfg); q.load_state_dict(sd); q.eval()

    x = torch.randint(0, min(cfg["vocab"], 50257), (1, 32))
    with torch.no_grad():
        lf = fp(x)[0].flatten()
        lq = q(x)[0].flatten()
    cos = torch.nn.functional.cosine_similarity(lf, lq, dim=0).item()
    rel = ((lq - lf).norm() / lf.norm()).item()
    print(f"  int8 vs float logits: cosine {cos:.5f} | relative error {rel*100:.2f}%")
    print("  " + ("OK — int8 Ember matches the float model." if cos > 0.99
                  else "WARNING — quantization moved the outputs more than expected."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="ember.pt")
    ap.add_argument("--out", default=None)
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    if not os.path.exists(args.ckpt):
        raise SystemExit(f"no checkpoint at {args.ckpt}. Train + fine-tune Ember first.")
    out = args.out or os.path.splitext(args.ckpt)[0] + ".astrion"
    export(args.ckpt, out)
    if args.verify:
        verify(args.ckpt, out)


if __name__ == "__main__":
    main()
