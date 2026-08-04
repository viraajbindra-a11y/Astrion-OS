#!/usr/bin/env python3
"""
editor_test.py — type into the GUI editor, save, and prove the bytes really landed.

The Editor is the only app in Astrion holding unsaved state, which makes "did the
save actually happen" the one question about it worth asking. Nothing tested that.
dock_test proved the window opens; opening is the easy half.

This crosses every boundary in one run: keystrokes -> the editor's buffer ->
editor_save() -> fs_write + fs_sync -> the shell's `cat` -> the serial log. A pass
means the whole chain works. It needs no new mirror in the kernel, because the
verification comes out of the SHELL, which console.c already mirrors — checking
the editor's own painted text would only prove the editor can draw.

The control is built in rather than bolted on. The file is `cat`ed BEFORE the
edit, and the token must be ABSENT there. Without that, a token that was somehow
already on disk would make this pass while saving nothing — and the whole point
is to distinguish "saved" from "looked like it saved".

    python3 editor_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot
from dock_test import scan_faults

# Not a word, so finding it after the save means it came off the disk. Lowercase
# and hyphens only — that is what type_text can send without modifier handling.
TOKEN = "saved-by-editor-krill"
FILE = "e.txt"

SETTLE = 1.3


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-ed-{tag}.sock"
    serial = os.path.join(out, f"editor-{tag}-serial.log")
    shot = os.path.join(out, f"editor-{tag}.ppm")
    for p in (sock, serial, shot):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)

        # 1. BEFORE. Whatever `cat` says about a missing file, the token must
        #    not be in it. This is the control.
        a0 = os.path.getsize(serial)
        q.type_text(f"cat {FILE}\n")
        time.sleep(SETTLE)
        a1 = os.path.getsize(serial)

        # 2. Open the editor from the shell, type, and ESC to save + close.
        q.type_text(f"edit {FILE}\n")
        time.sleep(2.5)                         # window opens and paints
        q.type_text(TOKEN)
        time.sleep(0.6)
        q.key("esc")                            # editor_key: save + close
        time.sleep(2.5)                         # fs_write + fs_sync + repaint

        # 3. AFTER. Same command, its own window.
        b0 = os.path.getsize(serial)
        q.type_text(f"cat {FILE}\n")
        time.sleep(SETTLE)
        b1 = os.path.getsize(serial)

        time.sleep(0.8)
        q.cmd("screendump", filename=shot)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    with open(serial, "rb") as fh:              # bytes: spans are file offsets
        blob = fh.read()
    before, after = blob[a0:a1], blob[b0:b1]
    tok = TOKEN.encode()

    print(f"[{tag}] serial: {len(blob):,} bytes")
    print(f"[{tag}] before window ({a0:,}..{a1:,}): "
          f"{before.decode(errors='replace').strip()[:100]!r}")
    print(f"[{tag}] after  window ({b0:,}..{b1:,}): "
          f"{after.decode(errors='replace').strip()[:100]!r}")

    bad = 0
    if tok in before:
        print(f"[{tag}] [FAIL] control: {TOKEN!r} was ALREADY on disk before the "
              f"edit — this run proves nothing about saving")
        bad += 1
    else:
        print(f"[{tag}] [PASS] control: file did not contain the token beforehand")

    if tok in after:
        print(f"[{tag}] [PASS] the editor's text survived save -> disk -> shell")
    else:
        print(f"[{tag}] [FAIL] {TOKEN!r} is not in {FILE} after ESC — the save "
              f"did not reach the filesystem")
        bad += 1

    faults = scan_faults(serial)
    for f in faults:
        print(f"[{tag}] FAULT {f}")
    bad += len(faults)

    print(f"[{tag}] VERDICT: "
          f"{'CLEAN — editor saves for real' if not bad else f'{bad} FAILURE(S)'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
