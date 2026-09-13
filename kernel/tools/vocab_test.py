#!/usr/bin/env python3
"""
vocab_test.py — boot the real kernel with a tokenizer/brain pair and prove it
refuses a mismatched one and accepts a matched one.

The failure this guards: a tokenizer whose ids run past the brain's embedding
table. model_rt_generate() reduces every id into [0, vocab) so the lookup
cannot go out of bounds — which also means a 151k-id Qwen table in front of a
48-row test brain RUNS, and prints tokens, and every check in the suite stays
green while the output is nonsense the model never saw. The M7 test brain
prints gibberish by design, so no screenshot and no serial line could tell
"broken" from "expected". model_rt_init() now refuses the pair at boot with
one line naming both numbers; this boots three ISOs and reads that line.

    python3 vocab_test.py <kernel_mb2.elf> <tag> [outdir]

  boot 1  MISMATCH: a 300-id table in front of the 48-row oracle brain.
          Must print "MODEL: tokenizer/brain vocab mismatch - tokenizer has
          300 ids, brain vocab is 48 - generation disabled" and must NOT print
          "brain loaded". This is the case the old kernel accepted.
  boot 2  MATCH: the same 300-id table in front of a 512-row brain of the
          same shape. Must print "brain loaded" and no mismatch line — proves
          the check is <= and not ==, and that a right pair still works.
  boot 3  NO TOKENIZER: the oracle brain alone. Must print "brain loaded"
          (raw-byte fallback is always usable). Proves the check did not
          break the configuration every other test boots.

Everything is generated here from the checked-in tools (mkweights.py's blob
writer, mktok.py's table writer): no tiktoken, no network, no model. The
mismatch table is tiny — 256 byte tokens plus 44 extra ids — so the ISO builds
in seconds. Needs grub-mkrescue (i686-elf-grub-mkrescue on macOS).
"""
import os, shutil, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from drag_test import Qmp, wait_for_boot, QEMU_GUARD  # noqa: E402
from dock_test import scan_faults                     # noqa: E402
import mkweights                                      # noqa: E402
import mktok                                          # noqa: E402
import ref_forward as rf                              # noqa: E402

MISMATCH_LINE = "MODEL: tokenizer/brain vocab mismatch"
LOADED_LINE = "MODEL: brain loaded"


def grub_mkrescue():
    for name in ("i686-elf-grub-mkrescue", "grub-mkrescue"):
        p = shutil.which(name)
        if p:
            return p
    raise SystemExit("no grub-mkrescue on PATH (brew install i686-elf-grub on macOS)")


def make_brain(path, vocab, seed=7):
    """A brain of the oracle's shape (dim 32, 2 layers) with `vocab` rows."""
    cfg = dict(rf.CFG) if hasattr(rf, "CFG") else None
    if cfg is None:
        cfg = {"dim": 32, "n_layers": 2, "n_heads": 4, "n_kv_heads": 2, "head_dim": 8,
               "ffn_dim": 64, "rope_theta": 10000.0, "rms_eps": 1e-5, "qk_norm": False}
    cfg = dict(cfg)
    cfg["vocab"] = vocab
    w = rf.make_weights(cfg, seed=seed)
    config = mkweights.blob_config(cfg, 12)
    config["tok_kind"] = mkweights.TOK_KIND["unspec"]   # take the table's own kind
    blob = mkweights.emit_blob(config, w)
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


def make_table(path, n_tokens):
    """A byte-level table: 256 single-byte tokens, then filler ids, no merges."""
    assert n_tokens >= 256
    id_bytes = [bytes([i]) for i in range(256)]
    id_bytes += [b"<x%d>" % i for i in range(n_tokens - 256)]
    byte2id = list(range(256))
    real = sys.stdout
    sys.stdout = open(os.devnull, "w")           # write_table prints a summary
    try:
        mktok.write_table(path, mktok.KIND["gpt2"] if hasattr(mktok, "KIND") else 2,
                          n_tokens, id_bytes, [], byte2id)
    finally:
        sys.stdout.close()
        sys.stdout = real
    return os.path.getsize(path)


def build_iso(kernel, out, name, model=None, tok=None):
    root = os.path.join(out, name + "-iso")
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(os.path.join(root, "boot", "grub"))
    shutil.copy(kernel, os.path.join(root, "boot", "kernel_mb2.elf"))
    cfg = ["set timeout=0", "set default=0", 'menuentry "Astrion v2.0 (multiboot2)" {',
           "  multiboot2 /boot/kernel_mb2.elf"]
    for blob, label in ((model, "brain.astrion"), (tok, "tok.atk")):
        if blob:
            shutil.copy(blob, os.path.join(root, "boot", label))
            cfg.append("  module2 /boot/%s %s" % (label, label))
    cfg += ["  boot", "}"]
    with open(os.path.join(root, "boot", "grub", "grub.cfg"), "w") as f:
        f.write("\n".join(cfg) + "\n")
    iso = os.path.join(out, name + ".iso")
    subprocess.run([grub_mkrescue(), "-o", iso, root], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return iso


def boot(iso, out, name):
    sock = "/tmp/qmp-vocab-%s.sock" % name
    serial = os.path.join(out, name + "-serial.log")
    for p in (sock, serial):
        if os.path.exists(p):
            os.remove(p)
    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none", *QEMU_GUARD,
        "-serial", "file:" + serial, "-qmp", "unix:%s,server,nowait" % sock,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        time.sleep(0.5)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()
    with open(serial, errors="replace") as fh:
        return fh.read(), serial


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__.strip())
    kernel, tag = sys.argv[1], sys.argv[2]
    out = os.path.abspath(sys.argv[3] if len(sys.argv) > 3 else os.path.join(HERE, "..", "build", "vocab"))
    os.makedirs(out, exist_ok=True)
    if not os.path.exists(kernel):
        raise SystemExit("no kernel at %s — make CC=x86_64-elf-gcc LD=x86_64-elf-ld kernel-mb2" % kernel)

    small = os.path.join(out, "brain48.astrion")
    big = os.path.join(out, "brain512.astrion")
    table = os.path.join(out, "tok300.atk")
    print("[%s] brain 48 rows:  %d bytes" % (tag, make_brain(small, 48)))
    print("[%s] brain 512 rows: %d bytes" % (tag, make_brain(big, 512)))
    print("[%s] table 300 ids:  %d bytes" % (tag, make_table(table, 300)))

    runs = [
        ("mismatch", small, table, False),   # 300 ids > 48 rows -> refused
        ("match", big, table, True),         # 300 ids <= 512 rows -> loaded
        ("notok", small, None, True),        # no table -> loaded (raw bytes)
    ]
    failed = 0
    for name, model, tok, want_loaded in runs:
        iso = build_iso(kernel, out, "%s-%s" % (tag, name), model, tok)
        text, serial = boot(iso, out, "%s-%s" % (tag, name))
        mism = [l for l in text.splitlines() if MISMATCH_LINE in l]
        loaded = LOADED_LINE in text
        faults = scan_faults(serial)
        ok = (loaded == want_loaded) and (bool(mism) == (not want_loaded)) and not faults
        print("[%s] %-9s loaded=%-5s mismatch-line=%-5s faults=%d  %s"
              % (tag, name, loaded, bool(mism), len(faults), "PASS" if ok else "FAIL"))
        for l in mism:
            print("      " + l.strip())
        for f in faults:
            print("      " + f)
        if not ok:
            failed += 1
            print("      serial: " + serial)
    verdict = "CLEAN — mismatched pair refused, matched pair loaded" if not failed \
        else "BROKEN — %d of %d boots wrong" % (failed, len(runs))
    print("[%s] VERDICT: %s" % (tag, verdict))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
