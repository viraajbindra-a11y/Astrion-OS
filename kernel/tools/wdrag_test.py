#!/usr/bin/env python3
"""
wdrag_test.py — drag a window across the desktop and prove it leaves nothing
behind.

Every cursor/paint bug in this kernel has been the same shape: something
repaints, a cached copy of the old pixels goes stale, and the stale copy gets
stamped back down. Moving a window is the heaviest version of that — it
uncovers wallpaper AND whatever window was underneath.

The gate is a ROUND TRIP: open Files, drag it left, drag it straight back, and
demand the screen be pixel-identical to before the drags. Any smear, ghost
title bar, or torn edge is a mismatch, and the count is how bad it is.

Three earlier versions of this test compared against a pre-open baseline
instead, and all three reported bugs that were not there:

  1. a global bbox included the ticking clock and the dock, so the "window
     rect" was nearly the whole screen and the grab landed on the top bar;
  2. locating the top edge by "first wide row of changed pixels" picked the
     window's SHADOW, which is just as wide as the title bar;
  3. with the grab finally right, the 15% "residue" was Terminal's title bar
     rendering unfocused (Files now has focus) where the baseline had it
     focused — correct behaviour scored as a defect.

The round trip has none of those holes: focus does not change between the two
shots, so anything that differs is genuinely the window manager's fault.

    python3 wdrag_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, read_ppm, wait_for_boot
from dock_test import DOCK_Y, DOCK, home_and_move

FILES_X = dict(DOCK)["files"]
# Drag LEFT only, and not far. The window is ~860px wide on a 1280px screen,
# so a rightward or downward drag gets clamped by the WM against the screen
# edge or the dock — and then the vacated region I compute is not the region
# that was actually vacated, which silently invalidates the whole measurement.
DRAG_DX, DRAG_DY = -180, 0
TITLEBAR_DY = 30                  # measured: ~16px shadow + into the ~32px title bar

# The window lives between the top bar and the dock. Everything here is
# measured inside this band ONLY. The first version of this test took a global
# bbox and got x 130..1210, y 16..794 — nearly the whole screen — because the
# ticking clock and the dock's hover highlight are also "pixels that changed".
# That put the grab point at y=30, on the TOP BAR, so the drag grabbed nothing
# and the 34.65% "residue" it reported was pure measurement error.
BODY_TOP, BODY_BOT = 50, 700


def bbox(a, b, w, h):
    """Bounding box of differing pixels, restricted to the desktop body."""
    xs, ys = [], []
    for y in range(BODY_TOP, min(BODY_BOT, h)):
        row = y * w
        for x in range(w):
            o = (row + x) * 3
            if a[o:o+3] != b[o:o+3]:
                xs.append(x); ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-wdrag-{tag}.sock"
    serial = os.path.join(out, f"wdrag-{tag}-serial.log")
    p_base = os.path.join(out, f"wdrag-{tag}-0base.ppm")
    p_open = os.path.join(out, f"wdrag-{tag}-1open.ppm")
    p_move = os.path.join(out, f"wdrag-{tag}-2moved.ppm")
    p_back = os.path.join(out, f"wdrag-{tag}-3back.ppm")
    for p in (sock, p_base, p_open, p_move, p_back):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        # Park the cursor somewhere it will sit still for every shot, so the
        # sprite itself never shows up as a difference.
        home_and_move(q, 40, 400)
        time.sleep(1.0)
        q.cmd("screendump", filename=p_base)

        home_and_move(q, FILES_X, DOCK_Y)
        q.btn(True);  time.sleep(0.12)
        q.btn(False); time.sleep(2.0)
        home_and_move(q, 40, 400)                 # back to the same parking spot
        time.sleep(1.0)
        q.cmd("screendump", filename=p_open)

        w, h, base = read_ppm(p_base)
        _, _, opened = read_ppm(p_open)
        rect = bbox(base, opened, w, h)
        if not rect:
            print(f"[{tag}] Files never opened — nothing to drag")
            q.cmd("quit"); return 1
        x0, y0, x1, y1 = rect
        print(f"[{tag}] changed-region rect: x {x0}..{x1}  y {y0}..{y1}")

        # The bbox top is ~16px ABOVE the window's own top edge: the window
        # casts a soft shadow, and opening Files also unfocuses Terminal and
        # recolours its title bar. Two heuristics were tried and both missed —
        # "first row with a wide run of changed pixels" picks the shadow, which
        # spans the full window width just like the title bar does.
        #
        # So the offset is measured, not inferred. Shadow is ~16px, the title
        # bar is ~32px tall, so bbox-top + 30 lands solidly inside it. If the
        # chrome is ever restyled this needs remeasuring — and the
        # "window never moved" guard below is what makes that loud instead of
        # silently turning the test green.
        gx, gy = (x0 + x1) // 2, y0 + TITLEBAR_DY
        print(f"[{tag}] grabbing title bar at ({gx}, {gy})")

        def drag(from_x, from_y, dx):
            home_and_move(q, from_x, from_y)
            time.sleep(0.4)
            q.btn(True); time.sleep(0.2)
            for _ in range(20):                    # smooth drag, 20 steps
                q.rel(dx // 20, 0)
                time.sleep(0.04)
            time.sleep(0.3)
            q.btn(False); time.sleep(1.5)

        drag(gx, gy, DRAG_DX)                      # out...
        home_and_move(q, 40, 400)
        time.sleep(1.2)
        q.cmd("screendump", filename=p_move)       # kept for eyeballing
        drag(gx + DRAG_DX, gy, -DRAG_DX)           # ...and straight back
        home_and_move(q, 40, 400)
        time.sleep(1.5)
        q.cmd("screendump", filename=p_back)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    w, h, opened = read_ppm(p_open)
    _, _, moved = read_ppm(p_move)
    _, _, back = read_ppm(p_back)

    # Did the window ACTUALLY move? A grab that misses the title bar moves
    # nothing, and then "the screen is unchanged" is trivially true — the test
    # would go green having exercised nothing. Refuse to report a pass.
    if bbox(opened, moved, w, h) is None:
        print(f"[{tag}] INCONCLUSIVE: the window never moved — grab missed the title bar")
        return 2

    resid = [(x, y)
             for y in range(BODY_TOP, min(BODY_BOT, h))
             for x in range(w)
             if opened[(y*w+x)*3:(y*w+x)*3+3] != back[(y*w+x)*3:(y*w+x)*3+3]]
    total = w * (min(BODY_BOT, h) - BODY_TOP)
    print(f"[{tag}] round trip: {len(resid):,} of {total:,} body px differ "
          f"({100.0*len(resid)/total:.3f}%)")
    if resid:
        xs = [x for x, _ in resid]; ys = [y for _, y in resid]
        print(f"[{tag}] residue spans x {min(xs)}..{max(xs)}  y {min(ys)}..{max(ys)}")
    print(f"[{tag}] VERDICT: {'CLEAN — drag is lossless' if not resid else 'DRAG LEFT RESIDUE'}")
    return 0 if not resid else 1


if __name__ == "__main__":
    sys.exit(main())
