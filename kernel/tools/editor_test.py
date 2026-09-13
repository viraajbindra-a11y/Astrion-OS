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

A DISK IS ATTACHED, and that is not a detail. This test ran with no `-drive`
at all, so `ata_present()` was false, fs_sync printed "no disk attached", and
the `cat` that "proved the save" read it straight back out of RAM — while
uitest.py's verdict line said "editing and saving really reaches the disk".
The chain it actually proved stopped at the in-memory filesystem. So now:
a fresh raw disk, the edit, then a SECOND BOOT off the same disk, and the
token must come back from a machine that was powered off in between — the
same shape reboot_test.py uses. Two controls keep it honest: the token must
be absent before the edit, and absent again on a blank disk (boot 3), so a
token baked into the ISO could never produce a pass.

    python3 editor_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot, QEMU_GUARD
from dock_test import scan_faults

# Not a word, so finding it after the save means it came off the disk. Lowercase
# and hyphens only — that is what type_text can send without modifier handling.
TOKEN = "saved-by-editor-krill"
FILE = "e.txt"

SETTLE = 1.3


def fresh_disk(path):
    """16 MiB of zeros. Same as reboot_test.py: a raw image IS just its bytes,
    so this needs no qemu-img."""
    if os.path.exists(path):
        os.remove(path)
    with open(path, "wb") as fh:
        fh.truncate(16 * 1024 * 1024)
    return path


def launch(iso, disk, serial, sock):
    for p in (sock, serial):
        if os.path.exists(p):
            os.remove(p)
    return subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso,
        "-drive", f"file={disk},format=raw,if=ide",
        "-m", "512", "-display", "none", *QEMU_GUARD,
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def read_back(iso, disk, serial, sock, label):
    """Boot, `cat` the file, power off. Returns the bytes `cat` produced."""
    qemu = launch(iso, disk, serial, sock)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        c0 = os.path.getsize(serial)
        q.type_text(f"cat {FILE}\n")
        time.sleep(SETTLE)
        c1 = os.path.getsize(serial)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()
    with open(serial, "rb") as fh:
        return fh.read()[c0:c1]


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-ed-{tag}.sock"
    serial = os.path.join(out, f"editor-{tag}-serial.log")
    shot = os.path.join(out, f"editor-{tag}.ppm")
    disk = os.path.join(out, f"editor-{tag}.disk")
    if os.path.exists(shot):
        os.remove(shot)
    fresh_disk(disk)

    qemu = launch(iso, disk, serial, sock)
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

        # 3. AFTER, still on the first boot. Same command, its own window.
        b0 = os.path.getsize(serial)
        q.type_text(f"cat {FILE}\n")
        time.sleep(SETTLE)
        b1 = os.path.getsize(serial)

        # 4. Push it to the platter. The editor's own save calls fs_sync, but
        #    saying so on serial is what tells "wrote to the disk" apart from
        #    "wrote to RAM and the disk was never there".
        s0 = os.path.getsize(serial)
        q.type_text("sync\n")
        time.sleep(SETTLE)
        s1 = os.path.getsize(serial)

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
    before, after, syncw = blob[a0:a1], blob[b0:b1], blob[s0:s1]
    tok = TOKEN.encode()

    # ── boot 2: the same disk, a machine that was powered off in between ──
    serial2 = os.path.join(out, f"editor-{tag}-boot2-serial.log")
    after_reboot = read_back(iso, disk, serial2, f"/tmp/qmp-ed-{tag}-2.sock", "boot2")

    # ── boot 3: a BLANK disk. The control for boot 2 — without it, a token
    #    baked into the ISO's seed filesystem would look like persistence.
    disk3 = os.path.join(out, f"editor-{tag}-blank.disk")
    fresh_disk(disk3)
    serial3 = os.path.join(out, f"editor-{tag}-boot3-serial.log")
    on_blank = read_back(iso, disk3, serial3, f"/tmp/qmp-ed-{tag}-3.sock", "boot3")

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
        print(f"[{tag}] [PASS] the editor's text survived save -> filesystem -> shell")
    else:
        print(f"[{tag}] [FAIL] {TOKEN!r} is not in {FILE} after ESC — the save "
              f"did not reach the filesystem")
        bad += 1

    # The disk has to actually BE there. Without this the two checks above pass
    # on a RAM-only filesystem, which is exactly what this test used to do.
    if b"no disk attached" in syncw:
        print(f"[{tag}] [FAIL] the kernel saw no disk — nothing here reaches a "
              f"platter and the reboot check below is meaningless")
        bad += 1
    elif b"saved to disk" in syncw:
        print(f"[{tag}] [PASS] sync reported writing to the disk")
    else:
        print(f"[{tag}] [FAIL] sync said neither 'saved to disk' nor 'no disk "
              f"attached': {syncw.decode(errors='replace').strip()[:160]!r}")
        bad += 1

    if tok in after_reboot:
        print(f"[{tag}] [PASS] and it came back after a full power cycle — the "
              f"save really reached the disk")
    else:
        print(f"[{tag}] [FAIL] {FILE} is gone after reboot: "
              f"{after_reboot.decode(errors='replace').strip()[:160]!r}")
        bad += 1

    if tok in on_blank:
        print(f"[{tag}] [FAIL] control: the token came back on a BLANK disk, so "
              f"the reboot check proved nothing")
        bad += 1
    else:
        print(f"[{tag}] [PASS] control: a blank disk really is blank")

    for label, log in (("boot1", serial), ("boot2", serial2), ("boot3", serial3)):
        for f in scan_faults(log):
            print(f"[{tag}] FAULT {label} {f}")
            bad += 1

    print(f"[{tag}] VERDICT: "
          f"{'CLEAN — the editor save reaches the disk and survives a power cycle' if not bad else f'{bad} FAILURE(S)'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
