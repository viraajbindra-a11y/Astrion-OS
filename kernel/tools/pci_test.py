#!/usr/bin/env python3
"""
pci_test.py — prove Astrion sees the hardware that is actually plugged in.

The gate is a DIFFERENCE, not a presence. Booting once with a network card and
asserting "the log mentions ethernet" would pass just as well on a kernel that
prints the word unconditionally — and hardcoding a hopeful string is the exact
failure mode this project keeps finding in its own tests. So the same ISO is
booted TWICE, once with `-device e1000` and once without, and the two logs have
to DISAGREE in the right direction:

    with a NIC   -> a network controller in the device list, and a BAR
    without one  -> no network controller, and it says so

A kernel that always says yes fails run 2. A kernel that always says no fails
run 1. Only a kernel that is really reading config space passes both.

The device COUNT is checked the same way: adding a card must add a device. That
catches a scan that silently returns a fixed table, which "is ethernet in the
list" alone would not.

    python3 pci_test.py <iso> <tag> [outdir]
"""
import os, re, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import wait_for_boot
from dock_test import scan_faults


def boot(iso, serial, extra):
    """Boot once, wait for the scheduler, return the serial log as text."""
    if os.path.exists(serial):
        os.remove(serial)
    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}",
    ] + extra, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for_boot(serial)
        time.sleep(1.0)
    finally:
        qemu.terminate()
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()
    with open(serial, "rb") as fh:
        return fh.read().decode(errors="replace")


def devices(log):
    m = re.search(r"PCI: (\d+) device\(s\)", log)
    return int(m.group(1)) if m else -1


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)

    with_log = boot(iso, os.path.join(out, f"pci-{tag}-with.log"),
                    ["-netdev", "user,id=n0", "-device", "e1000,netdev=n0"])
    # "-nic none" is the explicit way to say NO card. Plain omission gives you
    # QEMU's DEFAULT nic, which for this machine type is an e1000 — so a test
    # that just left the flags off would boot two identical machines and
    # cheerfully report that the difference it was looking for was absent.
    without_log = boot(iso, os.path.join(out, f"pci-{tag}-without.log"),
                       ["-nic", "none"])

    n_with, n_without = devices(with_log), devices(without_log)
    print(f"[{tag}] devices seen: {n_without} without a NIC, {n_with} with one")

    bad = 0

    def check(ok, what):
        nonlocal bad
        print(f"[{tag}] [{'PASS' if ok else 'FAIL'}] {what}")
        if not ok:
            bad += 1

    check(n_with > 0 and n_without > 0, "the scan ran on both boots")
    check(n_with == n_without + 1,
          f"adding one card adds exactly one device ({n_without} -> {n_with})")
    check("network controller" in with_log,
          "with a NIC: a network controller is listed")
    check("network controller" not in without_log,
          "without one: no network controller is listed")

    m = re.search(r"PCI: ethernet controller at BAR0 (0x[0-9a-f]+)", with_log)
    check(bool(m) and int(m.group(1), 16) != 0,
          f"with a NIC: BAR0 is a real address ({m.group(1) if m else 'absent'})")
    check("PCI: no ethernet controller" in without_log,
          "without one: it says so rather than staying silent")

    for f in scan_faults(os.path.join(out, f"pci-{tag}-with.log")):
        print(f"[{tag}] FAULT {f}")
        bad += 1

    verdict = ("CLEAN - the scan reflects the hardware that is really there"
               if not bad else f"{bad} FAILURE(S)")
    print(f"[{tag}] VERDICT: {verdict}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
