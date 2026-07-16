#!/usr/bin/env python3
"""Verify Assistant v2: the offline AI answers real system questions and does
new actions (copy/append). Boots WITH a disk so 'disk attached' + persistence
+ sync are all real. Drives the Assistant window over the QEMU monitor."""
import os, socket, subprocess, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
DISK = os.path.join(HERE, "diskv2.img")
SOCK = "/tmp/av2.sock"
os.chdir(HERE)

subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
for f in glob.glob(os.path.join(HERE,"V*.ppm"))+glob.glob(os.path.join(HERE,"V*.png")):
    os.remove(f)
with open(DISK,"wb") as f: f.truncate(16*1024*1024)   # fresh disk

KEYMAP={" ":"spc",".":"dot",",":"comma","-":"minus","/":"slash","'":"apostrophe"}
def kn(c):
    if c in KEYMAP: return KEYMAP[c]
    if c.isalnum(): return c
    raise ValueError(repr(c))

class Mon:
    def __init__(s, path):
        s.s=None
        for _ in range(120):
            try:
                x=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); x.connect(path); s.s=x; break
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

proc=subprocess.Popen(
    ["qemu-system-x86_64","-cdrom",ISO,"-boot","d",
     "-drive","file=%s,format=raw,if=ide,index=0,media=disk"%DISK,
     "-m","256M","-accel","tcg","-serial","file:%s"%os.path.join(HERE,"serialV.log"),
     "-monitor","unix:%s,server,nowait"%SOCK,"-display","none","-no-reboot","-no-shutdown"],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    m=Mon(SOCK); print("booting..."); time.sleep(10)
    m.line("assistant",1.0)                              # open Assistant window
    m.line("who are you");                m.shot("V1_identity")
    m.line("how much memory do i have");  m.shot("V2_memory")
    m.line("what is running");            m.shot("V3_running")
    m.line("is there a disk");            m.shot("V4_disk")
    m.line("write hi to notes.txt",1.0)
    m.line("append bye to notes.txt",1.0);m.shot("V5_append")
    m.line("read notes.txt",1.0);         m.shot("V6_read")       # expect: hi bye
    m.line("copy notes.txt to backup.txt",1.0); m.shot("V7_copy")
    m.line("read backup.txt",1.0);        m.shot("V8_copy_read")  # expect: hi bye
    m.line("list my files");              m.shot("V9_files")      # sizes + total
    m.line("how many files do i have");   m.shot("V10_count")
    for ppm in sorted(glob.glob(os.path.join(HERE,"V*.ppm"))):
        Image.open(ppm).save(ppm[:-4]+".png"); os.remove(ppm)
    print("PNGs:", ", ".join(os.path.basename(p) for p in sorted(glob.glob(os.path.join(HERE,"V*.png")))))
finally:
    try: m.cmd("quit",0.2)
    except Exception: pass
    try: proc.terminate(); proc.wait(timeout=5)
    except Exception: proc.kill()
    subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)
    print("qemu cleaned")
