# LAUNCH — Sunday 2026-09-28

*Written 2026-09-13 from the founder's decisions. This is the only plan file
that is live. Every other roadmap, checklist and handoff in the repo carries a
SUPERSEDED header pointing here. One date, one artifact, one checklist.*

## What launches

The from-scratch kernel, as a downloadable ISO a stranger can boot in five
minutes. Nothing else. The web desktop is frozen until Oct 1 (`PLAN-SEPT.md`).

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
4. **One Show HN post**, Sep 28.
5. **One r/osdev post**, Sep 28.

The first line of both posts is the QEMU one-liner. The second line is the
sentence: *an operating system written from scratch in C, with the AI built
into the kernel; the AI has no path to the network.* No Product Hunt, no
TikTok, no Twitter thread, no Dev.to. The audience today is zero (0 stars, 0
forks); one honest post in each of the two rooms where people boot strange
kernels is the entire distribution plan.

## The ten-line checklist

- [ ] `os-v0.3` tag pushed; release-os.yml green; release marked Latest — founder
- [ ] `releases/latest` resolves to `astrion.iso`, not an Electron build — founder (rex confirms with a fresh download)
- [ ] rex boots the *released* `astrion.iso` (not a CI artifact) in QEMU and runs `docs/try-astrion.md` top to bottom — rex
- [ ] rex boots the released ISO in VirtualBox once, so the doc's "unconfirmed" line can be deleted or kept honestly — rex
- [ ] demo GIF recorded from the released ISO, committed, README placeholder replaced — rex (record), founder (commit)
- [ ] `docs/try-astrion.md` release link resolves to the exact release page — mira
- [ ] GitHub repo description + topics say "from-scratch kernel, AI inside the kernel", not Linux/GTK3 — founder (`gh repo edit`)
- [ ] Show HN draft + r/osdev draft written, QEMU one-liner first, no claim the ISO cannot reproduce — mira, rex reads both before posting
- [ ] Every claim in README, try-astrion.md and the release body re-checked against the released ISO — rex
- [ ] Post both on Sep 28 — founder

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
