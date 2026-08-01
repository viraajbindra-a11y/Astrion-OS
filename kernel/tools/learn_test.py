#!/usr/bin/env python3
"""
learn_test.py — teach the Assistant a phrasing, reboot, and prove it remembers.

The first piece of "the operating system that adapts". The claim is small and
exact: a wording that FAILED, followed by a wording that WORKED, teaches the
machine that the first meant the second — permanently.

Five steps, and the last two are the ones that make it mean anything:

  1. fresh disk. "gimme my files" must FAIL. (If it already worked, the whole
     run proves nothing — it would be the built-in matcher, not learning.)
  2. "show me the files" WORKS.
  3. "gimme my files" now WORKS. It learned.
  4. full power cycle, SAME disk. "gimme my files" still works — so the lesson
     is on the disk, not in RAM.
  5. full power cycle, BLANK disk. "gimme my files" FAILS again. Without this
     step, a kernel that simply understood the phrase all along would sail
     through every check above.

    python3 learn_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp
from dock_test import DOCK_Y, DOCK, home_and_move, scan_faults

ASSIST_X = dict(DOCK)["assistant"]

UNKNOWN = "gimme my files"          # verified to miss every intent
KNOWN = "show me the files"         # verified to hit the file-listing intent
PROOF = b"readme.txt"               # only the real listing contains this
FAILED = b"didn't understand"

SETTLE = 2.0


def session(iso, disk, serial, prompts, label):
    """One power cycle. Returns a list of (prompt, output-bytes) windows."""
    sock = f"/tmp/qmp-learn-{label}.sock"
    for p in (sock, serial):
        if os.path.exists(p):
            os.remove(p)
    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso,
        "-drive", f"file={disk},format=raw,if=ide",
        "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    spans = []
    try:
        q = Qmp(sock)
        time.sleep(18)
        home_and_move(q, ASSIST_X, DOCK_Y)
        q.btn(True);  time.sleep(0.12)
        q.btn(False); time.sleep(2.5)
        for p in prompts:
            a = os.path.getsize(serial)
            q.type_text(p + "\n")
            time.sleep(SETTLE)
            spans.append((p, a, os.path.getsize(serial)))
        time.sleep(1.0)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()
    with open(serial, "rb") as fh:          # bytes: spans are file offsets
        blob = fh.read()
    return [(p, blob[a:b]) for p, a, b in spans]


def fresh_disk(path):
    if os.path.exists(path):
        os.remove(path)
    with open(path, "wb") as fh:
        fh.truncate(16 * 1024 * 1024)
    return path


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    disk = os.path.join(out, f"learn-{tag}.disk")
    bad = 0

    def check(label, window, want, forbid=None):
        nonlocal bad
        ok = want in window and (forbid is None or forbid not in window)
        if not ok:
            bad += 1
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            print(f"         got: {window.decode(errors='replace').strip()[:150]!r}")

    # session() returns a LIST, not a dict, precisely so the two identical
    # UNKNOWN prompts stay distinct — the whole point is that the same words
    # behave differently before and after the lesson.
    print(f"[{tag}] boot 1 — fresh disk, teach it")
    fresh_disk(disk)
    windows = session(iso, disk, os.path.join(out, f"learn-{tag}-1.log"),
                      [UNKNOWN, KNOWN, UNKNOWN], f"{tag}1")
    check("control: unknown phrasing fails on a fresh machine", windows[0][1], FAILED)
    check("the known phrasing works",                            windows[1][1], PROOF)
    check("the unknown phrasing NOW works — it learned",         windows[2][1], PROOF, FAILED)

    print(f"[{tag}] boot 2 — power cycle, same disk")
    windows = session(iso, disk, os.path.join(out, f"learn-{tag}-2.log"),
                      [UNKNOWN], f"{tag}2")
    check("the lesson survived a full power cycle",              windows[0][1], PROOF, FAILED)

    print(f"[{tag}] boot 3 — power cycle, BLANK disk")
    fresh_disk(disk)
    windows = session(iso, disk, os.path.join(out, f"learn-{tag}-3.log"),
                      [UNKNOWN], f"{tag}3")
    check("control: blank disk forgets — so it really was learned",
          windows[0][1], FAILED)

    for n in (1, 2, 3):
        for f in scan_faults(os.path.join(out, f"learn-{tag}-{n}.log")):
            print(f"[{tag}] FAULT boot{n} {f}")
            bad += 1

    print(f"[{tag}] VERDICT: "
          f"{'CLEAN — it learns from you and remembers' if not bad else f'{bad} FAILURE(S)'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
