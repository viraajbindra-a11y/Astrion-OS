#!/usr/bin/env python3
"""
net_test.py — prove Astrion really put a packet on a wire and really read the
answer off it.

WHY THE PCAP
------------
Every other test in this directory reads what the kernel SAYS. That is fine
when the kernel is reporting its own memory or its own file list, because it is
the only witness there is. Networking has a second witness: QEMU's
`filter-dump` writes every frame crossing the virtual wire to a pcap, from
outside the guest, and the guest cannot write to it or read it.

So the gate is not "the shell printed a MAC address". A kernel with a hardcoded
printf passes that. The gate is that the capture contains:

  * an ARP REQUEST whose source MAC is the one the driver reported, sent to
    broadcast, asking about the address we asked about;
  * an ARP REPLY back, from the address we asked about;
  * and the MAC in that reply is the MAC the shell printed.

The last one is the join. It ties what the kernel said to what physically
crossed the wire, and no amount of hardcoding inside the guest can satisfy it —
the reply's sender MAC is chosen by QEMU, not by us.

The negative control is a second boot with `-nic none`: same ISO, no card, and
the kernel has to say so rather than printing a plausible MAC anyway.

    python3 net_test.py <iso> <tag> [outdir]
"""
import os, re, struct, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drag_test import Qmp, wait_for_boot
from dock_test import scan_faults

GATEWAY = "10.0.2.2"          # QEMU user-mode network always presents this


def read_pcap(path):
    """Yield raw frames. Handles both endiannesses; QEMU writes host order."""
    with open(path, "rb") as fh:
        blob = fh.read()
    if len(blob) < 24:
        return []
    magic = struct.unpack("<I", blob[:4])[0]
    end = "<" if magic in (0xA1B2C3D4, 0xA1B23C4D) else ">"
    out, off = [], 24
    while off + 16 <= len(blob):
        _, _, incl, _ = struct.unpack(end + "IIII", blob[off:off + 16])
        off += 16
        # A truncated final record is normal — QEMU was killed mid-write. Stop
        # rather than yielding a short frame that would parse as garbage.
        if off + incl > len(blob):
            break
        out.append(blob[off:off + incl])
        off += incl
    return out


def arp(frame):
    """(op, sender_mac, sender_ip, target_mac, target_ip) or None."""
    if len(frame) < 42 or struct.unpack(">H", frame[12:14])[0] != 0x0806:
        return None
    a = frame[14:42]
    return (struct.unpack(">H", a[6:8])[0],
            ":".join(f"{b:02x}" for b in a[8:14]),
            ".".join(str(b) for b in a[14:18]),
            ":".join(f"{b:02x}" for b in a[18:24]),
            ".".join(str(b) for b in a[24:28]))


def boot_and_probe(iso, tag, out):
    """Boot with a NIC and a capture, run `net arp`, return (shell text, pcap)."""
    sock = f"/tmp/qmp-net-{tag}.sock"
    serial = os.path.join(out, f"net-{tag}-serial.log")
    pcap = os.path.join(out, f"net-{tag}.pcap")
    for p in (sock, serial, pcap):
        if os.path.exists(p):
            os.remove(p)

    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-qmp", f"unix:{sock},server,nowait",
        "-netdev", "user,id=n0", "-device", "e1000,netdev=n0",
        "-object", f"filter-dump,id=d0,netdev=n0,file={pcap}",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        q = Qmp(sock)
        wait_for_boot(serial)
        start = os.path.getsize(serial)
        q.type_text(f"net arp {GATEWAY}\n")
        time.sleep(3.0)
        end = os.path.getsize(serial)
        q.cmd("quit")
    finally:
        try:
            qemu.wait(timeout=10)
        except subprocess.TimeoutExpired:
            qemu.kill()

    with open(serial, "rb") as fh:
        blob = fh.read()
    return blob.decode(errors="replace"), blob[start:end].decode(errors="replace"), pcap, serial


def boot_no_nic(iso, tag, out):
    """Same ISO, no card. `-nic none` is explicit: omitting the flags gives you
    QEMU's DEFAULT nic, so a test that just left them off would boot two
    identical machines and report the difference as absent."""
    serial = os.path.join(out, f"net-{tag}-nonic.log")
    if os.path.exists(serial):
        os.remove(serial)
    qemu = subprocess.Popen([
        "qemu-system-x86_64", "-cdrom", iso, "-m", "512", "-display", "none",
        "-serial", f"file:{serial}", "-nic", "none",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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


def main():
    iso, tag = sys.argv[1], sys.argv[2]
    here = os.path.dirname(os.path.abspath(__file__))
    out = sys.argv[3] if len(sys.argv) > 3 else here
    os.makedirs(out, exist_ok=True)

    full, shell, pcap, serial = boot_and_probe(iso, tag, out)
    nonic = boot_no_nic(iso, tag, out)

    bad = 0

    def check(ok, what):
        nonlocal bad
        print(f"[{tag}] [{'PASS' if ok else 'FAIL'}] {what}")
        if not ok:
            bad += 1

    # ── what the kernel said ──
    m = re.search(r"NET: e1000 up, mac ([0-9a-f:]{17}), link (up|DOWN)", full)
    check(bool(m), "boot log reports the card, its MAC and its link state")
    our_mac = m.group(1) if m else None
    check(bool(m) and m.group(2) == "up", "the link came up")

    m2 = re.search(re.escape(GATEWAY) + r" is at ([0-9a-f:]{17})", shell)
    check(bool(m2), f"`net arp {GATEWAY}` resolved it")
    said_mac = m2.group(1) if m2 else None

    # ── what actually crossed the wire ──
    frames = read_pcap(pcap) if os.path.exists(pcap) else []
    print(f"[{tag}] capture: {len(frames)} frame(s) on the virtual wire")
    check(len(frames) >= 2, "at least a question and an answer were captured")

    req = None
    for f in frames:
        a = arp(f)
        if a and a[0] == 1 and a[4] == GATEWAY:
            req = (f, a)
            break
    check(bool(req), f"a real ARP REQUEST for {GATEWAY} left the machine")
    if req:
        f, (_, sha, spa, _, tpa) = req
        dst = ":".join(f"{b:02x}" for b in f[0:6])
        check(dst == "ff:ff:ff:ff:ff:ff", "the request went to broadcast")
        check(sha == our_mac,
              f"its source MAC is the one the kernel reported ({sha})")
        check(tpa == GATEWAY, "and it asks about the right address")

    rep = None
    for f in frames:
        a = arp(f)
        if a and a[0] == 2 and a[2] == GATEWAY:
            rep = a
            break
    check(bool(rep), f"an ARP REPLY came back from {GATEWAY}")

    # THE JOIN. Ties the kernel's claim to the bytes on the wire. A hardcoded
    # printf inside the guest cannot satisfy this: the reply's sender MAC is
    # chosen by QEMU, outside the guest, and the guest never sees this file.
    if rep and said_mac:
        check(rep[1] == said_mac,
              f"what the shell printed IS what came back on the wire ({said_mac})")

    # ── the negative control ──
    check("NET: no usable ethernet card" in nonic,
          "with no card, the kernel says so instead of inventing one")
    check("NET: e1000 up" not in nonic,
          "with no card, no MAC is reported at all")

    for f in scan_faults(serial):
        print(f"[{tag}] FAULT {f}")
        bad += 1

    verdict = ("CLEAN - Astrion talks to a network and the wire agrees"
               if not bad else f"{bad} FAILURE(S)")
    print(f"[{tag}] VERDICT: {verdict}")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
