#!/usr/bin/env python3
"""Prove real multi-window: open the Assistant (give it output), then Files,
then the Editor — all three stay open, stacked — then click the Assistant's
exposed bottom strip to raise it and confirm its answer survived the repaint.

Uses the PS/2 mouse via the QEMU monitor: motion is relative, so we slam to the
origin (the kernel clamps the cursor) and then move by exact deltas.

Window geometry (SW=1280, APP_W=860, APP_H=520, WM_TOP=66), cascade s*26/s*22:
  Files  slot0: 210..1070,  70..590
  Editor slot1: 236..1096,  92..612
  Assist slot2: 262..1122, 114..634   -> bottom strip y 613..634 stays visible
Dock icon centers: T=468 F=554 E=640 S=726 A=811, y=751
"""
import os, socket, subprocess, time, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ISO  = os.path.join(HERE, "astrion-grub-iso", "astrion-grub.iso")
SOCK = "/tmp/amw.sock"
os.chdir(HERE)
subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
for f in glob.glob(os.path.join(HERE,"M*.ppm"))+glob.glob(os.path.join(HERE,"M*.png")): os.remove(f)

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
    def moveto(s,x,y):
        # PS/2 packets carry a 9-bit signed delta, and QEMU clamps each
        # mouse_move to ~255 — so walk there in <=200px steps.
        for _ in range(12): s.cmd("mouse_move -200 -200", 0.03)   # slam to (0,0)
        rx, ry = x, y
        while rx > 0 or ry > 0:
            dx = 200 if rx > 200 else rx
            dy = 200 if ry > 200 else ry
            s.cmd("mouse_move %d %d" % (dx, dy), 0.03)
            rx -= dx; ry -= dy
        time.sleep(0.2)
    def click(s,x,y,w=2.0):
        s.moveto(x,y)
        s.cmd("mouse_button 1", 0.18)
        s.cmd("mouse_button 0", w)                 # repaint_all needs a beat
        s._d()
    def shot(s,name):
        p=os.path.join(HERE,name+".ppm"); s.cmd("screendump %s"%p,0.6)
        for _ in range(25):
            if os.path.exists(p) and os.path.getsize(p)>1000: break
            time.sleep(0.1)
        print("  shot",name,"OK" if os.path.exists(p) else "MISS")

proc=subprocess.Popen(["qemu-system-x86_64","-cdrom",ISO,"-m","256M","-accel","tcg",
    "-serial","file:%s"%os.path.join(HERE,"serialM.log"),
    "-monitor","unix:%s,server,nowait"%SOCK,"-display","none","-no-reboot","-no-shutdown"],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    m=Mon(SOCK); print("booting..."); time.sleep(10)
    m.shot("M1_desktop")
    m.click(811,751);            m.shot("M2_assistant")        # dock: Assistant
    m.line("who are you",1.4);   m.shot("M3_assistant_answer")
    m.click(554,751);            m.shot("M4_two_windows")      # dock: Files
    m.click(640,751);            m.shot("M5_three_windows")    # dock: Editor
    m.click(700,625);            m.shot("M6_assistant_raised") # raise Assistant
    for ppm in sorted(glob.glob(os.path.join(HERE,"M*.ppm"))):
        Image.open(ppm).save(ppm[:-4]+".png"); os.remove(ppm)
    print("PNGs:", ", ".join(os.path.basename(p) for p in sorted(glob.glob(os.path.join(HERE,"M*.png")))))
finally:
    try: m.cmd("quit",0.2)
    except Exception: pass
    try: proc.terminate(); proc.wait(timeout=5)
    except Exception: proc.kill()
    subprocess.run(["pkill","-9","-f","qemu-system"], capture_output=True)
    if os.path.exists(SOCK): os.remove(SOCK)
    print("qemu cleaned")
