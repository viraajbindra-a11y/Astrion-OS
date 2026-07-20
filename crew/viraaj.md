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
