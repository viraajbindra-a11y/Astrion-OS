# Contributors Log

This file tracks everyone who has contributed to Astrion OS. **Astrion is built to make real money** — this isn't a volunteer forever project. This log is the proof-of-contribution that determines revenue share when the money starts flowing.

## The revenue model (as of 2026-04-11)

Astrion has 4 revenue streams in the pipeline:

1. **AI markup** — a small convenience margin on every AI call routed through Astrion. BYO your own API key = zero markup. Use the built-in AI = you pay Viraaj a few cents on top of model cost.
2. **Install fee** — the web version stays free forever. The installed bootable ISO is a one-time paid download (target: $5–10).
3. **Skills marketplace** — 70/30 split, creators keep 70%. Ships with M7 (~month 10).
4. **Enterprise tier** — bigger packages for teams. Ships with M8+.

**Expected timeline:** M3 (month 4) is when the premium AI tier ships and real cash starts flowing. Anyone on this log before M3 is an "early contributor" — that's the status that matters.

## Viraaj's promise

I'm 12 and I can't sign contracts. But I commit in writing here:

- **This log is the source of truth** for who helped when and how much.
- **When Astrion starts making money, early contributors get revenue share.** Not vague equity — actual cash from actual sales, proportional to what you contributed before the revenue started.
- **I will be generous.** If Astrion hits, the people who helped me when I was 12 and had nothing will be taken care of.
- **No contracts, just my word.** Which is all I have right now, but it's real.

## The format

Every entry looks like this:

```
### <Name> — <Jobs they picked>
First contribution: <date>
Role tier: <friend | contributor | core>

#### Contributions
- [YYYY-MM-DD] <What they did> — shipped in <commit or release>
- [YYYY-MM-DD] <What they did> — shipped in <commit or release>

#### What they've received
- Credit in release notes <version>
- Their name in <app/wallpaper/about dialog>
- ...
```

## Role tiers (my internal ranking)

| Tier | What it means | Revenue share when money starts |
|---|---|---|
| **friend** | Did 1-2 starter tasks, helped once or twice. | Small thank-you bonus (~$10-50) from first revenue. Credit in release notes. |
| **contributor** | Did 5+ meaningful contributions, stayed involved over weeks. | Small % of monthly revenue (proportional to contribution), paid out monthly or quarterly. Credit + named mention in the About Astrion dialog. |
| **core** | Contributed regularly for months, shaped real features, reliable. | Meaningful ongoing revenue share. Early access to enterprise deals. Possibly formal equity if/when I can legally sign (I turn 18 in 6 years — if Astrion lasts that long, we'll revisit). |

Nobody starts as core. Everyone starts as friend. Advancement happens by doing the work consistently.

**Important:** the earlier you contribute, the higher your effective cut. Someone who joins in month 8 does NOT get the same treatment as Koa/Naren/Lauren/Jian who joined day 1, even if they contribute the same total amount of work. Early = bigger multiplier.

---

## The team (as of 2026-04-11)

### Koa — Bug Hunter + Tester
First contribution: TBD (starter tasks sent)
Role tier: friend

#### Contributions
- Picked 2 jobs on 2026-04-11 right after the presentation
- (First bug / first tester report pending)

#### What he's received
- (Nothing shipped yet)

---

### Naren — Hype Person + Designer
First contribution: 2026-04-11 — **Astrion Brain hero wallpaper** (confirmed by Viraaj in chat)
Role tier: friend (strong candidate to level up to `contributor` if this pace keeps up — a marketing-grade hero asset on day 1 is significant)

#### Contributions
- Picked 2 jobs on 2026-04-11
- **Asked the "how does pay work" question before the presentation, which prompted Viraaj to add the "The Deal" slide to the deck.** Meaningful contribution to transparency. Credit in lessons for that one.
- **[2026-04-11] Hero wallpaper — "Astrion Brain"** — a full-bleed cyberpunk illustration of dual neural networks (brains) connected across a galaxy background, with circuit-pattern edges and the ASTRION lockup. Shipped as `assets/wallpapers/astrion-brain.png` and promoted to the **default wallpaper** across the web OS, the installer, and (Day 9) the bootable ISO. This is a marketing-grade asset — it visually represents the dual-brain architecture (S1/S2) from the old PLAN.md and will be the first thing every Astrion user sees. Shipped in commit `a16a21b` on 2026-04-11 as part of Polish Sprint Day 1.

#### What he's received
- **Default wallpaper slot** across every Astrion install starting from v0.2.0 — web OS, Electron desktop app, bootable ISO. First thing users see.
- Row in `assets/wallpapers/CREDITS.md` under his name (Naren).
- Named line in the v0.2.0 release notes under "Contributors" (Day 9 deliverable).
- This contribution counts toward the "early contributor" tier when revenue starts flowing at M3 (~month 4). Per Viraaj's promise at the top of this file, early = bigger multiplier.

---

### Lauren — Writer + UX Reviewer
First contribution: TBD (starter tasks sent)
Role tier: friend

#### Contributions
- Picked 2 jobs on 2026-04-11

#### What he's received
- (Nothing shipped yet)

---

### Jian — Ideas Person + Namer
First contribution: TBD (starter tasks sent)
Role tier: friend

#### Contributions
- Picked 2 jobs on 2026-04-11 (first day on the team)

#### What he's received
- (Nothing shipped yet)

---

## AI pair-programmer

### Claude (Anthropic)
Role tier: tool, not a human contributor

Claude wrote most of the code alongside Viraaj. It's an AI and doesn't get equity or revenue share — but every commit that Claude co-authored has `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` in the commit message as proper attribution.

---

## How to update this file

Whenever a friend contributes something (a bug report, a wallpaper, a suggestion, a post, anything):

1. Add an entry to their `#### Contributions` section with the date and what they did
2. If you shipped their work, add a `shipped in <commit>` reference
3. Add what they received (credit in notes, name in About, etc.) to their `#### What they've received` section
4. If they level up to `contributor` or `core` tier, update their `Role tier`

Review this file every release. Never delete entries — it's the historical record.
