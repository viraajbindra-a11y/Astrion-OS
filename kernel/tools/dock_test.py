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
from drag_test import Qmp, read_ppm, wait_for_boot, QEMU_GUARD, BOOT_MARKER

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


# Boot banners that TALK about faults. The kernel prints
#   "IDT: loaded - faults from here on panic visibly"
# which contains the word "panic" and made every test in the suite report a
# fault on a perfectly healthy boot. Same trap the docstring below already
# warns about for the word "exception"; the fix is to name the banner, not to
# stop looking for the word, because "panic" in any OTHER line is exactly what
# must be caught. A real panic prints "!!! KERNEL PANIC !!!" (src/idt.c:302),
# which matches none of these.
BANNERS = (
    "idt: installing",
    "idt: loaded",
)


def scan_faults(path):
    """Real faults only. 'IDT: installing 256-entry table (32 exceptions...)'
    is a boot banner — matching bare 'exception' calls it a crash and makes
    every run look broken, which is worse than not checking at all.

    Also counts the boot marker. A triple fault prints NOTHING — no panic, no
    #pf — the machine just resets and boots a fresh desktop, so a log that
    greps clean can still be a log of a crash. The one trace it leaves is a
    second 'TASKS: scheduler up'. Every launch now carries -no-reboot so the
    reset cannot happen at all (see drag_test.QEMU_GUARD); this is the
    backstop for the day somebody drops the flag."""
    out = []
    marker = BOOT_MARKER.decode()
    boots = 0
    with open(path, errors="replace") as fh:
        for n, line in enumerate(fh, 1):
            low = line.lower()
            if marker in line:
                boots += 1
                if boots > 1:
                    out.append(f"{n}: {line.rstrip()}   <- SECOND boot banner: "
                               f"the guest reset (triple fault?) and booted again")
            if any(b in low for b in BANNERS):
                continue                    # a line ABOUT faults, not a fault
            if ("panic" in low or "triple" in low or "cpu exception" in low
                    or "#pf" in low or "page fault" in low):
                out.append(f"{n}: {line.rstrip()}")
    if boots == 0:
        out.append(f"0: boot marker {marker!r} never printed — the kernel did "
                   f"not finish booting, so nothing after this was measured")
    return out


def opened_apps(path, start=0):
    """The apps wm.c says it opened, in order, from byte `start` of the log.

    Pixels cannot tell WHICH window appeared: clicking Files and getting the
    Calculator repaints just as much as clicking Files and getting Files, and
    scored OPENED. wm.c prints one line per open (see wm_log_open); this reads
    it, so the test checks the app and not just the paint."""
    with open(path, errors="replace") as fh:
        fh.seek(start)
        return [l.split("WM: open ", 1)[1].strip()
                for l in fh if "WM: open " in l]


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
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none", *QEMU_GUARD,
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        base = os.path.join(out, f"{name}-before.ppm")
        shot = os.path.join(out, f"{name}-after.ppm")
        home_and_move(q, x, DOCK_Y)                     # park ON the icon first,
        time.sleep(0.6)                                 # so hover state is in
        q.cmd("screendump", filename=base)              # BOTH shots, not just one
        mark = os.path.getsize(serial)                  # only THIS click's opens
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
    return changed(a, b), scan_faults(serial), opened_apps(serial, mark)


def main():
    iso = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "."
    os.makedirs(out, exist_ok=True)
    only = sys.argv[3:] or None
    # A filter that matches nothing must be an ERROR, not a pass. Without this
    # the loop below runs zero times, ok_n and len(results) are both 0, and the
    # script prints "0/0 icons behaved" and exits 0 - a green run that booted
    # nothing and clicked nothing. Found by calling this with the OLD argument
    # order (iso, tag, outdir), where the outdir landed in argv[3:] and became
    # an icon filter that matched no icon. One typo in a name would do the same.
    if only:
        known = {n for n, _ in DOCK}
        unknown = [n for n in only if n not in known]
        if unknown:
            print(f"dock: no such icon(s): {', '.join(unknown)}")
            print(f"dock: known icons are {', '.join(sorted(known))}")
            return 2

    results = []
    for name, x in DOCK:
        if only and name not in only:
            continue
        d, faults, opened = try_one(iso, out, name, x)
        # Which app did the click actually open? A repaint is not a name.
        right_app = opened == [name]
        if name in OPEN_AT_BOOT:
            # Clicking an app that is already on screen correctly does almost
            # nothing, so the open-threshold does not apply. Scoring it as a
            # failure made the suite permanently red — and a suite that is
            # always red is one nobody reads, which is strictly worse than not
            # having it. Faults still count.
            # Already on screen: the click must be near-harmless AND must
            # raise the app it belongs to, not some other one.
            ok = d < OPEN_THRESHOLD and not faults and right_app
            note = "ALREADY OPEN (expected)" if ok else "UNEXPECTED REPAINT"
        else:
            ok = d >= OPEN_THRESHOLD and not faults and right_app
            note = "OPENED" if d >= OPEN_THRESHOLD else "NO VISIBLE RESPONSE"
        if not right_app:
            note += ("  WRONG APP: wm said " + (", ".join(opened) if opened
                     else "nothing"))
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
