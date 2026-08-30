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
## from koa -> viraaj  ·  cursor smear: fixed suspect #1 (the race); one thing I need from you
Fixed the cross-task race you flagged as suspect #1. src/mouse.c
mouse_redraw_if_dirty() ran its save/restore/draw + lx/ly commit with interrupts
ON (only the mx/my snapshot was masked), so a timer preemption could let the
clock/ticker/console-damage invalidate - which runs from OTHER tasks under cli -
lift against a stale saved_bg and bake a cursor ghost. Now the whole redraw is
one cli..sti, mutually exclusive with every cross-task invalidate. Cheap (~2000
masked ops vs the ~480k-pixel scroll console.c already masks). Uncommitted,
syntax-clean, ps2_delta test still green. Handed rex the verify plan.

Suspect #2 (Assistant streaming) is NOT a bug: assist_begin_output() already
calls mouse_lift() before every streamed answer, and generation blocks task 0,
so the cursor is off-screen the whole time. Left it alone.

WHAT I NEED - because I could NOT reproduce it: I threw ~8 movement patterns at
the real oracle ISO in QEMU (wallpaper, terminal, clock, spawn+busy, band
sweeps) and got ZERO smear - the same QEMU-can't-drive-the-mouse wall
test_ps2_delta.c documents. And on paper the race can only ghost where a
cross-task painter invalidates: the TOP BAR (clock/ticker) and the TERMINAL BODY
during a ring-3 print. It does NOT explain a trail on the bare wallpaper.
So: WHERE did the user see it - top bar, over a printing terminal, or truly out
on the empty desktop? And was the mouse moving fast/continuously? If it was on
the bare wallpaper, my fix is necessary but maybe not sufficient and I should
keep digging.
DEFAULT if you don't answer: race fix stands, rex verifies real-timing from CI,
and I'm on standby to target harder if his boot still shows a trail.
---
## from valentina -> viraaj
One scope decision, and my default if you are busy.

I booted every app and read the first-boot screen cold. The single most damaging thing I found is the Assistant: the prompt line is pinned above the output and cleared on Enter, so your QUESTION vanishes. Ask three things, you see one answer and an empty prompt, and at no point can you see what you asked. For the headline feature -- one whose pitch is that it REMEMBERS -- reading as amnesia is the worst possible first impression.

I shipped the cheap 80% already: every answer now opens with "you: <what you asked>" before the reply, so the output area reads as an exchange instead of a fragment. Builds, make test passes, screenshotted. That is minutes of work and it removes the "is this broken" reaction.

THE DECISION: do we want a real scrolling transcript before September -- input at the bottom, history above, old exchanges scrolling up? That is what every person alive expects an AI chat to be, and it is the difference between "neat demo" and "this is a thing I would use". It is also genuinely a layout rewrite of the assistant pane (assist_render_output replays one flat buffer today) and I would call it days, not hours, and it is koa work not mine.

My default if you do not answer: we ship the "you:" echo and no transcript. It is honestly fine -- not embarrassing, just not delightful.

The other thing I would spend on if you had budget for exactly one more item: the Editor opens as a 100% empty box with no footer, while Files, Calculator, Monitor and Settings all anchor a hint row to the bottom edge. That footer is why those four read as finished and the Editor reads as unimplemented. Adding one is small.
---
## from rex -> viraaj  ·  "learns from you" is not September-demo safe yet
Red-teamed learn.c on 11 real boots. learn_test.py passes 5/5 on my build; the
feature is real. Three of the six defects I found are visible on stage:
 - a learned pair PERMANENTLY shadows a built-in phrasing once state changes
   ("read thing" before thing.txt exists, then create it -- it never reads the
   file again, it replays the file listing). Reboot does not clear it.
 - it prints "(learned: X means this too)" for pairs it silently discarded
   (worked-side 96+ chars). Say it another way, it says it learned, it did not.
 - "delete learned.txt" does not forget. The pair stays live in RAM and the file
   comes back on the next lesson. That is the only undo we ship, and learn.h
   promises it.
My call: demo the happy path only (teach -> reboot -> still works). Do not invite
anyone to delete learned.txt on stage and do not demo teaching a phrase about a
file that does not exist yet. Full repro list is in koa.md.
Default if you do not reply: I assume the happy-path-only demo and keep testing.
---
## from koa -> viraaj  ·  Ember landed; two calls are yours, neither blocks me
Done: ember-identity.js as the single source, ai-service wired on all three transports, Modelfiles generated + drift-checked, client side of ollama-create written to fail silently. I did not touch server/index.js.

1. NAMING. ai-service used to open "You are Astrion, the built-in AI assistant". It now says Ember. Two places still say otherwise and I left them alone deliberately: ai-service._mockResponse greets with "I am Astrion, your AI assistant", and server/index.js has three "You are Astrion, a helpful AI assistant" fallback strings. Valentina's new picker copy calls the no-model state "the Assistant", not Ember, so the mock arguably should NOT be Ember. My default: leave both as-is. Say the word if you want them unified.

2. RAM, as you asked me to flag rather than silently adjust. qwen3:8b is 5.2 GB against the old 4.7 GB, and I set num_ctx 8192 on it, which is roughly another 1.2 GB of KV cache. That is ~6.4 GB before Astrion or a browser exists, on a card whose threshold is 8192 MB. Standard on an exactly-8 GB machine is now genuinely tight, and the tiny tier is why I capped it at 4096 instead of 8192. Either the threshold moves or the copy softens -- valentina's call, not mine.

3. One correction to the brief I was given: ai-service ALREADY sent a system prompt on every path. Nothing was missing an injection point. The real gap was that the identity was one sentence hardcoded above ~2 KB of tool listings, and it named Astrion, not Ember. So this was an integration, not new plumbing.
Default if you do not answer: shipping as described, nothing else touched.
---
## from valentina -> viraaj
First-boot picker is redesigned; one honesty gap outside my brief for you to rule on.

Done: the screen is "Meet Ember" with three sizes (Ember Mini / Ember / Ember Max).
What each is built on is on every card as a quiet third line ("Built on Qwen3 8B"),
never the headline. Real tags and real sizes, qwen3 1.7b/8b/14b at 1.4/5.2/9.3 GB.

THE GAP, and it is yours not mine: Settings > AI never says the word Ember. It
shows a text field labelled "Model" whose helper text reads "e.g. qwen2.5:7b,
qwen2.5:1.5b, llama3.2, phi3 -- pull via ollama pull MODEL", and the default when
unset is still qwen2.5:7b. So a user who meets Ember on Monday and opens Settings
on Tuesday finds no Ember anywhere, a stale model family we no longer ship, and --
if koa's create step succeeded -- a field reading "ember", which that helper text
would tell them to go "ollama pull". That last one is advice that cannot work.
js/apps/settings.js around lines 417 and 449.

I did not touch it: it is a different screen and you asked me to flag, not fix.
My read is the helper text is the actual bug (it gives an instruction that fails)
and is a ten-minute change; naming the section "Ember" is a bigger call about how
far the name goes. DEFAULT IF YOU DO NOT ANSWER: I leave Settings alone.
---
