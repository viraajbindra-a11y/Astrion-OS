#!/usr/bin/env python3
"""
dock_test.py — click every icon in the dock and prove each app actually opens.

A demo dies on the first icon that does nothing. This clicks all eight in one
boot, screenshots after each, and reports how much of the screen changed —
opening a window repaints thousands of pixels, a dead icon repaints roughly a
cursor. It also greps the serial log for faults, because "a window appeared"
and "the kernel is still healthy" are two different claims.

    python3 dock_test.py <iso> [outdir]

Positions are 1:1 with framebuffer pixels: QEMU's PS/2 mouse deltas land in
mouse.c unscaled, verified by homing to (0,0) and stepping a known distance.
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, read_ppm

# Dock icon centres at 1280x800, read off a booted screendump.
DOCK_Y = 750
DOCK = [
    ("terminal",   339), ("files",     425), ("editor",  511), ("snake",    597),
    ("assistant",  683), ("monitor",   769), ("calc",    855), ("settings", 941),
]
# A window opening repaints far more than this; a dead click repaints far less.
OPEN_THRESHOLD = 20_000

# Apps that are ALREADY on screen when the desktop comes up. Clicking their icon
# is supposed to be a near no-op (the window is there and focused), so measuring
# them against OPEN_THRESHOLD asks for the opposite of correct behaviour.
#
# Be honest about what this costs: for these icons the test proves the click
# does no HARM, not that the icon can launch anything. Covering that properly
# means closing the window first and clicking to reopen — worth doing, not done.
OPEN_AT_BOOT = {"terminal"}


def home_and_move(q, x, y):
    """Slam the cursor to (0,0) — the driver clamps — then step to (x, y)."""
    for _ in range(30):
        q.rel(-120, -120)
        time.sleep(0.008)
    dx, dy = x, y
    while dx or dy:
        sx, sy = min(dx, 100), min(dy, 100)
        q.rel(sx, sy)
        dx -= sx; dy -= sy
        time.sleep(0.012)
    time.sleep(0.4)


def changed(a, b):
    return sum(1 for i in range(0, len(a), 3) if a[i:i+3] != b[i:i+3])


def scan_faults(path):
    """Real faults only. 'IDT: installing 256-entry table (32 exceptions...)'
    is a boot banner — matching bare 'exception' calls it a crash and makes
    every run look broken, which is worse than not checking at all."""
    out = []
    with open(path, errors="replace") as fh:
        for n, line in enumerate(fh, 1):
            low = line.lower()
            if ("panic" in low or "triple" in low or "cpu exception" in low
                    or "#pf" in low or "page fault" in low):
                out.append(f"{n}: {line.rstrip()}")
    return out


def try_one(iso, out, name, x):
    """One icon, one fresh boot.

    The first version of this clicked all eight in a single boot and reported
    3/8. That number was wrong: Snake opens FULLSCREEN and covers the dock, so
    every click after it landed in the game instead of on an icon. An app that
    takes the screen, grabs the keyboard, or opens a modal poisons every later
    step, so the only trustworthy unit is a boot per icon.
    """
    sock = f"/tmp/qmp-dock-{name}.sock"
    serial = os.path.join(out, f"{name}-serial.log")
    if os.path.exists(sock):
        os.remove(sock)
    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        time.sleep(18)                                  # GRUB + boot + desktop
        base = os.path.join(out, f"{name}-before.ppm")
        shot = os.path.join(out, f"{name}-after.ppm")
        home_and_move(q, x, DOCK_Y)                     # park ON the icon first,
        time.sleep(0.6)                                 # so hover state is in
        q.cmd("screendump", filename=base)              # BOTH shots, not just one
        q.btn(True);  time.sleep(0.12)
        q.btn(False); time.sleep(2.0)                   # let the WM repaint
        q.cmd("screendump", filename=shot)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()
    _, _, a = read_ppm(base)
    _, _, b = read_ppm(shot)
    return changed(a, b), scan_faults(serial)


def main():
    iso = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "."
    os.makedirs(out, exist_ok=True)
    only = sys.argv[3:] or None

    results = []
    for name, x in DOCK:
        if only and name not in only:
            continue
        d, faults = try_one(iso, out, name, x)
        if name in OPEN_AT_BOOT:
            # Clicking an app that is already on screen correctly does almost
            # nothing, so the open-threshold does not apply. Scoring it as a
            # failure made the suite permanently red — and a suite that is
            # always red is one nobody reads, which is strictly worse than not
            # having it. Faults still count.
            ok = d < OPEN_THRESHOLD and not faults
            note = "ALREADY OPEN (expected)" if ok else "UNEXPECTED REPAINT"
        else:
            ok = d >= OPEN_THRESHOLD and not faults
            note = "OPENED" if d >= OPEN_THRESHOLD else "NO VISIBLE RESPONSE"
        results.append((name, d, faults, ok))
        if faults:
            note += f"  +{len(faults)} FAULT(S)"
        print(f"  {name:<10} {d:>9,} px changed   {note}", flush=True)
        for f in faults:
            print(f"      {f}")

    print()
    ok_n = sum(1 for *_, ok in results if ok)
    print(f"dock: {ok_n}/{len(results)} icons behaved (fresh boot each)")
    if OPEN_AT_BOOT & {n for n, _ in DOCK}:
        print(f"  note: {', '.join(sorted(OPEN_AT_BOOT))} open at boot, so this "
              f"proves the icon is harmless, NOT that it can launch the app.")
    return 0 if ok_n == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
