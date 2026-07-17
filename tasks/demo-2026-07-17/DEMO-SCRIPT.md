# Astrion v2.0 — 60–90s Demo Script (2026-07-17)

Every beat below is backed by a proof dir (cited at the end). Nothing here is
aspirational. The wow moments are all TRUE — that's the whole design. If you
can't reproduce a beat live, the same beat has a verifying screenshot to fall
back on.

**Spine (the wow beats, in order):**
1. The AI *does real things*, offline — write a file, read it back.
2. A hostile program tries to escape ring-3 and the CPU kills it — kernel lives.
3. A real neural net runs on bare metal and emits honest gibberish (the feat).
+ Close: it powers off for real.

**Golden rule while narrating:** sell the *actions*, the *isolation*, and the
*feat*. NEVER imply the little GPT is a smart assistant. One oversell and the
room stops believing the true parts.

---

## Before you hit record (prep — not on the clock)

- Boot the CI ISO in QEMU: `qemu-system-x86_64 -cdrom astrion-grub.iso -m 256M`
- Have the **Terminal** open and the **Assistant** one click away in the dock.
- Practice twice so the typing is smooth. Total target: **~80 seconds.**

---

## BEAT 0 — Boot & premise · ~12s

**DO:** Start QEMU. The Astrion splash appears, then the desktop — top bar with a
live clock, dock at the bottom.
**SAY:** "This is an operating system I wrote from scratch in C. No Linux, no
Windows underneath — that clock is reading the CMOS chip on the board, and there
is no network driver anywhere in this kernel. It doesn't phone home because it
has nothing to phone home *with*."

## BEAT 1 — WOW: the AI does real things, offline · ~22s

**DO:** Click the Assistant. Type: `write hello world to notes.txt` → Enter.
It prints **"wrote to notes.txt: hello world"**. Then type: `read notes.txt`
→ it prints the contents back.
**SAY:** "Here's the part that matters. I'm not asking it to chat — I'm telling
it to *do* something. 'Write hello world to notes dot txt.' It just made a real
file on the disk. 'Read notes dot txt' — there it is. No internet was touched.
Every other AI operating system talks to a cloud. This one *acts*, locally."
> *Proof: audit-2026-07-16 frames 11 (write) + 12 (read-back), verified offline.*

## BEAT 2 — WOW: hostile program vs. ring-3 · ~20s

**DO:** In the Terminal: `exec rogue.elf`. It tries to write into kernel memory,
faults, and is killed — a line prints that the ring-3 isolation held. Then type
`ls` to show the kernel is fine.
**SAY:** "This program is hostile — it deliberately tries to attack the kernel.
Watch. The CPU itself catches it, kills *only* that program, and my OS doesn't
even flinch. That's hardware-enforced isolation — the kind an AI agent bolted on
top of Windows or Linux structurally can't give you."
> *Proof: audit-2026-07-16 frame 07 + serial "#PF … killed (ring-3 isolation held)".*

## BEAT 3 — FEAT (honest): a neural net on bare metal · ~16s

**DO:** In the Assistant, type an open-ended line, e.g. `to be or not to be` →
Enter. Watch it stream text letter by letter — Shakespeare-flavored gibberish.
**SAY:** "Last thing, and I'll be straight with you. This is a real neural
network — a transformer, 212,000 parameters — doing the matrix math on the CPU,
in this kernel, with no internet. I trained it on Shakespeare. Watch… That is
Shakespeare-flavored nonsense. It's a genuine neural net and a terrible chatbot,
and that's the honest truth. The feat isn't *what* it says — it's that a neural
net runs *at all*, here, offline, on an OS I wrote from zero."
> *Proof: audit-2026-07-16 frame 14 — "To speak dimmanded appear than begin".*

## BEAT 4 — Close: it powers off for real · ~10s

**DO:** Click the top-bar power glyph → confirm → Shut Down. QEMU exits.
**SAY:** "And it's a real computer, so it turns off like one — a real ACPI
power-off, not a script pretending. That's Astrion: a from-scratch AI OS that
does real work offline, and physically can't phone home."
> *Proof: shutdown-2026-07-17 — real ACPI S5, QEMU exit code 0, one boot banner.*

*(Optional lighter close if the room wants a smile: click Snake, play 8 seconds.
Verified: audit-2026-07-16 frame 15.)*

---

## Backup beats (only if asked / time allows — all verified)

- **"What's running?"** — open the **System Monitor**: live task list, context
  switches climbing, uptime advancing; survives 14 tasks without crashing.
  *(monitor-fix-2026-07-17.)*
- **Persistence across reboot** — write a file, Restart from the power menu, then
  `cat` it after the reboot; it's still there (editor autosaves first).
  *(shutdown-2026-07-17 items 3 & 5.)*
- **Ask the date** — Assistant: `what day is it` → real wall clock, "straight off
  the clock chip — I never asked a server." *(rtc-clock-2026-07-17 frame R3.)*

## Hard honesty guardrails (memorize)

- If asked "can it answer questions like ChatGPT?" → **"No. It's ~212K numbers;
  it learned a style, not answers. The hard thing I'm showing is that a neural
  net runs at all on an OS I built from scratch."**
- Never type a factual question into the GPT and let it "answer" — it will make
  nonsense, and that reads as an oversell. Keep factual Q&A to the *intent*
  actions (files, memory, date, what's-running), which are deterministic and true.

## NEEDS-REX (confirm on the live build before relying on these on stage)

- **Assistant `who are you` self-narration** — real in source (wm.c), a nice
  opener, but the on-screen wording isn't in a proof-dir screenshot yet. Don't
  hard-depend on it; the write→read beat is the verified anchor.
- **Splash accent color** — recent serial logs read the splash accent as orange
  (0xff7a00); an earlier audit note mentions a blue accent. Don't assert a color
  on stage — just say "the splash."
- **Clipboard** — landing now, no proof dir. Keep it OUT of the demo until Rex
  verifies it end-to-end.

## Proof dirs (all under tasks/)
audit-2026-07-16/AUDIT.md · shutdown-2026-07-17/AUDIT.md ·
monitor-fix-2026-07-17/AUDIT.md · rtc-clock-2026-07-17/ · rtc-redteam-2026-07-17/
