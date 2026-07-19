# Astrion v2.0 — 60–90s Demo Script

*Created 2026-07-17 · **rev 2026-07-18** (Tier 3 per-process isolation; real-hardware story rewritten)*

Every beat below is backed by a proof dir (cited at the end). Nothing here is
aspirational. The wow moments are all TRUE — that's the whole design. If you
can't reproduce a beat live, the same beat has a verifying screenshot to fall
back on.

**Spine (the wow beats, in order) — still 4 beats. Deliberately.**
1. The AI *does real things*, offline — write a file, read it back.
2. A hostile program tries to escape ring-3 and the CPU kills it — kernel lives.
3. A real neural net runs on bare metal and emits honest gibberish (the feat).
+ Close: it powers off for real.

**Golden rule while narrating:** sell the *actions*, the *isolation*, and the
*feat*. NEVER imply the little GPT is a smart assistant. One oversell and the
room stops believing the true parts.

**Why per-process memory isolation is NOT a fifth beat** — see the box after
Beat 2. Short version: it's the strongest *credential* we have and the weakest
*picture*. It's a sentence, not a beat.

---

## Before you hit record (prep — not on the clock)

- Boot the CI ISO in QEMU: `qemu-system-x86_64 -cdrom astrion-grub.iso -m 256M`
- ⚠️ **Use a Tier-3 ISO (commit `a063698` or later).** The `demo.gif` in this
  folder was cut from `e95ee3c`, which predates per-process address spaces — it
  has no `isotest` command, and Beat 2's kill happens in the old shared-memory
  model. The four spine beats look identical either way, but the isolation
  narration below is only *true* on a Tier-3 build. Don't narrate Tier 3 over an
  old ISO.
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

## BEAT 2 — WOW: hostile program vs. the CPU · ~22s

**DO:** **FIRST — press Esc to close the Assistant window.** If it's still open,
its stale text floats over the Terminal and garbles the "(ring-3 isolation held)"
money line. (Clicking the Terminal only *refocuses* it — it does NOT hide the
Assistant, so the Esc is mandatory, not optional.) With a clean, full Terminal:
`exec rogue.elf`. It tries to write into kernel memory, faults, and is killed — a
line prints that the ring-3 isolation held. Then type `ls` to show the kernel is
fine.

**SAY:** "This program is hostile — it deliberately tries to attack the kernel.
Watch. The CPU itself catches it, kills *only* that program, and my OS doesn't
even flinch.
*(beat)* And it's not just protected from the kernel. Every program here gets
its own page tables. Two programs can load at the exact same address and land on
completely different physical memory — they cannot read each other, and that's
the CPU enforcing it, not my code asking nicely. Windows and Linux work the same
way. That's the point: this is the real protection model, in a kernel I wrote
from nothing."

> *Proof — the visible kill: audit-2026-07-16 frame 07 + serial "#PF … killed
> (ring-3 isolation held)"; re-confirmed post-Tier-3 in
> tier3-address-spaces/frames-hardening/14-exec-rogue.png.*
> *Proof — the spoken isolation claim: tier3-address-spaces/hardening-AUDIT.md
> row 3 (isotest ×3, same VA → distinct frames, no cross-visibility) +
> M5b-INDEPENDENT-REVIEW.md.*

---

### 📌 Why isolation is a SENTENCE here, not its own beat

The call, so nobody relitigates it at 11pm the night before:

- **Every spine beat is a visible state change.** A file appears. A program dies
  in red. Text streams out letter by letter. The machine turns off. `isotest`
  prints seven static lines whose payload is *two hex numbers being different*.
  It breaks the rule that makes the spine believable.
- **`isotest` isn't literally what the sentence describes.** It builds two
  address spaces **in kernel code** and walks the page tables — it never loads
  CR3 and never runs two ring-3 programs (see the comment at `shell.c:1159`).
  Narrating "watch two programs fail to see each other" over it is a small
  oversell, and small oversells are the exact thing our honesty rule exists to
  stop. The honest narration — "here are two address spaces the kernel built the
  same way `exec` does" — is true and boring. When the honest version of a line
  is boring, it isn't a beat.
- **Isolation is a qualifier, not a differentiator.** It doesn't separate us from
  Windows or Linux — they have it too. What it does is move Astrion out of the
  "impressive kid project" bucket and into the "this is an actual operating
  system" bucket. Spend demo *seconds* on the differentiators (offline AI that
  acts; a neural net on bare metal). Spend one *sentence* on the credential, and
  have the proof loaded for whoever asks.

**If you want it in the spine, here's the price** (a real option, ~2h of Koa +
one Rex boot — Viraaj's call, do NOT film it until it exists): two tiny ring-3
programs, `poke.elf` and `peek.elf`. `poke` writes a recognizable sentinel to a
fixed address in its own space and stays alive; `peek` reads the **same address**
and prints what it finds — anything but the sentinel. *That* is visible: two
programs, one address, one wrote, the other sees nothing. Two design notes so
nobody builds the weak version: (a) the address must be mapped in both and not
sitting under program code — a fixed scratch offset, not the image base; (b)
`poke` must still be **alive** when `peek` runs. If `poke` exits first, `peek`
gets a recycled zeroed frame and you've demonstrated frame-wiping, not
isolation — and a sharp audience member will catch the difference.

---

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

**#1 — `isotest`: the answer to "prove it" / "isn't this just a web page in a
window?"** This is the kill shot in Q&A, precisely because the questioner has
*asked* for detail — a static block of text is the right register for an answer
and the wrong one for a spectacle. In the Terminal: `isotest`.

```
A: uva 0x0000002000000000 -> frame 0x0000000002616000
B: uva 0x0000002000000000 -> frame 0x0000000002617000
distinct frames    yes
A isolated from B  yes
B isolated from A  yes
frames 55776 before / 55776 after
self-test: PASS (two spaces, same VA -> distinct frames, no cross-visibility, no leak)
```

**SAY:** "Same virtual address on the left of both lines. Different physical
memory on the right. Two programs at the same address, in different RAM, and
neither one can see the other's writes. Frame count identical before and after,
so nothing leaked." Run it twice — the frame addresses rotate every run and
always differ, which is itself worth pointing out ("those aren't hardcoded").
*(tier3-address-spaces/hardening-AUDIT.md row 3, ×3 runs; frames-hardening/05–07.)*

**Don't overstate it if they push.** Say this: *"It's per-process **memory**
isolation — the same model Linux uses. It is not a full security sandbox. There's
no network stack to attack in the first place, the syscall surface is small, and
I haven't fuzzed it or done any Meltdown/Spectre-class work. Two independent
adversarial code reviews found no isolation bypass, no corruption, no
use-after-free — but that's review, not proof."* That answer wins the room. A
bigger claim loses it.

- **"What's running?"** — open the **System Monitor**: live task list, context
  switches climbing, uptime advancing; survives 14 tasks without crashing.
  *(monitor-fix-2026-07-17.)*
- **Persistence across reboot** — write a file, Restart from the power menu, then
  `cat` it after the reboot; it's still there (editor autosaves first).
  *(shutdown-2026-07-17 items 3 & 5.)*
- **Ask the date** — Assistant: `what day is it` → real wall clock, "straight off
  the clock chip — I never asked a server." *(rtc-clock-2026-07-17 frame R3.)*

---

## "Does it run on real hardware?" — the honest answer *(rewritten 2026-07-18)*

The old framing in this repo — *"PS/2 only, you probably can't type on metal, we
need a USB stack first"* — was **wrong and too pessimistic.** Interactive metal
is days of work away, not months. State it like this:

**Guaranteed on essentially any x86-64 PC, today:** boot from USB (BIOS *or*
UEFI — the ISO is a verified hybrid), splash → desktop → live clock → mouse
cursor, and a real ACPI power-off. That's a legitimate "it runs on bare metal"
photo with zero new code. *(TIER4-usb-boot.md — CI artifact inspected: `BOOTX64.EFI`
+ BIOS GRUB + GPT-hybrid MBR.)*

**Typing on metal — three paths, cheapest first:**

| Path | Cost | Status | Typing happens… |
|---|---|---|---|
| **1. Buy the right machine** | ~$60–130 (est.) | **Zero new kernel code** | on the demo machine itself |
| **2. Serial console input** | 1–3h, done | **Code-complete, NOT booted** | on a laptop, over a cable |
| **3. Free CSM experiment** | 30 min, no code | Untried | on the demo machine itself |

1. **The right used machine.** A **Dell OptiPlex 7040 / 7050 SFF** — or HP
   EliteDesk 800 G1/G2, Lenovo ThinkCentre M700/M710 — still ships **real rear
   PS/2 ports and a real 16550 serial port** as standard soldered I/O. Our
   existing i8042 driver and 0x3F8 UART **just work**: full keyboard, mouse, and
   live kernel log, no new code. *One rule that matters more than saving $20:*
   only buy from a listing with a **rear-panel photo** showing the DB9 and the
   two round mini-DIN connectors — huge numbers of these were configure-to-order
   and the model number alone guarantees nothing. Prices are estimates, **not**
   live-verified. *(metal-test-machine.md.)*
2. **Serial console input.** Koa has built serial RX — COM1 at 0x3F8, IRQ4, fed
   into the existing keyboard ring. **It is code-complete and has NOT been
   booted** (see Koa's note in `crew/rex.md`); syntax, `-O2` codegen and a
   43-case logic harness pass, and that is *all* that has been proven. Until Rex
   boots it, do not put it in a demo. **The honest caveat, say it out loud on
   stage:** with serial input the typing happens at a terminal on the laptop,
   over a null-modem cable — *not* at a keyboard plugged into the demo machine.
   The machine on the table is genuinely running Astrion and genuinely
   responding; the keys are just coming down a wire. An audience is completely
   fine with that if you tell them. They are not fine with discovering it.
3. **The free experiment.** Boot the existing hybrid ISO in **CSM/legacy** mode
   with "USB Legacy Support" *and* "Port 60h/64h Emulation" enabled in setup. The
   firmware's SMM keyboard emulation survives our kernel taking over, so a USB
   keyboard may simply work. Zero code, coin flip, worth 30 minutes on any
   candidate machine.

**What we are deliberately NOT doing, and why it's the right call:** writing an
xHCI/USB stack. It's 6–12 weeks just to type a character *in QEMU*, then 1.5–3×
that again for one real machine — and most of the hard parts (BIOS handoff,
scratchpad buffers, context size, DMA ordering, chipset port routing) are
invisible in emulation, so passing in QEMU tells you almost nothing. Worse, a
*half-finished* driver is a **regression, not partial progress**: taking the
controller from the firmware (xHCI 1.2b §7.1.1 ownership handoff) is exactly
what kills the BIOS keyboard emulation we were relying on. The record is brutal
— ToaruOS's klange, 15 years of OS experience, worked it ~9 months and shipped
BIOS `INT 16h` instead; SanderR, the closest analogue to us (solo, from-scratch
C kernel), spent ~3 years and never got it working on metal; SerenityOS took ~4.5
years with a team. *(usb-keyboard-scoping.md — fully sourced.)*

**Still true, still say it:** disk persistence on metal needs ATA — we have an
ATA-PIO driver only, so on an NVMe/AHCI-only machine (most 2016+ laptops) the
filesystem works in-session but doesn't survive a reboot. Every demo beat is
in-session, so this doesn't touch the script.

---

## Hard honesty guardrails (memorize)

- If asked "can it answer questions like ChatGPT?" → **"No. It's ~212K numbers;
  it learned a style, not answers. The hard thing I'm showing is that a neural
  net runs at all on an OS I built from scratch."**
- Never type a factual question into the GPT and let it "answer" — it will make
  nonsense, and that reads as an oversell. Keep factual Q&A to the *intent*
  actions (files, memory, date, what's-running), which are deterministic and true.
- Never say "sandboxed," "secure," or "hardened against attackers" about the
  isolation. Say **"per-process memory isolation."** It's the true claim and it's
  already impressive.
- Never demo serial-driven typing without saying where the keyboard is.

## NEEDS-REX (confirm on the live build before relying on these on stage)

- ⚠️ **NEW / highest priority — nobody has run the demo spine on a Tier-3 ISO.**
  The four beats were verified on `e95ee3c` (pre-Tier-3, mouse + Assistant + dock,
  `demo.gif`). Tier 3 was verified on `a063698` (shell-focused, `sendkey`-driven,
  no mouse). **The combination is unverified.** Before anyone films: boot
  `a063698`+ and run the spine as written — Assistant write/read, Esc, `exec
  rogue.elf`, `isotest` straight after it in the same Terminal (does it fit
  on-screen without scrolling the kill line away?), GPT prompt, power off.
- **Serial RX (Koa's kbd.c/pit.c/kernel_mb2.c)** — code-complete, never booted.
  Its status gates whether path #2 above is real. Test plan is already in
  `crew/rex.md`.
- **Assistant `who are you` self-narration** — real in source (wm.c), a nice
  opener, but the on-screen wording isn't in a proof-dir screenshot yet. Don't
  hard-depend on it; the write→read beat is the verified anchor.
- **Splash accent color** — the polish build made it **blue (0x0A84FF)**, and the
  Tier-3 hardening boot re-confirmed it on-screen (serial: `readback @ accent =
  0x0a84ff OK`). Safe to say "the blue splash."
- **Clipboard** — verified by Rex on `e95ee3c`; still not in the spine (it costs
  seconds and adds nothing the write→read beat doesn't already prove).

## Proof dirs (all under tasks/)
audit-2026-07-16/AUDIT.md · shutdown-2026-07-17/AUDIT.md ·
monitor-fix-2026-07-17/AUDIT.md · rtc-clock-2026-07-17/ · rtc-redteam-2026-07-17/ ·
**tier3-address-spaces/** (DESIGN.md, M4-AUDIT.md, hardening-AUDIT.md,
M5-REVIEW.md, M5b-INDEPENDENT-REVIEW.md, frames-hardening/) ·
**usb-keyboard-scoping.md** · **metal-test-machine.md** · TIER4-usb-boot.md
