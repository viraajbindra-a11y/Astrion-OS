# inbox: viraaj

Messages for viraaj. Read top-to-bottom, newest at the bottom. To leave a note, append a block (see README.md). The owner reads this at task start, when blocked, and before finishing.

---
## from rex -> viraaj  ·  astrion-vis.iso is STALE — the redesign is only half in it
The artifact you handed me predates the window work. Evidence, not inference:

  astrion-vis.iso           built 20:43   sha256 d03b98eb...
  kernel inside it          sha256 62e0fc1f4133e8a6780891e03bb2c95970a8a76d8b073dc993e72cb9b0cb3196
  x86_64-elf-nm on it       desktop_draw_window_frame  ABSENT
  build/kernel_mb2.elf now  rebuilt 21:04, sha256 1fe889cd...  symbol PRESENT

src/wm.c (21:03), desktop.c (21:00), console.c (20:58), kernel_mb2.c (21:04)
and wm.h/desktop.h/console.h/q8.h ALL postdate the ISO. So the unified frame —
the change that makes APP windows rounded with real shadows and round traffic
lights — is not in what I booted.

What that looks like on screen right now: the Terminal window is rounded with a
soft 18px shadow and round dots; open Files and you get SQUARE corners, a hard
6px offset shadow block and a red square X. Two window looks on one desktop.
That is a demo-visible split. Frame: vis0719/T2_14_window_over_cursor.png

WHAT I CAN STILL SIGN OFF FROM THIS ISO: the cursor work. mouse.c is 20:27,
older than the ISO, so the eager-lift fix IS in it and I have exercised it.
WHAT I CANNOT: any app-window appearance claim, and the dock/dot claim, because
desktop.c moved after the build.

I need a rebuilt ISO from the current tree to finish item 2. Default if nobody
answers: I report item 1 CONFIRMED on 62e0fc1f, item 2 as UNVERIFIABLE-on-this-
artifact with the split documented, and item 3 pinned to this kernel hash.
---
## from rex -> viraaj  ·  item 2 results + one thing the demo must not say
All on kernel e95214256b2d67b4ad6c3fc3a367b954d2d26066b105c3c662cd22c4e511d34d (snap2),
hash verified by me against yours before I booted it.

1. THE DOCK "APP IS RUNNING" DOT: it does NOT render, and it never will - it was
   DELETED, not relocated. desktop.c says so outright: the row is 10+52+6+17 = 85 of
   DOCK_H 86 and the dot had no room, so it is gone and the active tile carries an
   accent ring + full-colour tile + white label instead. I confirmed on pixels: ring
   complete, no notch, no dot. Frame vis0719/Z_dock_active.png.
   So your brief said "confirm it now does" - it does not, by design. Nobody should
   say "a dot shows which app is running" in copy or on stage. The ring is the signal.

2. DOCK AT 640 WIDE: unverified, and I could not fake it. GRUB honours the kernel's
   own multiboot2 framebuffer request and IGNORES gfxpayload/gfxmode on that path; I
   decoded the header and it asks for 0x0 @ 0 bpp, so GRUB picks - it picks 1280x800x32
   every time. The only lever that moved the mode also forced 24bpp, which breaks
   rendering for an unrelated reason (see 3). Testing 640-wide geometry needs the
   multiboot2 header changed and a rebuild. The DOCK_EDGE arithmetic checks out on
   paper at 640 (gap shrinks to 28, 14px margin each side, not flush) but paper is not
   a boot and I am not signing it off.

3. 800x600 IS BROKEN, and it is not a geometry bug - full writeup + repro sent to koa.
   Short version: GRUB hands 24bpp, the bpp!=32 guard only covers the three legacy
   painters in kernel_mb2.c, so solid fills vanish while text/shapes/cursor still paint
   at the wrong stride. Black screen, magenta text, dock cut off both bezels. It also
   writes ~796 bytes past the end of the framebuffer. Do not demo on any machine you
   have not booted first.

WHAT IS GOOD: at 1280x800 the redesign holds up. Rounded windows, a real 18px
decaying shadow, round traffic lights, dimmed-idle dock. The Terminal-as-a-window
migration has clearly progressed since your note - Files now has the round dots and
rounded corners too, and clicking the Terminal properly raises it. The one thing
still visibly half-migrated is console clipping (item 2 in my koa note).

And the thing you most wanted found: NOTHING bakes the cursor. I parked the pointer
in the shadow band, in the corner arc, and under a window open/close, then diffed the
wallpaper against a pristine boot - maxdiff 0, byte identical, every time. The
readback shadow and the AA corners are safe because repaint lifts the sprite first.
---
