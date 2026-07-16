#!/usr/bin/env python3
"""Astrion v2.0 kernel — full honest audit. Boots the real ISO once and drives
every claimed subsystem purely over the QEMU monitor (keyboard injection +
screendump), then converts each frame to PNG. No feature is taken on trust."""
import os, socket, subprocess, sys, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
SOCK = "/tmp/amon.sock"   # AF_UNIX path must be < 104 bytes on macOS
SER  = os.path.join(HERE, "serial.log")
os.chdir(HERE)

# clean slate
subprocess.run(["pkill", "-9", "-f", "qemu-system"], capture_output=True)
for f in glob.glob(os.path.join(HERE, "*.ppm")) + glob.glob(os.path.join(HERE, "*.png")):
    os.remove(f)
if os.path.exists(SOCK): os.remove(SOCK)
if os.path.exists(SER):  os.remove(SER)

QEMU = ["qemu-system-x86_64", "-cdrom", ISO, "-m", "256M", "-accel", "tcg",
        "-serial", "file:%s" % SER, "-monitor", "unix:%s,server,nowait" % SOCK,
        "-display", "none", "-no-reboot", "-no-shutdown"]

KEYMAP = {" ": "spc", ".": "dot", ",": "comma", "-": "minus", "/": "slash"}
def kn(ch):
    if ch in KEYMAP: return KEYMAP[ch]
    if ch.isalnum(): return ch
    raise ValueError("no keyname for %r" % ch)

class Mon:
    def __init__(self, path):
        self.s = None
        for _ in range(100):
            try:
                s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                s.connect(path); self.s = s; break
            except OSError:
                time.sleep(0.1)
        if not self.s: raise RuntimeError("monitor never came up")
        self.s.settimeout(0.2); time.sleep(0.3); self._drain()
    def _drain(self):
        try:
            while self.s.recv(65536): pass
        except OSError: pass
    def cmd(self, c, settle=0.12):
        self.s.sendall((c + "\n").encode()); time.sleep(settle); self._drain()
    def key(self, name): self.cmd("sendkey " + name, 0.06)
    def typ(self, s):
        for ch in s: self.key(kn(ch))
    def enter(self, wait=0.9): self.key("ret"); time.sleep(wait); self._drain()
    def esc(self, wait=0.7):   self.key("esc"); time.sleep(wait); self._drain()
    def shot(self, name):
        p = os.path.join(HERE, name + ".ppm")
        self.cmd("screendump %s" % p, 0.5)
        for _ in range(20):
            if os.path.exists(p) and os.path.getsize(p) > 1000: break
            time.sleep(0.1)
        print("  shot %-22s %s" % (name, "OK" if os.path.exists(p) else "MISSING"))

def line(m, s, wait=0.9):
    """type a shell/assistant command line and press enter"""
    m.typ(s); m.enter(wait)

errf = open(os.path.join(HERE, "qemu.err"), "w")
proc = subprocess.Popen(QEMU, stdout=subprocess.DEVNULL, stderr=errf)
time.sleep(2.0)
if proc.poll() is not None:
    errf.flush()
    print("QEMU exited early (code %s). stderr:" % proc.returncode)
    print(open(os.path.join(HERE, "qemu.err")).read())
    sys.exit(1)
try:
    m = Mon(SOCK)
    print("monitor up; booting (splash 1.5s + init)...")
    time.sleep(10)                      # boot: splash hold + desktop + shell
    m.shot("01_boot_desktop")

    # ---- Filesystem ----
    line(m, "ls");                      m.shot("02_ls")
    line(m, "write auditfile.txt helloastrion2026")
    line(m, "cat auditfile.txt");       m.shot("03_fs_write_read")

    # ---- Scheduler / preemptive multitasking ----
    line(m, "ps");                      m.shot("04_ps")
    line(m, "busy", 1.2)                # non-yielding spinner
    line(m, "ps");                      m.shot("05_preempt_busy_then_ps")

    # ---- Ring-3 isolation + ELF loader + syscalls ----
    line(m, "exec iodemo.elf", 1.6);    m.shot("06_ring3_iodemo")
    line(m, "exec rogue.elf",  1.6);    m.shot("07_ring3_rogue_isolation")
    line(m, "exec hello.elf",  1.6);    m.shot("08_ring3_hello")

    # ---- System info ----
    line(m, "uptime"); line(m, "mem");  m.shot("09_sysinfo")

    # ---- Assistant: real offline actions ----
    line(m, "clear")
    line(m, "assistant", 1.2);          m.shot("10_assistant_open")
    line(m, "write hello world to notes.txt", 1.4); m.shot("11_assist_write")
    line(m, "read notes.txt", 1.4);     m.shot("12_assist_read")
    line(m, "help", 1.4);               m.shot("13_assist_help")
    # ---- Assistant: on-device GPT fallback (open-ended text) ----
    m.typ("tell me a story about a fox"); m.key("ret"); time.sleep(9); m._drain()
    m.shot("14_assist_gpt")
    m.esc()                             # close Assistant -> back to shell

    # ---- Snake ----
    line(m, "snake", 1.2);              m.shot("15_snake")
    m.esc(); time.sleep(0.6);           m.shot("16_after_snake_recovered")

    # ---- convert every frame to PNG ----
    print("converting frames...")
    for ppm in sorted(glob.glob(os.path.join(HERE, "*.ppm"))):
        png = ppm[:-4] + ".png"
        try:
            Image.open(ppm).save(png); os.remove(ppm)
        except Exception as e:
            print("  convert FAIL", os.path.basename(ppm), e)
    print("PNGs:", ", ".join(os.path.basename(p) for p in sorted(glob.glob(os.path.join(HERE, "*.png")))))
finally:
    try: m.cmd("quit", 0.2)
    except Exception: pass
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()
    subprocess.run(["pkill", "-9", "-f", "qemu-system"], capture_output=True)
    print("qemu: cleaned up")
