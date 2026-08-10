#!/usr/bin/env python3
"""
clip_test.py — nothing a window draws may land outside that window.

THE BUG
-------
The Assistant's prompt line drew as_prompt whole, starting at cx + GW + 6, with
nothing bounding it on the right. as_prompt holds 128 characters; the window is
not 128 characters wide. A long question ran off the right-hand edge and painted
glyphs onto the bare desktop.

What made it worse than ugly is the clear. assist_prompt_line() erases with
fb_rect_x(cx, py, cw, ...) — INSIDE the window only. Whatever escaped was never
erased by anything, so it sat on the wallpaper through every later prompt and
every repaint, until some window happened to cover it.

WHAT THIS CHECKS
----------------
Type a ~118-character prompt into the Assistant, and require that a band of
wallpaper well to the RIGHT of every window is pixel-identical before and after.
Not "mostly the same" — identical. A single stray glyph is a failure, because a
single stray glyph is exactly what the bug produces.

The band starts at x = BAND_X0, which is past the right edge of both the
Assistant (~1008) and the Terminal behind it (~1131). Everything in it is
wallpaper and nothing legitimate paints there, so any difference at all is
something that escaped a window.

Deliberately no Enter. The prompt is meant to still be sitting on the input line
when the screenshot is taken; submitting it would clear the line and hide the
very thing being measured.

CONTROL — measured, not assumed
-------------------------------
Run against the kernel from immediately before the fix, nothing else changed:

    without the fix:  853 of 59,800 px changed, spanning x 1020..1124,
                      y 235..256 — the prompt line's own row, straight across
                      the band and off the far edge of the screen
    with the fix:     0

The fix scrolls the field to keep the caret visible rather than truncating the
tail: truncating would also stop the overflow, and would leave the person typing
blind past column N — a different bug with the same screenshot. The "after"
screenshot was opened and looked at rather than trusted to the count: the line
reads "...er have and also what is the disk space and the cpu and the uptime and
the screen" with the caret at the right margin, entirely inside the window.

    python3 clip_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, read_ppm, wait_for_boot
from dock_test import DOCK_Y, DOCK, home_and_move, scan_faults

ASSIST_X = dict(DOCK)["assistant"]

# 118 characters, all typeable by type_text (lowercase + spaces). Long enough to
# overflow an ~860px window at the mono cell width, and phrased as something a
# person might genuinely ask so the failure is not a synthetic edge case.
LONG = ("how much memory does this computer have and also what is the disk "
        "space and the cpu and the uptime and the screen")

# The band starts just PAST the Assistant's right edge (~1008) and stops just
# short of the Terminal's (~1131), so it is a strip of the Terminal's own body
# lying beside the Assistant. Deliberately not "the far right of the screen":
# 118 mono glyphs starting near x=174 reach about x=1118, so text that escapes
# the Assistant lands HERE and would never have reached the screen edge. A band
# chosen for being obviously empty rather than for being where the bug lands is
# a band that measures nothing.
#
# Both edges are inset to clear the window shadows, which are static (nothing
# moves between the two shots) but are not worth arguing with.
BAND_X0, BAND_X1 = 1020, 1125
BAND_Y0, BAND_Y1 = 190, 420


def band_diff(a, b, w, h):
    out = []
    for y in range(BAND_Y0, min(BAND_Y1, h)):
        for x in range(BAND_X0, min(BAND_X1, w)):
            o = (y * w + x) * 3
            if a[o:o+3] != b[o:o+3]:
                out.append((x, y))
    return out


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-clip-{tag}.sock"
    serial = os.path.join(out, f"clip-{tag}-serial.log")
    p_a = os.path.join(out, f"clip-{tag}-0before.ppm")
    p_b = os.path.join(out, f"clip-{tag}-1after.ppm")
    for p in (sock, serial, p_a, p_b):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        home_and_move(q, ASSIST_X, DOCK_Y)
        q.btn(True);  time.sleep(0.15)
        q.btn(False); time.sleep(3.0)
        q.type_text("\n")            # absorb the dropped first keystroke
        time.sleep(0.8)
        home_and_move(q, 40, 400)    # park the cursor OUT of the band
        time.sleep(1.2)
        q.cmd("screendump", filename=p_a)
        time.sleep(0.6)

        start = os.path.getsize(serial)
        q.type_text(LONG)            # no Enter: leave it on the input line
        time.sleep(2.5)
        end = os.path.getsize(serial)
        home_and_move(q, 40, 400)
        time.sleep(1.2)
        q.cmd("screendump", filename=p_b)
        time.sleep(0.6)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    with open(serial, "rb") as fh:
        window = fh.read()[start:end]

    bad = 0
    for f in scan_faults(serial):
        print(f"[{tag}] FAULT {f}")
        bad += 1

    # Did the guest receive it? Without this, a run where the keystrokes never
    # arrived shows an unchanged band and passes having tested nothing — the
    # exact failure mode that made intent_live_test report 4/4 on a broken run.
    if LONG.encode() not in window:
        print(f"[{tag}] INCONCLUSIVE: the prompt never reached the guest — "
              f"serial held {window.decode(errors='replace').strip()[:80]!r}")
        return 2

    w, h, a = read_ppm(p_a)
    _, _, b = read_ppm(p_b)
    stray = band_diff(a, b, w, h)
    total = (min(BAND_Y1, h) - BAND_Y0) * (w - BAND_X0)
    print(f"[{tag}] wallpaper band x>={BAND_X0}, y {BAND_Y0}..{BAND_Y1}: "
          f"{len(stray):,} of {total:,} px changed")
    if stray:
        xs = [x for x, _ in stray]; ys = [y for _, y in stray]
        print(f"[{tag}] stray pixels span x {min(xs)}..{max(xs)}  y {min(ys)}..{max(ys)}")
        bad += 1

    print(f"[{tag}] VERDICT: "
          + ("CLEAN — the prompt stays inside its window" if not bad
             else "TEXT ESCAPED THE WINDOW"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
