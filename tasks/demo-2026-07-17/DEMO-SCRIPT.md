# Astrion v2.0 — 60–90s Demo Script

*Created 2026-07-17 · rev 2026-07-18 (Tier 3) · **rev 2026-09-13** (network
sentence corrected; Beat 3 replaced — the neural-net beat is not in the
download; real-hardware answer is "emulator only"; the GIF must be re-cut)*

Every beat below is backed by a proof dir (cited at the end). Nothing here is
aspirational. The wow moments are all TRUE — that's the whole design. If you
can't reproduce a beat live, the same beat has a verifying screenshot to fall
back on.

**Spine (the wow beats, in order) — still 4 beats. Deliberately.**
1. The AI *does real things*, offline — write a file, read it back.
2. A hostile program tries to escape ring-3 and the CPU kills it — kernel lives.
3. Teach it your own phrasing — it learns, and it keeps it.
+ Close: it powers off for real.

**Golden rule while narrating:** sell the *actions*, the *isolation*, and the
*learning*. NEVER imply there is a smart chatbot in here. One oversell and the
room stops believing the true parts.

**Why the neural-net beat is gone (2026-09-13):** the transformer runtime is
real and was verified in-kernel on 2026-07-25, but it loads its weights from a
boot module and **the released ISO has no module in it** (`Makefile` `ui-test`
builds the ISO without one; `release-os.yml` ships that exact file). A beat the
audience cannot reproduce from the download is the definition of an oversell.
It comes back the day the ISO carries a brain. Until then the Assistant answers
"no brain loaded" to open-ended text, and the script never types any.

**Why per-process memory isolation is NOT a beat** — see the box after Beat 2.
Short version: it's the strongest *credential* we have and the weakest
*picture*. It's a sentence, not a beat.

---

## Before you hit record (prep — not on the clock)

- Boot the **release ISO**: `qemu-system-x86_64 -cdrom astrion.iso -m 512`
  (download from the os-v0.3 release — that is what strangers get, so that is
  what we film).
- ⚠️ **`demo.gif` in this folder is stale.** It was cut from `e95ee3c` (July),
  predates per-process address spaces, and its last beat is the neural-net
  gibberish that the release ISO cannot produce. Do not ship it anywhere. Rex
  re-records from the os-v0.3 ISO (see NEEDS-REX).
- Have the **Terminal** open and the **Assistant** one click away in the dock.
- Practice twice so the typing is smooth. Total target: **~80 seconds.**

---

## BEAT 0 — Boot & premise · ~12s

**DO:** Start QEMU. The blue Astrion splash appears, then the desktop — top bar
with a live clock, dock at the bottom.
**SAY:** "This is an operating system I wrote from scratch in C. No Linux, no
Windows underneath — that clock is reading the CMOS chip on the board. The
assistant you're about to see lives inside the kernel, and it has no path to
the network."

## BEAT 1 — WOW: the AI does real things, offline · ~22s

**DO:** Click the Assistant. Type: `write hello world to notes.txt` → Enter.
It prints **"wrote to notes.txt: hello world"**. Then type: `read notes.txt`
→ it prints the contents back.
**SAY:** "Here's the part that matters. I'm not asking it to chat — I'm telling
it to *do* something. 'Write hello world to notes dot txt.' It just made a real
file on the disk. 'Read notes dot txt' — there it is. Nothing left this machine.
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
  in red. The assistant admits ignorance and then stops being ignorant. The
  machine turns off. `isotest` prints seven static lines whose payload is *two
  hex numbers being different*. It breaks the rule that makes the spine
  believable.
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
  acts and learns). Spend one *sentence* on the credential, and have the proof
  loaded for whoever asks.

**If you want it in the spine, here's the price** (`poke.elf` and `peek.elf` now
exist in `kernel/src/` — Rex has to boot the pair and confirm the picture before
anyone films it): `poke` writes a recognizable sentinel to a fixed address in
its own space and stays alive; `peek` reads the **same address** and prints what
it finds — anything but the sentinel. *That* is visible: two programs, one
address, one wrote, the other sees nothing. Two design notes so nobody films the
weak version: (a) the address must be mapped in both and not sitting under
program code — a fixed scratch offset, not the image base; (b) `poke` must still
be **alive** when `peek` runs. If `poke` exits first, `peek` gets a recycled
zeroed frame and you've demonstrated frame-wiping, not isolation — and a sharp
audience member will catch the difference.

---

## BEAT 3 — WOW: teach it your phrasing · ~16s

**DO:** In the Assistant, type `gimme my files` → Enter. It says it doesn't
understand. Type `show me the files` → Enter. It lists them **and says it
learned that "gimme my files" means this too.** Type `gimme my files` again →
it lists them.
**SAY:** "It didn't get me. So I said it a way it does get — and it just
learned my way. Watch: same words as before, and now it works. That lesson is
written to the disk; it's still there after a reboot. Nobody's server learned
anything about me, because there isn't one."
> *Proof: learn_test.py in the UI suite (teach → reboot → still works), Rex's
> 11-boot red-team of learn.c in crew/koa.md. Happy path ONLY: never teach a
> phrase about a file that doesn't exist yet, and never offer to delete
> `learned.txt` on stage — both have known sharp edges.*

*(Alternate Beat 3 if the room is visual: `set the accent to teal` — the whole
desktop recolours live and the Assistant confirms it cleanly. Rex-verified,
demo-grade. Do NOT use "open the editor" as a beat: it works but doesn't
confirm on screen and leaves the command in the prompt.)*

## BEAT 4 — Close: it powers off for real · ~10s

**DO:** Click the top-bar power glyph → confirm → Shut Down. QEMU exits.
**SAY:** "And it's a real computer, so it turns off like one — a real ACPI
power-off, not a script pretending. That's Astrion: an operating system from
scratch, with the AI inside the kernel, doing real work offline — and it has no
path to the network."
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
isolation — the same model Linux uses. It is not a full security sandbox. The
syscall surface is small, the network code is new and unreviewed, and I haven't
fuzzed it or done any Meltdown/Spectre-class work. Two independent adversarial
code reviews found no isolation bypass, no corruption, no use-after-free — but
that's review, not proof."* That answer wins the room. A bigger claim loses it.

- **"Does it have networking?"** — honest answer: "A driver for the emulator's
  network card, and enough of a stack to ARP, get a DHCP lease, ping and
  resolve a name from the Terminal — `net arp` sends the first packet. Nothing
  is built on it. No browser. And the assistant isn't wired to it." *(net_test.py
  verifies it against a packet capture taken outside the guest.)*
- **"Where's the neural net?"** — "The runtime is in the kernel and I've run
  it; the weights load from a boot module that this ISO doesn't carry yet. When
  it does, it writes English-shaped nonsense, and I'll say so."
- **"What's running?"** — open the **System Monitor**: live task list, context
  switches climbing, uptime advancing; survives 14 tasks without crashing.
  *(monitor-fix-2026-07-17.)*
- **Persistence across reboot** — write a file, Restart from the power menu, then
  `cat` it after the reboot; it's still there (editor autosaves first).
  *(shutdown-2026-07-17 items 3 & 5.)*
- **Ask the date** — Assistant: `what day is it` → real wall clock, "straight off
  the clock chip — I never asked a server." *(rtc-clock-2026-07-17 frame R3.)*

---

## "Does it run on real hardware?" — the honest answer *(rewritten 2026-09-13)*

**"No. It has only ever booted in an emulator."** That is the whole answer, and
it is the only one that survives the follow-up question. The July revision of
this page said "guaranteed on essentially any x86-64 PC, today" on the strength
of inspecting the ISO's boot sectors; an inspection is not a boot. Until someone
photographs Astrion on a real screen, the words "today" and "guaranteed" do not
appear in anything we say about hardware.

If they want the plan:

- The ISO is a verified hybrid image (BIOS GRUB + `BOOTX64.EFI` + GPT-hybrid
  MBR — *TIER4-usb-boot.md*), so USB boot is the intended path, not a rewrite.
- Typing on metal, cheapest first: (1) a used **Dell OptiPlex 7040/7050 SFF** or
  similar with real PS/2 + serial ports — zero new kernel code, prices are
  estimates (*metal-test-machine.md*); (2) serial console input — code-complete,
  **never booted**, and if used the keys arrive down a cable from a laptop, which
  we say out loud; (3) the free CSM/"Port 60h/64h emulation" experiment — coin
  flip, 30 minutes, no code.
- **We are deliberately not writing an xHCI/USB stack.** 6–12 weeks to type a
  character in QEMU, more for one real machine, and a half-finished driver is a
  regression because claiming the controller kills the BIOS keyboard emulation.
  ToaruOS's author worked it ~9 months and shipped `INT 16h` instead; SerenityOS
  took ~4.5 years with a team. *(usb-keyboard-scoping.md — fully sourced.)*
- Disk persistence on metal needs ATA; we have ATA-PIO only, so on an NVMe/AHCI
  machine the filesystem works in-session and does not survive a reboot.

---

## Hard honesty guardrails (memorize)

- If asked "can it answer questions like ChatGPT?" → **"No. It runs the machine:
  files, settings, what's running, and it learns how you phrase things. There's
  a transformer runtime in the kernel, but the download doesn't carry weights
  yet, and when it does it writes nonsense — the hard part is that it runs at
  all in a kernel I wrote from scratch."**
- Never type open-ended text into the Assistant on stage. On the release ISO
  it answers "no brain loaded," which is honest and boring; keep to the intent
  actions (files, memory, date, what's-running, accent), which are deterministic
  and true.
- Never say "sandboxed," "secure," or "hardened against attackers" about the
  isolation. Say **"per-process memory isolation."** It's the true claim and it's
  already impressive.
- Never say "no network" or "can't phone home." Say **"the AI lives inside the
  kernel and has no path to the network."** The kernel has a NIC driver now.
- Never demo serial-driven typing without saying where the keyboard is.

## NEEDS-REX (confirm on the release ISO before relying on these on stage)

- ⚠️ **Re-record `demo.gif` from the os-v0.3 release ISO** with the spine as
  written above (Beat 3 = teach-it, not the neural net). The July GIF ends on a
  beat the download cannot reproduce. Same close-the-Assistant-first rule for
  Beat 2 (you found it; it's in the script now).
- **`poke.elf` / `peek.elf`** — the files exist; the two-program picture has not
  been booted and judged. Not in the spine until it has.
- **Serial RX (Koa's kbd.c/pit.c/kernel_mb2.c)** — code-complete, never booted.
  Its status gates whether metal path #2 is real.
- **Clipboard** — verified on `e95ee3c`; not in the spine. Rex has not red-teamed
  it since; keep it out.

Already witnessed by Rex on a real boot (crew/mira.md): `who are you` renders
cleanly and is a safe opener; the splash is blue (0x0A84FF); `set the accent to
teal` confirms cleanly and recolours the desktop live; "open the editor" works
but does not confirm on screen — keep it out of copy.

## Proof dirs (all under tasks/)
audit-2026-07-16/AUDIT.md · shutdown-2026-07-17/AUDIT.md ·
monitor-fix-2026-07-17/AUDIT.md · rtc-clock-2026-07-17/ · rtc-redteam-2026-07-17/ ·
**tier3-address-spaces/** (DESIGN.md, M4-AUDIT.md, hardening-AUDIT.md,
M5-REVIEW.md, M5b-INDEPENDENT-REVIEW.md, frames-hardening/) ·
**usb-keyboard-scoping.md** · **metal-test-machine.md** · TIER4-usb-boot.md ·
kernel/tools/learn_test.py · kernel/tools/net_test.py
