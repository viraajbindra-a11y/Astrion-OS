#!/usr/bin/env python3
"""
shot.py — boot the ISO once and take a named screenshot after a scripted
sequence of clicks and keystrokes. A design tool, not a test: it exists so I
can LOOK at a screen instead of imagining it.

    python3 shot.py <iso> <outdir> <script>

<script> is a semicolon-separated program:
    click:X,Y      move to X,Y and click
    move:X,Y       move to X,Y (no click)
    type:text      type ASCII (lowercase; see QCODE in drag_test)
    key:qcode      one press+release of a raw qcode ('ret', 'esc', 'tab')
    wait:SECONDS   sleep
    shot:name      screendump to <outdir>/<name>.png

Everything is one boot, so ordering matters — a fullscreen app covers the dock.
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot


def home_and_move(q, x, y):
    for _ in range(30):
        q.rel(-120, -120)
        time.sleep(0.006)
    dx, dy = x, y
    while dx or dy:
        sx, sy = min(dx, 100), min(dy, 100)
        q.rel(sx, sy)
        dx -= sx; dy -= sy
        time.sleep(0.010)
    time.sleep(0.35)


def png(ppm):
    out = ppm[:-4] + ".png"
    subprocess.run(["sips", "-s", "format", "png", ppm, "--out", out],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                   check=True)
    os.remove(ppm)
    return out


def main():
    iso, outdir, script = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(outdir, exist_ok=True)
    tag = os.path.basename(outdir)
    sock = f"/tmp/qmp-shot-{tag}-{os.getpid()}.sock"
    serial = os.path.join(outdir, "serial.log")
    for p in (sock, serial):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        for step in script.split(";"):
            step = step.strip()
            if not step:
                continue
            op, _, arg = step.partition(":")
            if op in ("click", "move"):
                x, y = (int(v) for v in arg.split(","))
                home_and_move(q, x, y)
                if op == "click":
                    q.btn(True); time.sleep(0.12); q.btn(False)
                    time.sleep(0.9)
            elif op == "type":
                q.type_text(arg, delay=0.035)
            elif op == "key":
                q.key(arg); time.sleep(0.25)
            elif op == "wait":
                time.sleep(float(arg))
            elif op == "shot":
                ppm = os.path.join(outdir, arg + ".ppm")
                q.cmd("screendump", filename=ppm)
                time.sleep(0.7)
                print("wrote", png(ppm))
            else:
                raise SystemExit(f"shot.py: unknown step {step!r}")
    finally:
        qemu.terminate()
        try:
            qemu.wait(timeout=5)
        except subprocess.TimeoutExpired:
            qemu.kill()
        if os.path.exists(sock):
            os.remove(sock)


if __name__ == "__main__":
    main()
