# LAUNCH — Wednesday 2026-10-14

*Written 2026-09-13. Date relocked 2026-10-14 by the founder: "lock in today."
This is the only plan file that is live. Every other roadmap, checklist and
handoff in the repo carries a SUPERSEDED header pointing here. One date, one
artifact, one checklist.*

**The file used to be called LAUNCH-SEPT.md.** It is LAUNCH.md now, with no
month in the name, because a plan file that carries a date in its filename goes
stale in the one place nobody edits. That is the third time this repo has had a
dead date on a live document.

## Why Sep 28 did not happen

Nothing was decided and nothing was cut — the tag was simply never pushed, and
no one was watching the date. Between Sep 13 and Oct 14 the work that DID land
was real: both sanitizer findings in the engine, the negation bug (the
Assistant wrote a file when told not to), the A/B filesystem so a crash
mid-sync cannot destroy the image, the GDT/IDT moved ahead of every parser so a
fault prints instead of silently rebooting, and the whole visual pass. The
product got better. The release did not happen. Those are different things and
this file exists to stop them being confused again.

**The rule from here: the tag is pushed the day the suite is green, not the day
the work feels finished.**

## What launches

The from-scratch kernel, as a downloadable ISO a stranger can boot in five
minutes. Nothing else.

The web-desktop freeze (`PLAN-SEPT.md`, decided 2026-09-13) ran to Oct 1 and
has EXPIRED — it is Oct 14. The track is thawed, but it is still not what
launches today, and two things are owed on it before anyone looks: valentina's
deferred item 13 (the web CSS still disagrees with the kernel on accent colour,
button shape and logo) and `js/apps/settings.js:443,454`, which still says
"Ollama Settings" and "Ember runs on qwen3:8b" — untrue since the Qwen mod was
renamed Kindling.

**The whole launch is five things:**

1. **The ISO.** Tag `os-v0.3` fires `.github/workflows/release-os.yml`, which
   publishes `astrion.iso` + sha256 as the release marked *Latest*, gated on
   all 14 UI tests. The release body says plainly that this ISO has no brain
   module in it.
2. **The README.** Leads with the kernel: one sentence, the QEMU one-liner, the
   link to `docs/try-astrion.md`. Done 2026-09-13.
3. **The demo GIF.** Recorded by rex from the os-v0.3 ISO, following
   `tasks/demo-2026-07-17/DEMO-SCRIPT.md` (Beat 3 = teach-it; no neural-net
   beat). Dropped into the README where the placeholder comment sits.
4. **One Show HN post**, Oct 14.
5. **One r/osdev post**, Oct 14.

The first line of both posts is the QEMU one-liner. The second line is the
sentence: *an operating system written from scratch in C, with the AI built
into the kernel; the AI has no path to the network.* No Product Hunt, no
TikTok, no Twitter thread, no Dev.to. The audience today is zero (0 stars, 0
forks); one honest post in each of the two rooms where people boot strange
kernels is the entire distribution plan.

## The ten-line checklist

- [ ] `os-v0.3` tag pushed; release-os.yml green; release marked Latest — founder
- [ ] `releases/latest` resolves to `astrion.iso`, not an Electron build — founder (rex confirms with a fresh download)
      *(workflow ready since Aug 5, has still never fired. This is the one item that has blocked the other nine for two months.)*
- [ ] rex boots the *released* `astrion.iso` (not a CI artifact) in QEMU and runs `docs/try-astrion.md` top to bottom — rex
- [ ] rex boots the released ISO in VirtualBox once, so the doc's "unconfirmed" line can be deleted or kept honestly — rex
- [ ] demo GIF recorded from the released ISO, committed, README placeholder replaced — rex (record), founder (commit)
- [ ] `docs/try-astrion.md` release link resolves to the exact release page — mira
- [x] GitHub repo description + topics say "from-scratch kernel, AI inside the kernel", not Linux/GTK3 — **done 2026-09-13**
- [ ] Show HN draft + r/osdev draft written, QEMU one-liner first, no claim the ISO cannot reproduce — mira, rex reads both before posting
- [ ] Every claim in README, try-astrion.md and the release body re-checked against the released ISO — rex
- [ ] Post both on Oct 14 — founder

## What is NOT in this launch, said plainly

Ember does not run in this ISO. The 341M model trained on the 5080 has never
been loaded into the kernel, and the engine inside the download has only ever
executed random test weights. The release body says so. Until `ember.astrion`
is exported off the PC and rex has booted it, "the AI runs inside the kernel"
is a thing the code can do and not a thing this download does — and the posts
must not claim otherwise.

koa also found the reason it would not have worked even if it were there: the
kernel's tokenizer is Qwen's and Ember speaks GPT-2 tiktoken, so the first real
`ember.astrion` would have produced wrong tokens and never stopped. That is
item 1 on his list and it is unfinished.

## Cut order (decided 2026-09-13)

**On Sep 20, if the release is not live, cut from the top down until it is.**
Each line is a thing that can be removed from the ISO or the story without
touching anything below it:

1. **Network stack out of the ISO.** e1000 + ARP/DHCP/ping/DNS and `net_test.py`
   are the newest, least-reviewed code and the release gate's slowest external
   dependency (DNS needs the CI host's resolver). Drop them from the build and
   the suite; the kernel loses nothing a stranger will see.
2. **Learned phrasings.** `learn.c` and `learn_test.py`. rex found three
   demo-visible defects; if they are not closed, the Assistant ships without
   learning and Beat 3 becomes the accent beat.
3. **Chrome / Snake.** The window-frame polish and Snake are the surfaces with
   the most open cosmetic reports. Ship square corners and no game before
   shipping late.
4. **Real Ember falls back to the demo brain.** If a brain module is ever meant
   to ride in the ISO, the from-scratch 341M Ember is not a launch dependency:
   the tiny test brain (or no brain, as today) is what ships, and the release
   body says so.

Nothing below the network stack is cut before the network stack. Nothing is
added to the ISO between now and Sep 28.

## Dates that are dead

Aug 31 (YOUR-CHECKLIST.md), Dec 21 (ROADMAP-2026.md, ROADMAP-DEC-2026-v3.md,
kernel/README.md), "end of September, browser in scope" (PLAN-SEPT.md, now
amended). The browser is October at the earliest (`PLAN-SEPT.md`). If a date is
not in this file it is not a date.
