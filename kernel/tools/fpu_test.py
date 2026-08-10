#!/usr/bin/env python3
"""
fpu_test.py — prove floating-point state survives a task switch.

THE BUG THIS EXISTS FOR
-----------------------
Until 2026-08-09, context_switch.S saved six general-purpose registers and
nothing else. No x87, no XMM. The kernel got away with it on an assumption
written into enable_sse(): "no other task uses XMM, so its registers survive
preemption without a context-switch save."

That was true, and it was true by discipline rather than by construction. The
whole kernel builds -mno-sse -mgeneral-regs-only so the compiler cannot emit
XMM by accident; src/gpt.c is the single exception, built -msse -msse2, and it
runs the Assistant's model. The moment a second task touched a float — another
model, a ring-3 program, one Makefile line edited by someone who had not read
the comment — the timer would preempt mid-arithmetic and XMM would come back
holding another task's numbers.

Nothing crashes. The Assistant just returns a wrong answer now and then, with
no fault and no log line, from the one component whose entire value is being
trusted. That is the worst shape a bug can have, and it is why this is checked
rather than reasoned about.

WHAT IT CHECKS
--------------
`fputest` in the shell spawns two tasks. Each stamps a distinct 64-bit pattern
into XMM0 and XMM15, yields 3000 times, and counts how often it comes back to
find someone else's bits in its own registers. XMM0 and XMM15 are the two ends
of the register file, so a partial save still shows up.

THE CONTROL — measured, not assumed
-----------------------------------
A gate that has never been seen to fail is not a gate. This one was run
against a kernel built with the fxsave/fxrstor pair deleted from
context_switch.S and nothing else changed:

    without the fix:  fpu-a 2999 / 3000, fpu-b 2999 / 3000  -> FAIL
    with the fix:     fpu-a    0 / 3000, fpu-b    0 / 3000  -> PASS

Near-total corruption, exactly as predicted: with two tasks alternating, every
single switch hands the other task's pattern back. The test is not subtle and
neither is the bug.

    python3 fpu_test.py <iso> <tag> [outdir]
"""
import os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot
from dock_test import scan_faults

SETTLE = 12.0     # 6000 yields plus the shell's own polling loop


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)
    sock = f"/tmp/qmp-fpu-{tag}.sock"
    serial = os.path.join(out, f"fpu-{tag}-serial.log")
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
        start = os.path.getsize(serial)
        q.type_text("fputest\n")
        time.sleep(SETTLE)
        end = os.path.getsize(serial)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    with open(serial, "rb") as fh:
        window = fh.read()[start:end]
    text = window.decode(errors="replace")
    print(f"[{tag}] fputest said:\n{text.strip()}\n")

    bad = 0
    for f in scan_faults(serial):
        print(f"[{tag}] FAULT {f}")
        bad += 1

    # The command must have RUN. Without this, a kernel where `fputest` is not
    # a command at all produces no PASS and no FAIL, and "PASS not found" would
    # read the same as a real failure while "FAIL not found" would read as a
    # pass. Anchor on the header line, which only the command itself prints.
    if "stamping xmm0 + xmm15" not in text:
        print(f"[{tag}] INCONCLUSIVE: fputest never ran — no header line in the "
              f"serial window. The command may not exist in this build.")
        return 2
    if "INCONCLUSIVE" in text:
        print(f"[{tag}] INCONCLUSIVE: a probe task never finished")
        return 2

    ok = "fputest: PASS" in text
    print(f"[{tag}] [{'PASS' if ok else 'FAIL'}] float state across task switches")
    if not ok:
        bad += 1

    print(f"[{tag}] VERDICT: "
          + ("CLEAN — xmm survives preemption" if not bad else f"{bad} FAILURE(S)"))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
