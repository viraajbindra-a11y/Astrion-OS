#!/usr/bin/env python3
"""
intent_live_test.py — type the phrasings the probe said were BROKEN into a
booted Astrion, and check what actually comes back.

WHY THIS EXISTS AND intent_probe.c IS NOT ENOUGH
------------------------------------------------
tools/intent_probe.c measured Assistant coverage at 82.3% by running 147
phrasings through am_classify/am_action_of on the host. That number was real
and it found 19 sentences a person could type that Astrion dropped. But the
probe is an APPROXIMATION and says so in its own header: it runs two of the
routing layers, and wm.c's try_intent() has more of them. A phrase the probe
reports as routed can still reach a later layer that declines it.

That gap is not hypothetical here. `show me the monitor` routed to file.read in
the probe, and on a booted build it looked for a file called "monitor", found
none, and printed the honest menu. Same phrase, two different wrong answers,
and only the boot tells you which one the user sees.

So the probe measures the fix and this proves it. Coverage going 82.3% -> 99.3%
in a host binary is a claim about a header file. These are the sentences
arriving at a real Assistant in a real kernel and the real reply coming back
down the serial port.

WHAT MAKES A CHECK HONEST HERE
------------------------------
Three rules, all of them learned by getting them wrong in term_test.py and
assist_test.py:

  * The expected string must NOT appear in the prompt. Keystrokes echo to the
    serial port, so "does the log contain X" is satisfied by TYPING X.
  * Each check is matched only inside its own byte window. Without that, an
    earlier reply satisfies a later check and the suite goes green on one
    working intent and eleven broken ones.
  * Byte offsets, never text offsets. The spans come from getsize(); reading
    the log in text mode collapses every "\\r\\n" and every offset drifts.

And one control: `banana socks` must come back "didn't understand". If the
honest fallback ever passes as a match for something else, every PASS above it
is meaningless — so a green run with a broken control is reported as a failure
of the harness, not a pass of the kernel.

    python3 intent_live_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, read_ppm, wait_for_boot
from dock_test import DOCK_Y, DOCK, home_and_move, scan_faults

ASSIST_X = dict(DOCK)["assistant"]

# (prompt, marker that must appear in THIS prompt's serial window).
#
# Every prompt is one of the 26 the probe flagged, quoted exactly from
# tools/intent_corpus.tsv. Every marker is a distinctive run of the reply the
# intent produces — checked against src/wm.c, and checked against the prompt
# itself so the echo cannot satisfy it.
TEXT_CHECKS = [
    # identity. Two markers from the same reply rather than one used twice —
    # a shared marker would let one working route cover for a broken one.
    ("who am i talking to",        "Astrion's assistant"),
    ("what should i call you",     "no Linux under me"),
    # help. Same reply for both, so again: two different lines out of it.
    ("how do i use this",          "I run this machine"),
    ("show me what you can do",    "expect nonsense"),
    # tasks
    ("whats going on",             "task slots"),
    # clear
    ("clean this up",              "in the Terminal for that one"),
    # apps
    ("what can i run",             "there is no app store"),
    # files.list — three different ways of asking, one real listing back
    ("gimme my files",             "readme.txt"),
    ("whats on here",              "readme.txt"),
    ("list everything",            "readme.txt"),
    # settings.change
    ("make the accent purple",     "the whole desktop just repainted"),
    # file.write via "set X to Y"
    ("set notes.txt to hello",     "wrote to notes.txt"),
    # THE CONTROL. If this stops working every row above is unverifiable.
    ("banana socks",               "didn't understand"),
]

# Prompts whose whole effect is that a WINDOW OPENS. There is no reply text to
# grep for, so each is checked THREE ways and all three have to hold. The first
# version of this phase checked only "no shrug" plus "the screen changed", and
# it reported 4/4 PASS on a run where:
#
#   * `i want to use the editor` never reached the guest AT ALL — not one
#     character of it appears in the serial log;
#   * `bring up the settings` arrived as `ring up the settings`, lost its first
#     letter, and so was answered by the settings REPORT — which is not a shrug,
#     so "no shrug" passed it;
#   * `fire up snake` opened Snake FULLSCREEN, and the next check's "before"
#     shot was that fullscreen game, so its 1,023,995 changed pixels measured
#     LEAVING SNAKE rather than anything opening.
#
# Every one of those is the same disease: a signal that goes green for reasons
# unrelated to the thing under test. So:
#
#   1. THE PROMPT MUST ECHO BACK VERBATIM. Keystrokes mirror to the serial
#      port, so this proves the guest received the sentence being tested. Not
#      finding it is INCONCLUSIVE, never PASS — the test did not run.
#   2. NOTHING MAY FOLLOW THE ECHO. When try_intent opens an app it hands the
#      window over and emits no text at all, so the reply window holds only the
#      echo. Any reply text means something ELSE answered — which is exactly
#      what the settings report did.
#   3. THE SCREEN MUST CHANGE. Proves a window really appeared rather than the
#      prompt being silently swallowed.
#
# And each one gets its OWN QEMU BOOT. Sharing one boot is what let Snake's
# fullscreen exit, a changed accent, and a pending "learn" from the control
# prompt all leak into later checks. A fresh kernel per phrase costs ~45s and
# removes the entire class.
OPEN_CHECKS = [
    "show me the monitor",
    "fire up snake",
    "i want to use the editor",
    "bring up the settings",
    # The one line of the corpus this pass did NOT change the code for.
    # intent_corpus.tsv expected `open notes.txt` to be a file.read; the
    # matcher routes it to app.open, and wm.c then finds no app by that name
    # and opens the FILE in the Editor. That is the better answer, so the
    # expectation was wrong rather than the code — but "the code is right and
    # the corpus is wrong" is exactly the reasoning that turns a test suite
    # into a rubber stamp, so it is not asserted here, it is booted. readme.txt
    # because it is the file the ISO actually ships with.
    "open readme.txt",
]

# A window opening covers far more than this. Tuned low on purpose: the point
# is to separate "a window appeared" from "nothing happened", not to measure
# the window. The Assistant's own reply area repainting is a few thousand px.
OPEN_MIN_PX = 40_000

SETTLE = 2.2


def changed_px(a, b, w, h):
    n = 0
    for i in range(0, w * h * 3, 3):
        if a[i:i+3] != b[i:i+3]:
            n += 1
    return n


def boot(iso, tag, out, name):
    """Start a QEMU with its own serial log and QMP socket. Returns (proc, q,
    serial_path) with the kernel already booted."""
    sock = f"/tmp/qmp-intent-{tag}-{name}.sock"
    serial = os.path.join(out, f"intent-{tag}-{name}-serial.log")
    for p in (sock, serial):
        if os.path.exists(p):
            os.remove(p)
    proc = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    q = Qmp(sock)
    wait_for_boot(serial)
    return proc, q, serial


def open_assistant(q):
    """Click the Assistant dock icon and wait for it to be ready for typing.

    The settle is long and then a bare Return is sent before anything that
    matters. The first keystroke after a dock click gets dropped — `bring up
    the settings` arrived as `ring up the settings` and was answered by a
    different intent entirely, which passed a weaker check. A Return costs
    nothing (an empty prompt is ignored) and absorbs the loss."""
    home_and_move(q, ASSIST_X, DOCK_Y)
    q.btn(True);  time.sleep(0.15)
    q.btn(False); time.sleep(3.0)
    q.type_text("\n")
    time.sleep(0.8)


def one_open_check(iso, tag, out, i, prompt):
    proc, q, serial = boot(iso, tag, out, f"open{i}")
    before = os.path.join(out, f"intent-{tag}-open{i}-a.ppm")
    after  = os.path.join(out, f"intent-{tag}-open{i}-b.ppm")
    try:
        open_assistant(q)
        home_and_move(q, 40, 400)
        time.sleep(1.0)
        q.cmd("screendump", filename=before)
        time.sleep(0.6)

        start = os.path.getsize(serial)
        q.type_text(prompt + "\n")
        time.sleep(SETTLE + 1.0)
        end = os.path.getsize(serial)

        home_and_move(q, 40, 400)
        time.sleep(1.0)
        q.cmd("screendump", filename=after)
        time.sleep(0.6)
        q.cmd("quit")
    finally:
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    with open(serial, "rb") as fh:
        window = fh.read()[start:end]

    # 1. did the sentence under test actually arrive?
    echo = prompt.encode()
    if echo not in window:
        return ("INCONCLUSIVE", prompt,
                f"the guest never received it — serial holds "
                f"{window.decode(errors='replace').strip()[:80]!r}", serial)

    # 2. did anything ANSWER, instead of a window being handed over?
    tail = window.split(echo, 1)[1].strip()
    if tail:
        return ("FAIL", prompt,
                f"something replied instead of opening a window: "
                f"{tail.decode(errors='replace')[:120]!r}", serial)

    # 3. did a window actually appear?
    w, h, pa = read_ppm(before)
    _, _, pb = read_ppm(after)
    px = changed_px(pa, pb, w, h)
    if px < OPEN_MIN_PX:
        return ("FAIL", prompt,
                f"only {px:,} px changed, wanted >= {OPEN_MIN_PX:,} — "
                f"the prompt arrived, nothing answered, and nothing appeared",
                serial)
    return ("PASS", prompt,
            f"echoed verbatim, no reply text, {px:,} px changed", serial)


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    # ── phase 1: the intents that print a reply, all in one boot ──
    proc, q, serial = boot(iso, tag, out, "text")
    spans = []
    try:
        open_assistant(q)
        opened = os.path.getsize(serial)
        for prompt, _ in TEXT_CHECKS:
            start = os.path.getsize(serial)
            q.type_text(prompt + "\n")
            time.sleep(SETTLE)
            spans.append((start, os.path.getsize(serial)))
        time.sleep(1.0)
        q.cmd("screendump", filename=os.path.join(out, f"intent-{tag}-text.ppm"))
        q.cmd("quit")
    finally:
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    # ── phase 2: the window openers, one fresh kernel each ──
    open_results = [one_open_check(iso, tag, out, i, prompt)
                    for i, prompt in enumerate(OPEN_CHECKS)]

    with open(serial, "rb") as fh:
        blob = fh.read()
    post = blob[opened:]
    print(f"[{tag}] serial: {len(blob):,} bytes, {len(post):,} after the Assistant opened")

    faults = scan_faults(serial)
    for f in faults:
        print(f"[{tag}] FAULT {f}")

    bad = 0
    control_ok = None

    print(f"[{tag}] --- replies ---")
    for (prompt, want), (a, b) in zip(TEXT_CHECKS, spans):
        if want.lower() in prompt.lower():
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
                  f"{window.decode(errors='replace').strip()[:240]!r}")
        if prompt == "banana socks":
            control_ok = ok

    print(f"[{tag}] --- window opens (one fresh kernel each) ---")
    for verdict, prompt, why, log in open_results:
        print(f"[{tag}] [{verdict}] {prompt!r} -> {why}")
        if verdict != "PASS":
            bad += 1
        for f in scan_faults(log):
            print(f"[{tag}] FAULT {f}")
            bad += 1

    if control_ok is False:
        print(f"[{tag}] HARNESS BROKEN: the honest fallback did not come back for "
              f"nonsense. Every PASS above is unverifiable — a matcher that "
              f"claims everything would score 100% here.")
    if not post.strip():
        print(f"[{tag}] VERDICT: NOTHING FROM THE ASSISTANT AT ALL")
        return 1

    bad += len(faults)
    verdict = ("CLEAN — every phrasing the probe flagged now works on a real boot"
               if not bad else f"{bad} FAILURE(S)")
    print(f"[{tag}] VERDICT: {verdict}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
