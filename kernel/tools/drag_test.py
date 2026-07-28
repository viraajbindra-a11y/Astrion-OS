#!/usr/bin/env python3
"""
drag_test.py — drive a REAL left-button drag across Astrion's desktop in QEMU
and measure what the drag left behind on the wallpaper.

The claim under test: holding the left button and moving the mouse must not
paint anything. Run it against the pre-fix kernel and it must FAIL — that is
the control that proves this harness can see the bug at all.

    python3 drag_test.py <iso> <tag> [outdir]

Writes <tag>-before.ppm, <tag>-after.ppm and <tag>-serial.log into outdir (or
beside this script if you don't pass one) and prints a verdict line.
"""
import json, os, socket, subprocess, sys, time

ACCENT = (0x0A, 0x84, 0xFF)      # COL_ACCENT 0x0A84FF — the ink colour
CUR_W, CUR_H = 22, 36            # cursor footprint in real pixels (11x18 @ 2x)


class Qmp:
    def __init__(self, path):
        for _ in range(100):                     # qemu takes a moment to bind
            try:
                self.s = socket.socket(socket.AF_UNIX)
                self.s.connect(path)
                break
            except (FileNotFoundError, ConnectionRefusedError):
                time.sleep(0.1)
        else:
            raise SystemExit("could not connect to QMP socket")
        self.f = self.s.makefile("rw", encoding="utf-8", newline="\n")
        self.f.readline()                        # greeting
        self.cmd("qmp_capabilities")

    def cmd(self, name, **args):
        self.f.write(json.dumps({"execute": name, "arguments": args}) + "\n")
        self.f.flush()
        while True:                              # skip async events
            line = json.loads(self.f.readline())
            if "return" in line or "error" in line:
                if "error" in line:
                    raise SystemExit(f"QMP {name} failed: {line['error']}")
                return line["return"]

    def ev(self, *events):
        self.cmd("input-send-event", events=list(events))

    def rel(self, dx, dy):
        e = []
        if dx: e.append({"type": "rel", "data": {"axis": "x", "value": dx}})
        if dy: e.append({"type": "rel", "data": {"axis": "y", "value": dy}})
        if e: self.ev(*e)

    def btn(self, down):
        self.ev({"type": "btn", "data": {"down": down, "button": "left"}})

    def key(self, qcode):
        """One press+release of a QEMU qcode ('a', 'ret', 'esc', 'spc', ...)."""
        self.ev({"type": "key", "data": {"down": True,
                 "key": {"type": "qcode", "data": qcode}}})
        self.ev({"type": "key", "data": {"down": False,
                 "key": {"type": "qcode", "data": qcode}}})

    def type_text(self, s, delay=0.03):
        """Type an ASCII string into the guest, one qcode at a time.

        Lowercase only. Astrion's shell commands are all lowercase, and adding
        shift means holding a modifier ACROSS two events, which is a different
        (and easy to get subtly wrong) thing to get right — better to not
        pretend it works than to have it half-work. Unmapped characters raise
        rather than silently vanish: a test that types 'ecno' because 'h' fell
        out is worse than one that refuses to run."""
        for ch in s:
            code = QCODE.get(ch)
            if code is None:
                raise SystemExit(f"type_text: no qcode mapped for {ch!r}")
            self.key(code)
            time.sleep(delay)


# QEMU QKeyCode names. Enough for shell commands and file names; extend as
# tests need more, but keep it explicit — a wrong guess here types the wrong
# character and the failure looks like a kernel bug.
QCODE = {c: c for c in "abcdefghijklmnopqrstuvwxyz0123456789"}
QCODE.update({
    " ": "spc",    "\n": "ret",   "-": "minus",  ".": "dot",
    "/": "slash",  ",": "comma",  ";": "semicolon", "=": "equal",
    "'": "apostrophe",
})


def read_ppm(path):
    """Minimal binary-PPM (P6) reader -> (w, h, bytes). QEMU screendump emits P6."""
    with open(path, "rb") as fh:
        blob = fh.read()
    if not blob.startswith(b"P6"):
        raise SystemExit(f"{path}: not a P6 PPM")
    fields, i = [], 2
    while len(fields) < 3:                       # width, height, maxval
        while i < len(blob) and blob[i:i+1].isspace():
            i += 1
        if blob[i:i+1] == b"#":                  # comment line
            while blob[i:i+1] not in (b"\n", b""):
                i += 1
            continue
        j = i
        while j < len(blob) and not blob[j:j+1].isspace():
            j += 1
        fields.append(int(blob[i:j]))
        i = j
    i += 1                                       # single whitespace after maxval
    w, h, _ = fields
    return w, h, blob[i:i + w * h * 3]


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    # Third arg is an output directory, matching every other test here. This
    # used to always write beside the script, so a run left .ppm and .log files
    # loose in tools/ and `git status` came back dirty every single time — which
    # trains you to ignore it, which is how a real stray file gets committed.
    here = sys.argv[3] if len(sys.argv) > 3 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(here, exist_ok=True)
    sock = f"/tmp/qmp-{tag}.sock"
    before = os.path.join(here, f"{tag}-before.ppm")
    after = os.path.join(here, f"{tag}-after.ppm")
    serial = os.path.join(here, f"{tag}-serial.log")
    for p in (sock, before, after):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        q = Qmp(sock)
        time.sleep(18)                           # GRUB + boot + desktop paint

        # Home the cursor at (0,0) — the driver clamps, so oversending is safe.
        for _ in range(30):
            q.rel(-120, -120)
            time.sleep(0.01)
        # Park it in open wallpaper, below the top bar and above the dock.
        for _ in range(12):
            q.rel(12, 12)
            time.sleep(0.02)
        time.sleep(1.5)
        q.cmd("screendump", filename=before)

        # THE DRAG: press, sweep right and down across blank desktop, release.
        q.btn(True)
        time.sleep(0.2)
        for _ in range(36):
            q.rel(14, 7)
            time.sleep(0.03)
        time.sleep(0.2)
        q.btn(False)
        time.sleep(0.3)

        # Walk the cursor off the path so its own sprite can't be counted as ink.
        for _ in range(14):
            q.rel(-6, 14)
            time.sleep(0.03)
        time.sleep(1.5)
        q.cmd("screendump", filename=after)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    bw, bh, bpix = read_ppm(before)
    aw, ah, apix = read_ppm(after)
    if (bw, bh) != (aw, ah):
        raise SystemExit("screendump size changed between shots")

    # Ink = a pixel that BECAME accent-coloured across the drag. Comparing to
    # `before` is what excludes the static accent chrome (dock, top bar).
    ink = []
    for idx in range(bw * bh):
        o = idx * 3
        if tuple(apix[o:o+3]) == ACCENT and tuple(bpix[o:o+3]) != ACCENT:
            ink.append((idx % bw, idx // bw))

    # The live cursor is drawn white when the button is up, so it should not
    # register — but subtract its footprint anyway so a stray accent pixel in
    # the sprite can never be mistaken for ink.
    if ink:
        cx = min(x for x, _ in ink)
        cy = min(y for _, y in ink)
        ink = [(x, y) for x, y in ink
               if not (cx <= x < cx + CUR_W and cy <= y < cy + CUR_H)]

    print(f"[{tag}] {bw}x{bh}  ink pixels left by the drag: {len(ink)}")
    if ink:
        xs = [x for x, _ in ink]; ys = [y for _, y in ink]
        print(f"[{tag}] trail spans x {min(xs)}..{max(xs)}, y {min(ys)}..{max(ys)}")
    print(f"[{tag}] VERDICT: {'CLEAN (no paint)' if not ink else 'PAINTED — drag left a trail'}")
    return 0 if not ink else 1


if __name__ == "__main__":
    sys.exit(main())
