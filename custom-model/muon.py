#!/usr/bin/env python3
"""
muon.py — the Muon optimizer. This is the single biggest reason the "best" model
learns faster than the plain one.

Muon = "MomentUm Orthogonalized by Newton-schulz". Normal optimizers (Adam) nudge
each weight on its own. Muon looks at a whole weight MATRIX's update and cleans it
up first: it makes all the directions equally strong (mathematically, it finds the
nearest matrix whose singular values are all ~1). That keeps any single direction
from dominating, and it turns out to reach the same quality in roughly HALF the
training — which, on one GPU over a weekend, is the difference between finishing
and not.

Two important rules:
  * Muon only works on the 2D "hidden" weight matrices (attention wq/wk/wv/wo and
    the MLP gate/up/down). Embeddings, the output head, and all the 1D norm
    weights are trained by a normal AdamW instead. split_muon_adamw_params() sorts
    them for you.
  * It's TRAINING-ONLY. It changes how the weights are *found*, never the model
    itself — so a model trained with Muon runs in your Astrion kernel with zero
    changes. Free lunch.

Reference: Keller Jordan's Muon (the modded-nanogpt speedrun optimizer). The three
Newton-Schulz coefficients below are tuned constants — changing them makes it blow
up, so don't.
"""
import torch


def zeropower_via_newtonschulz5(G, steps: int = 5, eps: float = 1e-7):
    """Return the nearest 'all-directions-equal' (semi-orthogonal) matrix to G.
    Five rounds of a fixed cubic-ish polynomial does it, all in bf16. G is 2D."""
    assert G.ndim == 2
    a, b, c = 3.4445, -4.7750, 2.0315          # tuned quintic coeffs — DO NOT CHANGE
    X = G.bfloat16()
    X = X / (X.norm() + eps)                    # scale so the biggest direction is <= 1
    transpose = G.size(0) > G.size(1)
    if transpose:                              # keep the smaller side in the inner products
        X = X.T
    for _ in range(steps):
        A = X @ X.T
        B = b * A + c * (A @ A)
        X = a * X + B @ X
    if transpose:
        X = X.T
    return X


def muon_update(grad, momentum_buf, beta=0.95, ns_steps=5, nesterov=True):
    """One Muon step for one matrix: momentum, then orthogonalize, then rescale."""
    momentum_buf.lerp_(grad, 1 - beta)                       # buf = beta*buf + (1-beta)*grad
    update = grad.lerp_(momentum_buf, beta) if nesterov else momentum_buf
    if update.ndim == 4:                                     # (conv filters -> 2D; unused here)
        update = update.view(len(update), -1)
    update = zeropower_via_newtonschulz5(update, steps=ns_steps)
    update *= max(1, update.size(-2) / update.size(-1)) ** 0.5   # aspect-ratio fix (goes with lr=0.02)
    return update


class SingleDeviceMuon(torch.optim.Optimizer):
    """Muon for one GPU. Feed it ONLY 2D hidden weight matrices."""
    def __init__(self, params, lr=0.02, weight_decay=0.0, momentum=0.95,
                 nesterov=True, ns_steps=5):
        defaults = dict(lr=lr, weight_decay=weight_decay, momentum=momentum,
                        nesterov=nesterov, ns_steps=ns_steps)
        super().__init__(params, defaults)

    @torch.no_grad()
    def step(self, closure=None):
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()
        for group in self.param_groups:
            for p in group["params"]:
                if p.grad is None:
                    continue
                st = self.state[p]
                if "momentum_buffer" not in st:
                    st["momentum_buffer"] = torch.zeros_like(p.grad)
                upd = muon_update(p.grad, st["momentum_buffer"],
                                  beta=group["momentum"], ns_steps=group["ns_steps"],
                                  nesterov=group["nesterov"])
                p.mul_(1 - group["lr"] * group["weight_decay"])     # decoupled weight decay
                p.add_(upd.reshape(p.shape), alpha=-group["lr"])
        return loss


def split_muon_adamw_params(model):
    """Muon for 2D hidden weights; AdamW for embeddings / lm_head / norms / biases.
    (Embeddings and the head are 2D too, but they MUST go to AdamW — so we exclude
    them by name, not just by shape.)"""
    muon, adamw = [], []
    for name, p in model.named_parameters():
        if not p.requires_grad:
            continue
        is_embed_or_head = any(k in name.lower()
                               for k in ("embed", "lm_head", "head", "wte", "wpe"))
        if p.ndim == 2 and not is_embed_or_head:
            muon.append(p)
        else:
            adamw.append(p)
    return muon, adamw
