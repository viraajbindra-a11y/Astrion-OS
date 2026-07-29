#!/usr/bin/env python3
"""
uitest.py — run every Astrion UI test against one ISO and print a verdict table.

The individual tests each boot QEMU, drive real input over QMP, and check a real
result. They were written one at a time while chasing specific bugs, which meant
running them meant remembering five command lines and five different argument
orders. A suite nobody runs is a suite that finds nothing.

    python3 uitest.py <iso> [outdir]

Exit code is the number of failing tests, so it drops straight into CI or a
`make` rule. Every test is run even after one fails: "the drag test broke" and
"everything broke" are different situations and you want to know which.

These are SLOW — each test boots a real kernel and dock_test boots eight times.
Budget ~10 minutes for the full sweep. That is the price of testing the actual
system instead of a mock of it.
"""
import os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))

# (script, extra args before outdir, what it proves). dock_test takes no tag.
TESTS = [
    ("term_test.py",        ["ui"], "shell commands answer correctly over serial"),
    ("assist_test.py",      ["ui"], "the Assistant answers correctly and admits ignorance"),
    ("editor_test.py",      ["ui"], "editing and saving really reaches the disk"),
    ("drag_test.py",        ["ui"], "dragging the mouse paints nothing"),
    ("wdrag_test.py",       ["ui"], "moving a window leaves no residue"),
    ("snake_clock_test.py", ["ui"], "the clock keeps off Snake's screen"),
    ("dock_test.py",        [],     "every dock icon opens its app"),
]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__.strip())
    iso = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "build", "uitest")
    out = os.path.abspath(out)
    os.makedirs(out, exist_ok=True)
    if not os.path.exists(iso):
        raise SystemExit(f"no ISO at {iso} — build one first:\n"
                         f"  make CC=x86_64-elf-gcc LD=x86_64-elf-ld kernel-mb2")

    print(f"astrion ui suite — {os.path.basename(iso)}  ->  {out}\n")
    results = []
    for script, extra, what in TESTS:
        cmd = [sys.executable, os.path.join(HERE, script), iso] + extra + [out]
        print(f"── {script} — {what}")
        t0 = time.time()
        p = subprocess.run(cmd, capture_output=True, text=True)
        dt = time.time() - t0
        # The verdict line is the summary; the rest is evidence for a failure.
        verdict = ""
        for line in p.stdout.splitlines():
            if "VERDICT" in line or "icons opened" in line:
                verdict = line.strip()
        if p.returncode != 0 and p.stdout.strip():
            print(p.stdout.rstrip())
        elif verdict:
            print(f"   {verdict}")
        if p.returncode != 0 and p.stderr.strip():
            print(f"   stderr: {p.stderr.strip()[:400]}")
        print(f"   [{'PASS' if p.returncode == 0 else 'FAIL'}] {dt:.0f}s\n")
        results.append((script, p.returncode, verdict, dt))

    print("─" * 68)
    failed = 0
    for script, rc, verdict, dt in results:
        mark = "PASS" if rc == 0 else f"FAIL(rc={rc})"
        print(f"  {mark:<12} {script:<22} {dt:>5.0f}s  {verdict[:60]}")
        if rc:
            failed += 1
    total = sum(dt for _, _, _, dt in results)
    print("─" * 68)
    print(f"  {len(results) - failed}/{len(results)} passed in {total/60:.1f} min")
    if failed:
        print(f"\n  Screenshots and serial logs are in {out} — LOOK at them before\n"
              f"  believing a number. Three separate false failures in this suite's\n"
              f"  history were measurement bugs, caught only by opening the image.")
    return failed


if __name__ == "__main__":
    sys.exit(main())
