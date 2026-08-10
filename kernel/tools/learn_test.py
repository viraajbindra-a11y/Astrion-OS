#!/usr/bin/env python3
"""
learn_test.py — teach the Assistant a phrasing, reboot, and prove it remembers.

The first piece of "the operating system that adapts". The claim is small and
exact: a wording that FAILED, followed by a wording that WORKED, teaches the
machine that the first meant the second — permanently.

Five steps, and the last two are the ones that make it mean anything:

  1. fresh disk. UNKNOWN must FAIL. (If it already worked, the whole run
     proves nothing — it would be the built-in matcher, not learning.)
  2. KNOWN works.
  3. UNKNOWN now works. It learned.
  4. full power cycle, SAME disk. UNKNOWN still works — so the lesson is on
     the disk, not in RAM.
  5. full power cycle, BLANK disk. UNKNOWN FAILS again. Without this step, a
     kernel that simply understood the phrase all along would sail through
     every check above.

CHOOSING UNKNOWN — this test broke once already
-----------------------------------------------
UNKNOWN was "gimme my files" until 2026-08-09, when a round of coverage work
taught the built-in matcher that exact phrase. Steps 1 and 5 are CONTROLS, and
controls fail loudly when the thing they are controlling for stops being true:
both reported FAIL, correctly, because the premise "this phrasing is unknown"
had quietly stopped holding. Nothing about the learning feature had changed.

That is the failure working as designed, and it will happen again to any
UNKNOWN that is a reasonable English way to ask for something — because
reasonable English phrasings are exactly what the coverage work keeps adding.

So UNKNOWN is now deliberately NOT reasonable English. It is one person's
private shorthand, which is the actual case this feature exists to serve: not
"a phrasing we forgot", but "the way YOU happen to say it". A matcher that
ever learns "filez plz" as a built-in has lost the plot, so this one should
stay unknown for good.

    python3 learn_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot
from dock_test import DOCK_Y, DOCK, home_and_move, scan_faults

ASSIST_X = dict(DOCK)["assistant"]

# Verified to miss every intent — checked with
#   printf 'filez plz\n' | ./build/intent_probe   ->   none
# and deliberately chosen as private shorthand, not as English. See the note
# in the docstring: the previous UNKNOWN was ordinary English and the coverage
# work eventually taught it, which turned both controls red.
UNKNOWN = "filez plz"
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
        wait_for_boot(serial)
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

    # ── boot 4: a lesson must never shadow a real answer ──
    #
    # rex found this and it is the worst thing the feature did. A lesson is
    # recorded when a prompt FAILS, and the justification for consulting the
    # book first was that nothing which already works could ever be in it. True
    # when written, and irrelevant: the machine changes underneath it. Teach a
    # lesson from "read thing" while thing.txt does not exist, then CREATE
    # thing.txt, and the Assistant confidently answered with the lesson instead
    # of the file — a wrong answer, delivered with a cheerful note explaining
    # that you had taught it.
    #
    # The fix is ordering, not a better comment: try what the prompt means
    # first, and only fall back to a lesson when nothing built in matched.
    print(f"[{tag}] boot 4 — a lesson must not shadow a real answer")
    fresh_disk(disk)
    windows = session(iso, disk, os.path.join(out, f"learn-{tag}-4.log"),
                      ["read thing",                     # fails: no thing.txt
                       KNOWN,                            # works -> teaches the pair
                       "write shadowcheck to thing.txt", # now it DOES exist
                       "read thing"],                    # must read the FILE
                      f"{tag}4")
    check("the lesson is taught while the file is missing", windows[1][1], PROOF)
    w = windows[3][1]
    if b"shadowcheck" in w and b"you taught me" not in w:
        print(f"[{tag}] [PASS] real answer wins once the file exists")
    else:
        bad += 1
        print(f"[{tag}] [FAIL] the lesson shadowed a real answer")
        print(f"         got: {w.decode(errors='replace').strip()[:170]!r}")

    for n in (1, 2, 3, 4):
        log = os.path.join(out, f"learn-{tag}-{n}.log")
        for f in scan_faults(log):
            print(f"[{tag}] FAULT boot{n} {f}")
            bad += 1
        # A dropped serial byte means the window this test just read had a hole
        # in it, so every check above was scored against an incomplete log. rex
        # forced one with 300 files and a listing; ordinary use is far under the
        # 4096-byte ring, but a silent hole would make a pass or a fail equally
        # meaningless and nothing was looking for it.
        with open(log, "rb") as fh:
            if b"[serial: dropped" in fh.read():
                print(f"[{tag}] INVALID boot{n}: serial ring dropped bytes — the "
                      f"log has a hole and no verdict from it can be trusted")
                bad += 1

    print(f"[{tag}] VERDICT: "
          f"{'CLEAN — it learns from you and remembers' if not bad else f'{bad} FAILURE(S)'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
