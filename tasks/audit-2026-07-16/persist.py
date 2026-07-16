#!/usr/bin/env python3
"""Persistence proof: boot A writes a file + sync to a real IDE disk, quit,
then boot B (same disk) must load it back. Closes the one gap the CD-only
audit couldn't exercise (ATA: no disk attached)."""
import os, socket, subprocess, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
DISK = os.path.join(HERE, "disk.img")
SOCK = "/tmp/apst.sock"
os.chdir(HERE)

subprocess.run(["pkill", "-9", "-f", "qemu-system"], capture_output=True)
# fresh 16 MiB raw disk
with open(DISK, "wb") as f: f.truncate(16 * 1024 * 1024)

KEYMAP = {" ": "spc", ".": "dot", ",": "comma", "-": "minus", "/": "slash"}
def kn(ch):
    if ch in KEYMAP: return KEYMAP[ch]
    if ch.isalnum(): return ch
    raise ValueError(repr(ch))

class Mon:
    def __init__(self, path):
        self.s = None
        for _ in range(120):
            try:
                s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.connect(path)
                self.s = s; break
            except OSError: time.sleep(0.1)
        if not self.s: raise RuntimeError("monitor never came up")
        self.s.settimeout(0.2); time.sleep(0.3); self._drain()
    def _drain(self):
        try:
            while self.s.recv(65536): pass
        except OSError: pass
    def cmd(self, c, s=0.12): self.s.sendall((c+"\n").encode()); time.sleep(s); self._drain()
    def key(self, n): self.cmd("sendkey "+n, 0.06)
    def typ(self, t):
        for ch in t: self.key(kn(ch))
    def line(self, t, w=0.9): self.typ(t); self.key("ret"); time.sleep(w); self._drain()
    def shot(self, name):
        p = os.path.join(HERE, name+".ppm"); self.cmd("screendump %s"%p, 0.5)
        for _ in range(20):
            if os.path.exists(p) and os.path.getsize(p) > 1000: break
            time.sleep(0.1)
        print("  shot", name, "OK" if os.path.exists(p) else "MISSING")

def boot(serial_name):
    return subprocess.Popen(
        ["qemu-system-x86_64", "-cdrom", ISO, "-boot", "d",
         "-drive", "file=%s,format=raw,if=ide,index=0,media=disk" % DISK,
         "-m", "256M", "-accel", "tcg",
         "-serial", "file:%s" % os.path.join(HERE, serial_name),
         "-monitor", "unix:%s,server,nowait" % SOCK,
         "-display", "none", "-no-reboot", "-no-shutdown"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def kill(p):
    try: p.terminate(); p.wait(timeout=5)
    except Exception:
        try: p.kill()
        except Exception: pass

# ---- Boot A: write + sync ----
print("BOOT A (write + sync to disk)...")
pa = boot("serialA.log")
try:
    m = Mon(SOCK); time.sleep(10)
    m.line("disk")                                   # show ATA present
    m.line("write persist.txt survivedreboot2026")   # create file
    m.line("sync", 1.5)                               # flush to disk
    m.shot("P1_bootA_write_sync")
finally:
    try: m.cmd("quit", 0.2)
    except Exception: pass
    kill(pa); subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)
time.sleep(1.5)

# ---- Boot B: same disk, must load persist.txt back ----
print("BOOT B (reboot, load from disk)...")
pb = boot("serialB.log")
try:
    m = Mon(SOCK); time.sleep(10)
    m.line("ls")
    m.line("cat persist.txt", 1.0)
    m.shot("P2_bootB_after_reboot")
finally:
    try: m.cmd("quit", 0.2)
    except Exception: pass
    kill(pb); subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)

for ppm in sorted(glob.glob(os.path.join(HERE, "P*.ppm"))):
    Image.open(ppm).save(ppm[:-4]+".png"); os.remove(ppm)
print("done. serialB tail:")
try:
    with open(os.path.join(HERE,"serialB.log")) as f:
        for ln in f.read().splitlines():
            if any(k in ln for k in ("ATA","FS:","disk","load","node","superblock")): print("   ", ln)
except Exception as e: print("  (no serialB)", e)
