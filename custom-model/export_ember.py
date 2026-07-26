#!/usr/bin/env python3
"""
export_ember.py — turn a trained Ember into the single int8 file your Astrion
kernel loads. THIS is the bridge the two-track plan is built around: same engine,
swap the weight file.

  python export_ember.py                 # ember.pt        -> ember.astrion
  python export_ember.py --ckpt X --out Y

── WHY THIS IS NOW A THIN WRAPPER (2026-07-25) ──
An earlier version of this file wrote its own format: a JSON header plus a
per-ROW int8 quantization. Both are wrong for the kernel, in two ways that would
each have produced a ~340 MB file Astrion could not open:

  1. FORMAT. The kernel loader (kernel/src/model_load.c) has NO json parser —
     deliberately, because parsing untrusted JSON in a freestanding kernel is a
     memory-safety hole we refuse to add. It reads a binary format, magic "AMW1",
     whose every offset is derived from the config (nothing attacker-supplied to
     trust). A JSON-header ".astrion" file simply would not load.
  2. QUANTIZATION. The engine's matmul (q8.h) uses per-GROUP-of-64 int8 scales.
     This file used one scale per output row — coarser, and a different byte
     layout. The kernel would read the scales in the wrong places.

The correct converter already exists and is the ONE round-trip-tested through the
actual C engine: kernel/tools/mkweights.py (its --ckpt path). Its Ember
checkpoint->name mapping is byte-identical to the one this file used (both were
written independently and verified equal), so nothing Ember-specific is lost.
Rather than keep two converters that must agree forever, this delegates to that
one. One format, one code path, no drift — the same discipline the whole kernel
holds to.

Still UNVERIFIED end-to-end until a real ember.pt round-trips through the C
engine (mkweights.py --ckpt warns about this itself). That is the gate: train,
export here, then load the result on Astrion and confirm it runs.
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MKWEIGHTS = os.path.normpath(
    os.path.join(HERE, "..", "kernel", "tools", "mkweights.py"))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--ckpt", default="ember.pt",
                    help="the trained Ember checkpoint from custom-model/")
    ap.add_argument("--out", default=None,
                    help="output brain file (default: <ckpt stem>.astrion)")
    ap.add_argument("--verify", action="store_true",
                    help="accepted for compatibility; mkweights.py validates the "
                         "format itself, and the real quality check is running "
                         "Ember on Astrion")
    args = ap.parse_args()

    if not os.path.exists(args.ckpt):
        raise SystemExit(
            f"no checkpoint at {args.ckpt}. Train + fine-tune Ember first "
            "(see READY.md).")
    if not os.path.exists(MKWEIGHTS):
        raise SystemExit(f"cannot find the converter at {MKWEIGHTS}")

    out = args.out or (os.path.splitext(args.ckpt)[0] + ".astrion")
    cmd = [sys.executable, MKWEIGHTS, "--ckpt", args.ckpt, out]
    print("export_ember: delegating to mkweights.py — the AMW1 format the kernel "
          "actually loads")
    print("  " + " ".join(cmd))
    rc = subprocess.call(cmd)
    if rc == 0:
        print(f"\nwrote {out}  (AMW1, kernel-loadable). Load it on Astrion to "
              "confirm it runs — that is the real gate.")
    raise SystemExit(rc)


if __name__ == "__main__":
    main()
