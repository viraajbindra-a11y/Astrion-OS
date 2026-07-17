#!/usr/bin/env python3
"""Verify the terminal now renders in antialiased JetBrains Mono, and that
scroll/wrap still work. Also opens the Assistant to confirm its interior is
still bitmap (the next surface to migrate)."""
import os, socket, subprocess, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
SOCK = "/tmp/acf.sock"
os.chdir(HERE)
subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
for f in glob.glob(os.path.join(HERE,"C*.ppm"))+glob.glob(os.path.join(HERE,"C*.png")): os.remove(f)

KEYMAP={" ":"spc",".":"dot",",":"comma","-":"minus","/":"slash"}
def kn(c):
    if c in KEYMAP: return KEYMAP[c]
    if c.isalnum(): return c
    raise ValueError(repr(c))
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
        for c in t: s.key(kn(c))
    def line(s,t,w=0.8): s.typ(t); s.key("ret"); time.sleep(w); s._d()
    def shot(s,name):
        p=os.path.join(HERE,name+".ppm"); s.cmd("screendump %s"%p,0.5)
        for _ in range(20):
            if os.path.exists(p) and os.path.getsize(p)>1000: break
            time.sleep(0.1)
        print("  shot",name,"OK" if os.path.exists(p) else "MISS")

proc=subprocess.Popen(["qemu-system-x86_64","-cdrom",ISO,"-m","256M","-accel","tcg",
    "-serial","file:%s"%os.path.join(HERE,"serialC.log"),
    "-monitor","unix:%s,server,nowait"%SOCK,"-display","none","-no-reboot","-no-shutdown"],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    m=Mon(SOCK); print("booting..."); time.sleep(10)
    m.shot("C1_boot_shell")
    m.line("help",1.0);  m.shot("C2_help")           # long output -> scroll/wrap test
    m.line("ls");        m.shot("C3_ls")
    m.line("echo the quick brown fox jumps over 0123456789 {}[]()"); m.shot("C4_wrap")
    m.line("assistant",1.0); m.shot("C5_assistant")  # interior still bitmap?
    for ppm in sorted(glob.glob(os.path.join(HERE,"C*.ppm"))):
        Image.open(ppm).save(ppm[:-4]+".png"); os.remove(ppm)
    print("PNGs:", ", ".join(os.path.basename(p) for p in sorted(glob.glob(os.path.join(HERE,"C*.png")))))
finally:
    try: m.cmd("quit",0.2)
    except Exception: pass
    try: proc.terminate(); proc.wait(timeout=5)
    except Exception: proc.kill()
    subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)
    print("qemu cleaned")
