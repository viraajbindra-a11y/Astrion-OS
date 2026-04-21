# Launch Prep — running file for distribution + marketing

> Living document. Add ideas as they come, prune when shipped or rejected.
> Roadmap reference: `ROADMAP-DEC-2026-v3.md`

---

## The story (3 sentences max — keep refining)

**Current draft (Apr 20):**

> Astrion OS is the first AI-native operating system whose safety story is actually true.
> It writes code that passes its own tests, lets you rewind any change it makes, and refuses to modify itself unless five gates agree.
> Built by a 12-year-old, in the browser, free.

**Try-this-out variations:**
- "An OS where the AI shows its work, and you can take any of it back."
- "Spotlight asks Claude. Claude proposes. Astrion rewinds anything that goes wrong."
- "AI that operates the OS, not just chats from inside one."

---

## The launch-day target (Mon Dec 21, 2026)

**Tier 1 win:** 1k–5k downloads, 50–200 Pro purchases ($350–$1400 MRR), HN front page, 1 piece of press, 100+ active community.

**Posts queued for launch day (draft order):**
1. **6:00 AM PT — Product Hunt** — title: "Astrion OS — AI that operates the OS"; tagline: "First AI-native OS whose safety story is actually true."
2. **8:00 AM PT — Show HN** — title: "Show HN: Astrion OS — AI-native OS with verifiable code + reversible actions"; body: 4 paragraphs — what / how / safety / built by a 12yo
3. **9:00 AM PT — Twitter/X thread** — 8 tweets, video at top
4. **9:00 AM PT — r/InternetIsBeautiful** + **r/sideproject** + **r/ChromeOS** (cross-post)
5. **9:30 AM PT — Mastodon** — fosstodon + hci.social
6. **10:00 AM PT — Email blast** — to waitlist (1000+ if Phase 2 worked)

---

## URL options (decide this week)

| Option | Pros | Cons |
|---|---|---|
| `astrion.os` | Cleanest brand match | `.os` TLD pricey + browser autocomplete weird |
| `astrion.computer` | Matches "computer for AI" framing; cheap | Wordy |
| `tryastrion.com` | Action-oriented; cheap | Two-word URL friction |
| `astrion.ai` | Premium TLD; matches "AI-native" | Expensive ($100–$500/yr); .ai TLD perceived as cliché |
| `runastrion.com` | "Run Astrion" reads well | Generic |

**Lean (pre-decision): `astrion.computer`.** Decide by Sun Apr 26.

---

## Landing page (Phase 2, Week 22 — Jun 1–7)

**Above the fold:**
- 30-second autoplay video (no audio) of Spotlight working
- One-line headline (the "story" sentence)
- "Try it now" → opens `app.astrion.computer/` or wherever the OS itself lives
- "Get the ISO" button → GitHub release

**Three sections below:**
1. **What it does** — 3 demos with mini-videos: spec→code→app, rewind any action, red-team review
2. **How it stays safe** — diagram of the 5-gate self-mod flow + reversibility timeline
3. **Get early access** — email capture (Buttondown / ConvertKit free tier)

**Footer:**
- GitHub link, "About the founder" (12yo card), donations / Patreon link

---

## The 10-minute safety video (Phase 2, Week 23 — Jun 8–14)

Script outline (rough):

| Time | Beat | What to show |
|---|---|---|
| 0:00 | Hook | "Every AI app you use today can do whatever it wants. Here's how Astrion fixes that." |
| 0:30 | What's an AI-native OS? | Spotlight → "create folder X" → planner → done. Not a chat box, not a wallpaper — the OS actually moves. |
| 2:00 | Demo 1: AI writes itself an app | "build me a habit tracker" → spec → freeze → tests generate → code attempts → app in dock. Show the provenance trail. |
| 5:00 | Demo 2: Rewind anything | Confirm a destructive action → see the result → rewind → state restored. Show the branches command. |
| 7:00 | Demo 3: Self-mod gate | Trigger a self-mod proposal → watch all 5 gates run → red-team flags issue → user denies. The point: the AI cannot move forward without me. |
| 9:00 | Why a 12yo built this | "I'm 12. I want AI that doesn't make me lazy." Quick founder shot. |
| 9:45 | CTA | Download, try, send feedback. astrion.computer |

**Production:** OBS screen recording at 1080p, ScreenFlow or DaVinci Resolve free for cuts, voice-over recorded on iPhone Voice Memos in a closet.

**Cut-down assets from this:** 30s landing-page autoplay, 60s Twitter video, 4×15s TikTok cuts.

---

## Audience-building (start Week 21, Jun)

**Owned channels (build):**
- Twitter/X: @astrioncomputer (or whatever the URL ends up). 1 dev-log post per day starting June.
- Mastodon: fosstodon.org/@astrion. Cross-post.
- Discord server: invite-only beta first, public around Phase 7. Mods = friends.
- Newsletter: Buttondown free tier. Bi-weekly dev updates.
- YouTube: short demo clips after each phase ships.

**Earned channels (target):**
- Hacker News — Show HN at v0.9 beta (Phase 7, late Aug)
- r/InternetIsBeautiful — visual demos
- r/sideproject — full launch coverage
- r/ChromeOS, r/Linux — installable ISO angle
- IndieHackers — solo founder + revenue story
- Daring Fireball / The Verge / TechCrunch — press kit ready by Phase 9

**Influencers to pre-warm:**
- Marques Brownlee (MKBHD) — long shot but visual demo could land
- Linus Tech Tips — same
- ThePrimeagen / Theo — dev/coder audience that'd appreciate intent kernel
- Andrej Karpathy — he tweets about AI-native UIs occasionally; one tweet from him = 100k impressions

**DM targets (small list, real outreach in Nov):**
- ~20 tech writers / YouTubers / bloggers who'd resonate with "12yo builds AI OS"
- Curate the list in October

---

## Pricing (Phase 4, Week 43–44 — Oct)

**Free tier:**
- Full OS, all features
- 50 Anthropic-backed AI requests/day
- Bring-your-own-key for unlimited
- All built-in skills
- Community marketplace skills

**Pro tier — $7/month or $60/year:**
- Unlimited Anthropic-backed requests
- Priority Claude Sonnet (vs Haiku) for hard requests
- Sync across devices (cloud-encrypted graph)
- 5 exclusive Pro-only themes
- Early access to new features

**Lifetime — $129 (first 100 customers only):**
- Everything in Pro, forever
- Founder badge in Discord
- Name in CREDITS.md

**Stripe note:** You're 12. Talk to Dad in October. Either Dad's account or a separate business entity (LLC). DO NOT leave to November.

---

## Press kit (Phase 9, Nov 9–22)

Folder structure:
```
press-kit/
  logos/
    astrion-logo-light.svg
    astrion-logo-dark.svg
    astrion-logo-light-256.png
    astrion-logo-dark-256.png
    astrion-logo-light-1024.png
    astrion-logo-dark-1024.png
    astrion-mark-only.svg     # just the icon
  screenshots/
    01-desktop.png
    02-spotlight-planning.png
    03-redteam-panel.png
    04-rewind-timeline.png
    05-app-from-spec.png
    06-skill-marketplace.png
    07-settings-safety.png
  videos/
    teaser-30s.mp4
    full-demo-10min.mp4
  one-sheet.pdf      # single-page PDF, what / why / who / where
  founder-bio.md     # 200 words, mention 12yo, mention Naren / friends
  README.md          # press contact, embargo policy, fact sheet
```

---

## Risks to revisit weekly

- **AI cost spiral at scale.** If launch lands 10k users × 50 requests/day at $0.005/Haiku request = $2.5k/day burn rate before Pro converts. Hard caps in free tier are non-negotiable.
- **Bad press from a self-mod brick.** If M8.P5 ships and bricks even one tester's machine, the "safety story" tagline becomes a punch line. Phase 1 kill switch is real.
- **The 12yo angle backfires.** Some readers will dismiss the project as "kid project." Counter: lead with technical depth in writing aimed at devs; lead with the founder story in writing aimed at general press.
- **Anthropic API outage on launch day.** Test the full Ollama-only fallback before launch. Free tier should default to Ollama, not Anthropic, anyway.

---

## Things people will ask (have answers ready)

| Q | A |
|---|---|
| "Isn't this just ChatGPT in a window with a desktop wallpaper?" | No — the AI controls the OS via a typed capability registry with safety tiers. Show the spec→tests→code→app demo. |
| "How is this safer than ChatGPT?" | Three things: (1) every L2+ action is reversible via branching storage, (2) red-team agent reviews every plan, (3) self-mod has 5 gates including a value-lock that's cryptographically separated from the AI. |
| "Why a Linux ISO instead of just a web page?" | Both exist. The web version is the easiest way to try it. The ISO is for people who want it as their primary OS. |
| "Why a 12-year-old?" | I wanted an OS that didn't try to make me lazy as AI got smarter. So I built one. |
| "Is the safety stuff real or just marketing?" | Run the verification suite — 250+ tests. Read the M8 self-mod gate code. The cryptographic value-lock is signed and the kill-switch env var is checked at every disk-write. Theatre would be a checkbox; this is wiring. |
| "What happens when Anthropic releases their own AI OS?" | They might. Doesn't change anything. Astrion's bet is that the safety architecture matters; if Anthropic ships a similar one, two competitive products in a category is healthy. |
| "Why should I trust a kid with my computer?" | You shouldn't. You should trust the architecture. Read the code. Run the tests. Verify the gates. The whole point is that you don't have to trust the author. |

---

## Decisions log (append-only)

- **2026-04-20:** v3 roadmap adopted; this file created
- **(to fill in):** URL chosen
- **(to fill in):** Phase 1 path (Option A vs B)
- **(to fill in):** Stripe entity setup
