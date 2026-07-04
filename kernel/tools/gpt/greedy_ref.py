#!/usr/bin/env python3
"""numpy greedy reference (float32) from gpt_ckpt.npz, matching host_test.c's
greedy decode from a newline. Prints 60 chars, newlines shown as '#'."""
import numpy as np, math

ck = np.load("gpt_ckpt.npz", allow_pickle=True)
chars = str(ck["_chars"]); V = len(chars)
P = {k: ck[k].astype(np.float32) for k in ck.files if k != "_chars"}
C = P["wpe"].shape[1]; NL = sum(1 for k in P if k.startswith("qkv_w"))
stoi = {c: i for i, c in enumerate(chars)}

def ln(x, g, b):
    mu = x.mean(); xc = x - mu; var = (xc*xc).mean()
    return (xc / math.sqrt(var + 1e-5)) * g + b

def forward(seq):
    T = len(seq)
    x = np.stack([P["wte"][s] + P["wpe"][i] for i, s in enumerate(seq)])  # (T,C)
    scale = 1.0 / math.sqrt(C)
    for l in range(NL):
        a = np.stack([ln(x[i], P[f"ln1_g{l}"], P[f"ln1_b{l}"]) for i in range(T)])
        qkv = a @ P[f"qkv_w{l}"] + P[f"qkv_b{l}"]
        q, k, v = qkv[:, :C], qkv[:, C:2*C], qkv[:, 2*C:]
        att = (q @ k.T) * scale
        i_ = np.arange(T)
        att[i_[:, None] < i_[None, :]] = -1e30
        att = att - att.max(1, keepdims=True)
        e = np.exp(att); p = e / e.sum(1, keepdims=True)
        y = p @ v
        x = x + (y @ P[f"proj_w{l}"] + P[f"proj_b{l}"])
        h = np.stack([ln(x[i], P[f"ln2_g{l}"], P[f"ln2_b{l}"]) for i in range(T)])
        fc = np.maximum(h @ P[f"fc_w{l}"] + P[f"fc_b{l}"], 0)
        x = x + (fc @ P[f"mproj_w{l}"] + P[f"mproj_b{l}"])
    xf = ln(x[-1], P["lnf_g"], P["lnf_b"])
    return xf @ P["head_w"] + P["head_b"]

seq = [stoi["\n"]]
out = ""
for _ in range(60):
    logits = forward(seq[-64:])
    t = int(np.argmax(logits))
    out += "#" if chars[t] == "\n" else chars[t]
    seq.append(t)
print(out)
