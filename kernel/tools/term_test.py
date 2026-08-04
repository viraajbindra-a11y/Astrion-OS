#!/usr/bin/env python3
"""
term_test.py — type real commands into Astrion's shell and check what it says.

Every other test in this directory measures PIXELS, because pixels were the only
output the kernel had. That makes them good at "something appeared" and bad at
"the right thing appeared" — a window full of the wrong text scores identically
to a window full of the right text.

console.c now mirrors every byte to COM1, so the shell's actual words land in
the serial log and a test can assert on them. This is the first test that does.

It also covers something the boot banner cannot. Boot-time console output goes
straight to the UART (see console_serial_async): synchronous, unbuffered, no
scheduler involved. Everything typed AFTERWARDS goes through the ring buffer and
console_service()'s drain on task 0. Those are two different code paths, and
only this one exercises the second — which is the one with a wrap-around, a
budget, and a drop counter in it.

    python3 term_test.py <iso> <tag> [outdir]

Run it against a kernel built before the mirror existed and it must FAIL with
every check missing: that is the control proving it reads the guest and not its
own expectations.
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot

# (command to type, string its OUTPUT must contain).
#
# Two rules, both learned by getting them wrong:
#
#   * `want` must not appear in its own command. The shell echoes what you type,
#     so `echo foo` -> "foo" passes on the echo alone even if the shell is dead.
#     That rules out testing `echo` this way at all, which is why it is gone.
#   * each check is matched only inside its OWN window of the log. The first
#     version searched the whole post-boot log, so `cat t.txt` -> "hello-from-qmp"
#     passed off the echo of the earlier `write t.txt hello-from-qmp` line. It
#     would have gone green with the filesystem entirely broken.
#
# Chosen to cover different producers rather than different commands: the
# version banner, the heap, the timer, a directory listing, and a write whose
# read-back can only succeed if the write really landed.
CHECKS = [
    ("version",                    "long mode"),
    ("uptime",                     "ticks,"),
    ("heap",                       "kernel heap:"),
    ("write t.txt hello-from-qmp", "wrote 14 bytes"),
    ("cat t.txt",                  "hello-from-qmp"),
    ("ls",                         "readme.txt"),
]

# The drain is budgeted at 256 bytes per main-loop pass (~10ms), so a command
# with a lot of output takes a few passes to fully appear. Everything here is
# small; a second is generous.
SETTLE = 1.2


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-term-{tag}.sock"
    serial = os.path.join(out, f"term-{tag}-serial.log")
    shot = os.path.join(out, f"term-{tag}.ppm")
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
        # Mark where boot output ends. Everything the checks look for must come
        # AFTER this, or a string that happened to appear in the boot banner
        # would score as a passing command.
        boot_bytes = os.path.getsize(serial) if os.path.exists(serial) else 0

        # Record where each command's output starts and ends so a check can be
        # matched against that command alone. Without this, any string produced
        # by ANY earlier command (including its own echoed text) counts.
        spans = []
        for cmd, _ in CHECKS:
            start = os.path.getsize(serial)
            q.type_text(cmd + "\n")
            time.sleep(SETTLE)
            spans.append((start, os.path.getsize(serial)))
        time.sleep(1.0)
        q.cmd("screendump", filename=shot)   # for eyeballing a failure
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    # BINARY, deliberately. The spans above come from os.path.getsize(), which
    # counts bytes on disk; reading in text mode turns every "\r\n" into "\n",
    # so the string is shorter than the file by one char per line and every
    # offset drifts. That silently slid each window a whole command late and
    # produced four confident failures against a kernel that was fine.
    with open(serial, "rb") as fh:
        blob = fh.read()
    post = blob[boot_bytes:]

    print(f"[{tag}] serial: {len(blob):,} bytes total, "
          f"{len(post):,} after boot ({boot_bytes:,} boot)")

    # A drop means the ring wrapped before task 0 drained it, and the log has a
    # hole. Say so loudly — a missing string after a silent drop is a test
    # artifact, not a kernel bug, and confusing the two wastes an afternoon.
    if b"[serial: dropped" in blob:
        for line in blob.splitlines():
            if b"[serial: dropped" in line:
                print(f"[{tag}] WARNING: {line.decode(errors='replace').strip()}")

    bad = 0
    for (cmd, want), (a, b) in zip(CHECKS, spans):
        # The typed command echoes too, so `want` must not be a substring of
        # `cmd` — otherwise the echo alone passes the check and the shell could
        # be doing nothing at all. Guard it rather than trusting the table.
        if want in cmd:
            print(f"[{tag}] BAD CHECK: {want!r} appears in the command {cmd!r} "
                  f"— its echo would pass this on its own")
            bad += 1
            continue
        window = blob[a:b]
        ok = want.encode() in window
        print(f"[{tag}] [{'PASS' if ok else 'FAIL'}] {cmd!r} -> {want!r} "
              f"(in bytes {a:,}..{b:,})")
        if not ok:
            bad += 1
            print(f"[{tag}]        window was: {window.decode(errors='replace').strip()[:140]!r}")

    if not post.strip():
        print(f"[{tag}] VERDICT: NO POST-BOOT SERIAL AT ALL — the ring/drain "
              f"path is dead (boot output alone does not exercise it)")
        return 1
    print(f"[{tag}] VERDICT: {'CLEAN — shell answers over serial' if not bad else f'{bad} CHECK(S) FAILED'}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
