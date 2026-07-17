#!/usr/bin/env python3
"""Confirm every on-screen surface is antialiased: Assistant (Inter header +
mono output), Editor (loads a real file, mono), Files browser (mono)."""
import os, socket, subprocess, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
DISK = os.path.join(HERE, "diskf.img")
SOCK = "/tmp/aff.sock"
os.chdir(HERE)
subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
for f in glob.glob(os.path.join(HERE,"F*.ppm"))+glob.glob(os.path.join(HERE,"F*.png")): os.remove(f)
with open(DISK,"wb") as f: f.truncate(16*1024*1024)

KEYMAP={" ":"spc",".":"dot",",":"comma","-":"minus","/":"slash"}
def kn(c):
    if c in KEYMAP: return KEYMAP[c]
    if c.isalnum(): return c
    return None      # skip anything we don't have a keyname for (no crash)
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
    def line(s,t,w=0.8): s.typ(t); s.key("ret"); time.sleep(w); s._d()
    def esc(s,w=0.6): s.key("esc"); time.sleep(w); s._d()
    def shot(s,name):
        p=os.path.join(HERE,name+".ppm"); s.cmd("screendump %s"%p,0.5)
        for _ in range(20):
            if os.path.exists(p) and os.path.getsize(p)>1000: break
            time.sleep(0.1)
        print("  shot",name,"OK" if os.path.exists(p) else "MISS")

proc=subprocess.Popen(["qemu-system-x86_64","-cdrom",ISO,"-boot","d",
    "-drive","file=%s,format=raw,if=ide,index=0,media=disk"%DISK,
    "-m","256M","-accel","tcg","-serial","file:%s"%os.path.join(HERE,"serialF.log"),
    "-monitor","unix:%s,server,nowait"%SOCK,"-display","none","-no-reboot","-no-shutdown"],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    m=Mon(SOCK); print("booting..."); time.sleep(10)
    m.line("assistant",1.0)
    m.line("who are you");        m.shot("F1_assistant_identity")   # Inter header + mono body
    m.line("list my files");      m.shot("F2_assistant_files")
    m.esc()
    m.line("edit readme.txt",1.0); m.shot("F3_editor")             # editor, mono, real file
    m.esc()
    m.line("files",1.0);          m.shot("F4_files")               # files browser, mono
    m.esc()
    for ppm in sorted(glob.glob(os.path.join(HERE,"F*.ppm"))):
        Image.open(ppm).save(ppm[:-4]+".png"); os.remove(ppm)
    print("PNGs:", ", ".join(os.path.basename(p) for p in sorted(glob.glob(os.path.join(HERE,"F*.png")))))
finally:
    try: m.cmd("quit",0.2)
    except Exception: pass
    try: proc.terminate(); proc.wait(timeout=5)
    except Exception: proc.kill()
    subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)
    print("qemu cleaned")
