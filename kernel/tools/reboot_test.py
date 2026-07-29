#!/usr/bin/env python3
"""
reboot_test.py — write a file, power the machine off, boot it again, and prove
the file is still there.

"Your files survive a reboot" is one of the headline claims about this kernel and
nothing checked it. Worse, nothing COULD have: no make target and none of the
other tests ever attach a disk, so `ata_present()` is false in every run and the
filesystem is quietly RAM-only. `sync` even prints "no disk attached" and that is
not a failure anybody was watching for.

This runs the machine three times against the same ISO:

  boot 1  fresh disk. `cat` the file (must be ABSENT — proves the token is not
          baked into the ISO's built-in filesystem), then write it and `sync`.
  boot 2  SAME disk, nothing typed but a `cat`. The token must be there. This is
          the actual claim.
  boot 3  FRESH disk again. The token must be GONE. Without this, a kernel that
          ignored the disk entirely and kept the file somewhere in the ISO would
          sail through boot 2 — this is the control that tells persistence apart
          from "it was never really gone".

Each boot is a separate QEMU process with its own power cycle, not a soft reset,
so nothing survives in RAM between them.

    python3 reboot_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp
from dock_test import scan_faults

TOKEN = "persisted-across-reboot-lynx"
FILE = "p.txt"
SETTLE = 1.4


def boot(iso, disk, serial, cmds, label):
    """One full power cycle. Returns the bytes produced after the desktop is up."""
    sock = f"/tmp/qmp-reboot-{label}.sock"
    for p in (sock, serial):
        if os.path.exists(p):
            os.remove(p)
    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso,
        "-drive", f"file={disk},format=raw,if=ide",
        "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        time.sleep(18)
        start = os.path.getsize(serial)
        for c in cmds:
            q.type_text(c + "\n")
            time.sleep(SETTLE)
        time.sleep(1.0)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()
    with open(serial, "rb") as fh:          # bytes: offsets are file offsets
        return fh.read()[start:]


def fresh_disk(path):
    if os.path.exists(path):
        os.remove(path)
    # 16 MiB of zeros. qemu-img would do, but this needs no extra tool and a
    # raw image IS just its bytes.
    with open(path, "wb") as fh:
        fh.truncate(16 * 1024 * 1024)
    return path


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    disk = os.path.join(out, f"reboot-{tag}.disk")
    tok = TOKEN.encode()
    bad = 0

    fresh_disk(disk)
    w1 = boot(iso, disk, os.path.join(out, f"reboot-{tag}-1.log"),
              [f"cat {FILE}", f"write {FILE} {TOKEN}", "sync"], f"{tag}1")
    # `cat` runs before the write, so its output is in the first part of the
    # window; the write command's own echo contains the token, which is why the
    # absence check looks only at what precedes the write.
    pre = w1.split(f"write {FILE}".encode())[0]
    if tok in pre:
        print(f"[{tag}] [FAIL] control: {TOKEN!r} existed on a FRESH disk before "
              f"anything wrote it — the token is baked into the ISO")
        bad += 1
    else:
        print(f"[{tag}] [PASS] control: absent on a fresh disk before the write")
    if b"no disk attached" in w1:
        print(f"[{tag}] [FAIL] the kernel saw no disk — persistence cannot work "
              f"and every later check here is meaningless")
        bad += 1
    elif b"saved to disk" in w1:
        print(f"[{tag}] [PASS] sync reported writing to the disk")
    else:
        print(f"[{tag}] [FAIL] sync said neither 'saved to disk' nor 'no disk "
              f"attached': {w1.decode(errors='replace').strip()[:160]!r}")
        bad += 1

    w2 = boot(iso, disk, os.path.join(out, f"reboot-{tag}-2.log"),
              [f"cat {FILE}"], f"{tag}2")
    if tok in w2:
        print(f"[{tag}] [PASS] the file survived a full power cycle")
    else:
        print(f"[{tag}] [FAIL] {FILE} is gone after reboot: "
              f"{w2.decode(errors='replace').strip()[:160]!r}")
        bad += 1

    fresh_disk(disk)
    w3 = boot(iso, disk, os.path.join(out, f"reboot-{tag}-3.log"),
              [f"cat {FILE}"], f"{tag}3")
    if tok in w3:
        print(f"[{tag}] [FAIL] control: the token came back on a BLANK disk, so "
              f"boot 2 proved nothing about persistence")
        bad += 1
    else:
        print(f"[{tag}] [PASS] control: blank disk really is blank")

    for n, log in enumerate((f"reboot-{tag}-1.log", f"reboot-{tag}-2.log",
                             f"reboot-{tag}-3.log"), 1):
        for f in scan_faults(os.path.join(out, log)):
            print(f"[{tag}] FAULT boot{n} {f}")
            bad += 1

    print(f"[{tag}] VERDICT: "
          f"{'CLEAN — files really survive a reboot' if not bad else f'{bad} FAILURE(S)'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
