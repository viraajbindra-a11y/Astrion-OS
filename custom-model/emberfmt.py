#!/usr/bin/env python3
"""
emberfmt.py — how Ember talks. Shared by finetune.py, chat.py, and readiness.py so
they all use the EXACT same conversation format (if they disagreed, a model trained
one way and prompted another would just produce garbage).

The format is deliberately plain text — no new special tokens to add to the
tokenizer. A conversation turn looks like:

    User: who are you?
    Ember: I'm Ember, a small AI built into Astrion OS.<eot>

At training time we show full turns and only teach Ember to produce the part after
"Ember:". At chat time we write "User: ...\nEmber:" and let it fill in the rest,
stopping at the <eot> (end-of-text) token.
"""
import torch

USER_TAG = "User:"
BOT_TAG = "Ember:"


def build_prompt(user_msg):
    """The text we feed the model; it continues from right after 'Ember:'."""
    return f"{USER_TAG} {user_msg}\n{BOT_TAG}"


def encode_example(enc, user_msg, bot_msg):
    """Tokenize one full training turn. Returns (token_ids, loss_mask) where the
    mask is 1 on the tokens Ember should learn to say (its reply + the end marker)
    and 0 on the prompt — so we train it to RESPOND, not to imitate the user."""
    prompt_ids = enc.encode_ordinary(build_prompt(user_msg))
    reply_ids = enc.encode_ordinary(" " + bot_msg) + [enc.eot_token]
    ids = prompt_ids + reply_ids
    mask = [0] * len(prompt_ids) + [1] * len(reply_ids)
    return ids, mask


@torch.no_grad()
def generate_reply(model, enc, device, user_msg, max_new=120, temp=0.7, top_k=40):
    """Ask Ember one question, return just its reply text (stops at <eot>)."""
    model.eval()
    prompt_ids = enc.encode_ordinary(build_prompt(user_msg))
    idx = torch.tensor([prompt_ids], device=device)
    out = model.generate(idx, max_new, temperature=temp, top_k=top_k)[0].tolist()
    gen = out[len(prompt_ids):]                      # only the newly written tokens
    if enc.eot_token in gen:
        gen = gen[:gen.index(enc.eot_token)]         # stop at the end-of-turn marker
    gen = [t for t in gen if t < enc.n_vocab]        # drop padding-vocab ids
    return enc.decode(gen).strip()
