# The plan — launch end of September 2026

**Changed 2026-07-19.** Launch moved from Aug 31 to **end of September**, and the
browser is **in scope**. This supersedes the Aug 31 dates in `YOUR-CHECKLIST.md`
and the Phase 7 window in `ROADMAP-DEC-2026-v3.md`.

## Why it changed

The founder looked at screenshots and said, accurately: *"this is a terminal for a
Pi or Arduino — this is not an OS."* The verdict is about **feel**, and it's fair.
Underneath there is a real kernel — preemptive multitasking, hardware-enforced
per-process memory isolation, ring-3 separation, ELF loading, a filesystem that
survives reboot, ACPI power. On top of it there are six demos and an empty screen.

**The gap is not kernel work. It's that nothing is built on the foundation.**

## The sequence, and why this order

**Now → end of July — APPS.**
Kills "this is not an OS" fastest, and it's the cheapest work available because the
hard part is done: window manager, filesystem, antialiased fonts, keyboard and
mouse all work and are verified. An app is now drawing + input + FS calls.
Target: calculator, settings, a real text editor, a file manager that manages
files, paint, notes, clock. Eight things a person can open and use.

**August — NETWORK STACK.**
Driver + TCP/IP + DNS + HTTP. Invisible and unglamorous, and it is the gate for
everything the founder actually wants. It gets a whole month because it deserves
one. Hardware testing folds in alongside (see `YOUR-CHECKLIST.md`).

**September — BROWSER.**
Fetch a page, render text and links. No JS, no CSS initially. "It browses" is the
milestone; everything past that is upside.

**Throughout — THE AI GETS REBUILT AROUND DOING.**
It is the headline differentiator and currently the weakest surface, because it is
asked to chat and a 212K-parameter model cannot. The Assistant window literally
invites it ("or just chat"), which sets up its own failure. Direction: go from ~6
reliable intents to dozens, and kill the chat invitation. An assistant that
reliably runs the machine beats one that badly imitates conversation.

## The one risk worth naming

The browser's prerequisite — the network stack — has **zero visible payoff until
the browser on top of it works.** That is why apps come first: if the stack slips,
September still has something to show. Do not start September holding an empty bag.

## Standing decisions (unchanged)

- Kernel stays from-scratch. No Linux underneath.
- No xHCI/USB driver — `tasks/usb-keyboard-scoping.md` established it as a 6–12
  week trap that regresses us half-built.
- Every feature is booted on a real CI artifact before it is believed.
