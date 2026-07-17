#!/usr/bin/env python3
"""Verify the RTC: top bar shows a real date, `date` prints it, and the
Assistant answers 'what time is it' with the wall clock (not uptime).
QEMU feeds the guest RTC from the host clock, so the date should match today."""
import os, socket, subprocess, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
SOCK = "/tmp/artc.sock"
os.chdir(HERE)
subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
for f in glob.glob(os.path.join(HERE,"R*.ppm"))+glob.glob(os.path.join(HERE,"R*.png")): os.remove(f)

KEYMAP={" ":"spc",".":"dot",",":"comma","-":"minus","/":"slash"}
def kn(c):
    if c in KEYMAP: return KEYMAP[c]
    if c.isalnum(): return c
    return None
class Mon:
    def __init__(s,p):
        s.s=None
        for _ in range(120):
            try:
                x=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); x.connect(p); s.s=x; break
            except OSError: time.sleep(0.1)
        if not s.s: raise RuntimeError("no monitor")
        s.s.settimeout(0.2); time.sleep(0.3); s._d()
    def _d(s):
        try:
            while s.s.recv(65536): pass
        except OSError: pass
    def cmd(s,c,w=0.12): s.s.sendall((c+"\n").encode()); time.sleep(w); s._d()
    def key(s,n): s.cmd("sendkey "+n,0.05)
    def typ(s,t):
        for c in t:
            n=kn(c)
            if n: s.key(n)
    def line(s,t,w=1.0): s.typ(t); s.key("ret"); time.sleep(w); s._d()
    def shot(s,name):
        p=os.path.join(HERE,name+".ppm"); s.cmd("screendump %s"%p,0.6)
        for _ in range(25):
            if os.path.exists(p) and os.path.getsize(p)>1000: break
            time.sleep(0.1)
        print("  shot",name,"OK" if os.path.exists(p) else "MISS")

proc=subprocess.Popen(["qemu-system-x86_64","-cdrom",ISO,"-m","256M","-accel","tcg",
    "-serial","file:%s"%os.path.join(HERE,"serialR.log"),
    "-monitor","unix:%s,server,nowait"%SOCK,"-display","none","-no-reboot","-no-shutdown"],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    m=Mon(SOCK); print("booting..."); time.sleep(10)
    m.shot("R1_topbar_realclock")
    m.line("date",1.0);            m.shot("R2_date_cmd")
    m.line("assistant",1.2)
    m.line("what time is it",1.4); m.shot("R3_assistant_time")
    for ppm in sorted(glob.glob(os.path.join(HERE,"R*.ppm"))):
        Image.open(ppm).save(ppm[:-4]+".png"); os.remove(ppm)
    print("PNGs:", ", ".join(os.path.basename(p) for p in sorted(glob.glob(os.path.join(HERE,"R*.png")))))
finally:
    try: m.cmd("quit",0.2)
    except Exception: pass
    try: proc.terminate(); proc.wait(timeout=5)
    except Exception: proc.kill()
    subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)
    print("qemu cleaned")
print("--- host says ---"); print(subprocess.run(["date"],capture_output=True,text=True).stdout.strip())
print("--- guest serial RTC line ---")
try:
    for ln in open(os.path.join(HERE,"serialR.log")).read().splitlines():
        if "RTC" in ln: print("   ", ln)
except Exception as e: print("  (none)", e)
