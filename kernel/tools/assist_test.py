#!/usr/bin/env python3
"""
assist_test.py — ask Astrion's Assistant real questions and check its answers.

The Assistant is the part of this OS anyone actually judges, and until now it was
the least tested thing in it. It paints its own text and never goes through
console.c, so dock_test could only say "a window appeared with SOMETHING in it".
A window showing a confident wrong answer scored exactly like a right one.

assist_emit() now mirrors to the serial port, so the replies land in the log and
this can check them. What it covers:

  * the machine intents (memory, version) — the Assistant reading real kernel
    state rather than reciting a canned string;
  * the file intents, as a round trip: write a distinctive word through the
    Assistant, then read it back. Passing means the Assistant really drove the
    filesystem, not that it printed a plausible sentence about doing so;
  * the fallback. Asking nonsense must produce the honest "I didn't understand"
    — an assistant that invents an answer to an unknown question is the single
    worst thing this could do in front of an audience, and it is a REGRESSION
    the other checks would never catch.

    python3 assist_test.py <iso> <tag> [outdir]

Same two rules as term_test.py, both learned by getting them wrong there:
the expected string must not appear in the prompt (the keystroke echo would
satisfy it on its own), and each check is matched only inside its own byte
window (or an earlier prompt's echo satisfies a later check).
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp
from dock_test import DOCK_Y, DOCK, home_and_move, scan_faults

ASSIST_X = dict(DOCK)["assistant"]

# The word written and read back. Deliberately not a real word: if it appears in
# the read-back window it can only have come out of the filesystem, and it types
# with the lowercase+hyphen qcodes type_text supports.
TOKEN = "zebra-quartz"

CHECKS = [
    ("how much memory",              "MiB usable"),
    ("what version",                 "no Linux under me"),
    ("list my files",                "readme.txt"),
    (f"write {TOKEN} to notes.txt",  "wrote to notes.txt"),
    ("read notes.txt",               TOKEN),          # <- the real round trip
    ("banana socks",                 "didn't understand"),
]

SETTLE = 2.0        # replies are longer than the shell's; the drain is budgeted


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-assist-{tag}.sock"
    serial = os.path.join(out, f"assist-{tag}-serial.log")
    shot = os.path.join(out, f"assist-{tag}.ppm")
    for p in (sock, serial, shot):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        time.sleep(18)
        home_and_move(q, ASSIST_X, DOCK_Y)
        q.btn(True);  time.sleep(0.12)
        q.btn(False); time.sleep(2.5)          # Assistant window paints

        opened = os.path.getsize(serial)
        spans = []
        for prompt, _ in CHECKS:
            start = os.path.getsize(serial)
            q.type_text(prompt + "\n")
            time.sleep(SETTLE)
            spans.append((start, os.path.getsize(serial)))
        time.sleep(1.0)
        q.cmd("screendump", filename=shot)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    # Bytes, not text: the spans come from getsize(), and text mode collapses
    # every "\r\n" so every offset would drift. (term_test.py learned this the
    # expensive way — four confident failures against a healthy kernel.)
    with open(serial, "rb") as fh:
        blob = fh.read()
    post = blob[opened:]
    print(f"[{tag}] serial: {len(blob):,} bytes, {len(post):,} after the window opened")

    faults = scan_faults(serial)
    for f in faults:
        print(f"[{tag}] FAULT {f}")

    bad = 0
    for (prompt, want), (a, b) in zip(CHECKS, spans):
        if want in prompt:
            print(f"[{tag}] BAD CHECK: {want!r} is inside the prompt {prompt!r} "
                  f"— the keystroke echo alone would pass it")
            bad += 1
            continue
        window = blob[a:b]
        ok = want.encode() in window
        print(f"[{tag}] [{'PASS' if ok else 'FAIL'}] {prompt!r} -> {want!r}")
        if not ok:
            bad += 1
            print(f"[{tag}]        window was: "
                  f"{window.decode(errors='replace').strip()[:160]!r}")

    if not post.strip():
        print(f"[{tag}] VERDICT: NOTHING FROM THE ASSISTANT AT ALL — either the "
              f"window never opened or assist_emit is not mirroring")
        return 1
    bad += len(faults)
    print(f"[{tag}] VERDICT: "
          f"{'CLEAN — the Assistant answers correctly' if not bad else f'{bad} FAILURE(S)'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
