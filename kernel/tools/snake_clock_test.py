#!/usr/bin/env python3
"""
snake_clock_test.py — prove the clock task stops painting while Snake owns
the whole screen.

Snake blocks task 0 for its entire run, so nothing repairs damage from other
tasks. The clock task repaints the top bar every 250ms regardless, and used to
stamp a black band straight over Snake's SCORE.

The test: open Snake, wait long enough for several clock ticks, and count
pixels in the top-bar band that change between two shots taken 4+ seconds
apart. In a healthy build the game's own animation is nowhere near the band,
so the band must be perfectly still. Run against the pre-fix kernel and it
must FAIL.

    python3 snake_clock_test.py <iso> <tag>
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, read_ppm, wait_for_boot
from dock_test import DOCK_Y, DOCK, home_and_move

SNAKE_X = dict(DOCK)["snake"]
BAND_TOP, BAND_BOT = 0, 46          # the top bar the clock paints into


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-snake-{tag}.sock"
    serial = os.path.join(out, f"snake-{tag}-serial.log")
    a_path = os.path.join(out, f"snake-{tag}-t0.ppm")
    b_path = os.path.join(out, f"snake-{tag}-t1.ppm")
    c_path = os.path.join(out, f"snake-{tag}-after-esc0.ppm")
    d_path = os.path.join(out, f"snake-{tag}-after-esc1.ppm")
    for p in (sock, a_path, b_path, c_path, d_path):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        home_and_move(q, SNAKE_X, DOCK_Y)
        q.btn(True);  time.sleep(0.12)
        q.btn(False); time.sleep(3.0)          # Snake paints its board
        q.cmd("screendump", filename=a_path)
        time.sleep(5.0)                        # ~20 clock ticks go by
        q.cmd("screendump", filename=b_path)

        # ESC out and prove the clock RESUMES. Suppressing a painter is only
        # half a fix — if the flag were left raised the clock would be dead for
        # the rest of the session, which is worse than the bug it replaced.
        q.ev({"type": "key", "data": {"down": True,
              "key": {"type": "qcode", "data": "esc"}}})
        q.ev({"type": "key", "data": {"down": False,
              "key": {"type": "qcode", "data": "esc"}}})
        time.sleep(3.0)                        # desktop repaint settles
        q.cmd("screendump", filename=c_path)
        time.sleep(3.0)                        # the clock should tick again
        q.cmd("screendump", filename=d_path)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    def band_diff(p, q):
        w, h, x_ = read_ppm(p)
        _, _, y_ = read_ppm(q)
        n = 0
        for row in range(BAND_TOP, min(BAND_BOT, h)):
            for col in range(w):
                o = (row * w + col) * 3
                if x_[o:o+3] != y_[o:o+3]:
                    n += 1
        return n

    during = band_diff(a_path, b_path)
    after = band_diff(c_path, d_path)
    print(f"[{tag}] band pixels changing WHILE Snake ran:  {during}   (want 0)")
    print(f"[{tag}] band pixels changing AFTER ESC:        {after}   (want > 0)")
    ok = during == 0 and after > 0
    if during:
        why = "CLOCK PAINTED OVER SNAKE"
    elif not after:
        why = "CLOCK NEVER RESUMED — flag left raised"
    else:
        why = "CLEAN — clock held off during, resumed after"
    print(f"[{tag}] VERDICT: {why}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
