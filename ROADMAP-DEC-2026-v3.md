# Astrion OS — Road to v1.0 on December 21, 2026 (v3, post-audit)

**Today:** Mon Apr 20, 2026 — 246 days to launch.
**Working weeks (school + life adjusted):** ~26.
**Audit:** This is v3. v1 was overconfident. v2 (`ROADMAP-2026.md`) is solid but wasn't written knowing what shipped 2026-04-18→20 and underweights distribution. This file is the operational version.

---

## Where you actually are (not where the prior roadmap thought)

Substrate as of commit `b6e89d4` (auto-push job confirms pushed):

| Milestone | Status | Honest gloss |
|---|---|---|
| M0 — Native shell + ISO | ✅ shipped | Surface Pro 6 boots; Ctrl+R is harmless |
| M1 — Intent Kernel | ✅ shipped | Single-shot capability dispatch, fast path |
| M2 — Hypergraph Storage | ✅ shipped | Graph nodes + edges + COW + rewindMutation |
| M3 — Dual-Process Runtime | ✅ shipped | Ollama S1 + Anthropic S2 + calibration tracker |
| M4 — Verifiable Code Gen | ✅ shipped | spec→tests→sandbox→code→app-in-dock |
| M5 — Reversibility | ✅ shipped | Branch, interceptor, rewind, PONR, typed confirm |
| M6 — Socratic + Red-Team | ✅ shipped | All P1–P4 + chaos + Settings dashboard |
| M7 — Skill Marketplace | 🟡 substrate | DSL + parser + 20 skills + scheduler. **Cloud catalog not built.** |
| M8 — Self-Modification | 🟡 substrate | All 5 gates run. **Disk-write side (P5) not implemented.** |

**170/170 verification tests** green offline (stubbed AI). **Real-API soak: incomplete.**

The architectural moat is built. **What's left is making it real, soaking it, getting it on people's machines, and not bricking anyone's laptop in the process.**

---

## The brutal truth about December

**Three things must be true on Dec 21 for "shipped" to mean shipped:**

1. **A stranger downloads astrion-os-1.0.0-amd64.iso, boots it on their laptop, and it works.** Not Surface Pro 6. Not your hardware. *Their* hardware.
2. **Ten of those strangers send back a "this is cool" + a bug report within the first week.** If nobody downloads or nobody bothers to send feedback, v1.0 is a tree falling in an empty forest.
3. **The safety story (M4–M6–M8) survives one hostile review by someone who actually understands AI agent safety.** Not your dad, not your friends. A LessWrong-tier reader. If their take is "this is theatre," v1.0 is theatre.

**Everything below is in service of those three sentences.** When you're tired in October and tempted to cut a corner, ask: *does cutting this break one of those three?* If yes, don't cut. If no, cut hard.

---

## What the v2 roadmap got right (keep)

- **Phase ordering:** Hardening → self-mod write → browser → voice → marketplace → hardware soak → beta → polish → launch. Correct sequencing.
- **Cut-first list:** Asymmetric signing, marketplace moderation, speech synthesis, dev-tools — all correctly classified as cuttable.
- **Cadence rule:** weekly retro, biweekly ISO, monthly demoable build. Keep.
- **Revenue model:** Voluntary, BYOK-or-pay, no SaaS lies. Keep.

## What v2 underweights (this is the v3 delta)

1. **Distribution is its own engineering problem, not a launch-day post.** v2 has a 4-week beta phase and a 2-week launch phase. That's it. The actual distribution work — building an audience, finding the right channels, learning what people don't understand from your demo — needs to start in **June**, not September.

2. **The safety-story IS the marketing.** Every "AI OS" project in 2026 will claim safety. Astrion is the only one where it's actually true (verifiable code + reversibility + red-team + 5-gate self-mod). The launch needs a 10-minute video that *demonstrates* this in a way no competitor can match. v2 mentions a "demo video" — this needs to be the centerpiece, not an afterthought.

3. **M8.P5 is the highest-risk path on the roadmap.** Disk-write self-mod can brick the OS. v2 allocates 4 weeks. **If P5 isn't safely working by end of May, cut it from v1.0 entirely** and ship M8 as "all 5 gates exist; disk-write deferred to v1.1." Better to ship without P5 than to ship with a P5 that bricks 1 in 100 users.

4. **Real-API soak is a 1-day task, not a 2-week phase.** It's blocking everything else (the entire safety story is unverified at the LLM boundary until this happens). **Do it Week 1. Today.**

5. **Browser-inside-Astrion is a v2 feature, not v1.** The Chromium-as-app fallback already works. Three weeks of tabbed-browser work is three weeks not spent on the safety-as-marketing video, distribution, or hardware soak. **Cut from v1.0.**

6. **Voice I/O is a v2 feature, not v1.** "Hey Astrion" is a Wow demo for hands-on users but adds zero to the safety story and consumes 2 weeks. **Cut from v1.0** unless Phase 1 finishes a week early.

---

## The v3 plan (week-by-week)

Total: 35 weeks. Build assumes ~70% on-time delivery (so deliver 35w of work in 26 productive weeks). Buffer baked in.

### Phase 0 — Reality Check (Apr 20 → Apr 26, this week)

**Goal:** end the week knowing M4–M8 actually work against real Claude AND real Ollama, no stubs.

- **Mon Apr 20** *(today)*: read this file, decide whether to adopt or revise it
- **Tue Apr 21**: get a funded `ANTHROPIC_API_KEY`. Set in server env. Set `localStorage.setItem('nova-ai-provider', 'anthropic')`. Run the v0.3 deliverable query in Spotlight. Watch the planner go. If it works: log a lesson. If it breaks: that's Wednesday's work.
- **Wed Apr 22**: real-API soak — 20 adversarial queries from `tasks/agent-core-soak-test-BLOCKED-2026-04-11.md`. Record results.
- **Thu Apr 23**: real-Ollama M4.P3.b code.generate test (was untested per SESSION_HANDOFF). 3 attempts, watch the failure-loop converge.
- **Fri Apr 24**: fix whatever broke. Write the bugs you found into `tasks/lessons.md`.
- **Sat Apr 25**: Surface Pro 6 boot — fresh ISO build, install, drive demo with remote Ollama. Record it.
- **Sun Apr 26**: weekly retro in `tasks/weekly-2026-17.md`.

**Kill switch:** If real-API soak finds >5 critical bugs, freeze all forward work and spend the next week ONLY on hardening. The roadmap below assumes substrate is real. If it isn't, every later phase is built on sand.

**Exit criterion:** A 60-second video showing Spotlight → "create a folder…" → planner → preview → red-team → confirm → done. Posted to your private Discord/Drive for posterity.

---

### Phase 1 — The Decision: M8.P5 or No (Apr 27 → May 24, 4 weeks)

**Goal:** Either ship M8.P5 disk-write OR commit to deferring it. No middle ground.

**Option A (Ambitious): Build M8.P5**
- Week 17 (Apr 27 – May 3): Disk-write atomic apply + per-install ECDSA key + kill-switch env var
- Week 18 (May 4–10): Synthetic proposal generator (10 good + 10 bad)
- Week 19 (May 11–17): 24h soak — 10 proposals apply + rollback cleanly without intervention
- Week 20 (May 18–24): Buffer + bugs + the inevitable "the rollback didn't actually rollback" debugging

**Option B (Realistic): Defer M8.P5**
- Week 17–20: Hardening pass. Real-API soak deepens to 250+ tests. Bug-fix triage. Performance work. Lazy-load all 80 apps. Boot time <1.5s. Empty/error states for every app.

**Pick by end of Phase 0.** The ambitious path is real; the realistic path is honest. If your gut says "I might miss," pick B and use the time to make v1.0 *actually polished* instead of *technically more advanced and broken*.

**Either way, Phase 1 ends:** `v03-verification.html` at 250+ tests, ISO boot time measured + improved, all known critical bugs fixed.

---

### Phase 2 — Distribution Engineering (May 25 → Jun 28, 5 weeks)

**Goal:** A landing page exists, the launch demo video exists, the audience-building flywheel is spinning.

- Week 21 (May 25–31): **Pick the URL.** `astrion.computer` or `astrion.os` or `tryastrion.com` — register today. DNS propagates over 48h.
- Week 22 (Jun 1–7): **Landing page v1.** Single static page. Hero: 30-second autoplay demo (no audio). Three sections: "What it does" / "How it stays safe" / "Get early access." Email capture. Hosted on GitHub Pages — no backend yet.
- Week 23 (Jun 8–14): **The 10-minute safety video.** This is the linchpin. Script it: 90s "what's an AI OS?", 3min "watch it write itself an app and pass tests", 3min "watch it refuse a self-mod that fails red-team", 2min "rewind anything that goes wrong", 30s "download the beta."
- Week 24 (Jun 15–21): **Soft launch on r/SideProject + IndieHackers + your school + Discord servers.** Goal: 100 visitors, 30 emails. **Watch session recordings (PostHog free tier).** DM every signup, ask what's confusing.
- Week 25 (Jun 22–28): **Iterate.** Fix the top 3 confusion points. The landing page after Week 25 should make sense to a stranger in 30 seconds without your explanation.

**Exit:** 100+ email signups on the waitlist. The 10-min video has 500+ views.

**Kill switch:** If the soft launch hits crickets (<20 signups), the messaging is wrong. STOP shipping features and spend a week with friends and strangers walking through your landing page. The product can be perfect and the message can still kill you.

---

### Phase 3 — Skill Marketplace + One Killer Feature (Jun 29 → Aug 9, 6 weeks)

**Goal:** The marketplace is live. There are 50+ installable skills. One feature exists that makes people screenshot and share.

- Week 26 (Jun 29 – Jul 5): **Marketplace backend.** Cloudflare Workers or Deno Deploy. `/api/skills/catalog` JSON. Manual moderation — no auto-review yet.
- Week 27 (Jul 6–12): **Catalog UI in App Store app.** Browse, install, rate.
- Week 28–29 (Jul 13–26): **Seed 50 skills.** 30 you write. 20 from friends/community via PR. Cover real use cases: "organize downloads," "morning brief," "study plan generator," "screenshot annotator," etc.
- Week 30 (Jul 27 – Aug 2): **Pick the one screenshot-worthy feature.** Candidates: live "AI building an app in front of you" pane / the M5 "rewind any L2 action" timeline / the red-team panel showing real risks. Pick one. Polish it to perfection.
- Week 31 (Aug 3–9): **Launch the feature on Twitter/X.** One thread with a 30-second video. Goal: 1000 views. If it works, do it weekly.

**Exit:** 50 skills live, 1000+ Twitter impressions on the killer-feature post.

**Kill switch:** If marketplace upload+install round trip isn't working by end of Week 27, defer marketplace to v1.1 and ship "20 built-in skills" only. Don't ship a marketplace that doesn't work.

---

### Phase 4 — Hardware + Beta (Aug 10 → Sep 27, 7 weeks)

**Goal:** ISO works on 5+ laptops. 100+ beta downloads. 20+ feedback signals.

- Week 32–34 (Aug 10–30): **Hardware matrix.** Surface Pro 6, one Intel laptop, one AMD laptop, one Framework, one ThinkPad. Boot each, run demo, file every bug. Fix per-chip issues (Wi-Fi firmware, GPU drivers, audio).
- Week 35 (Aug 31 – Sep 6): **Public beta announce.** v0.9 beta ISO published. Show HN post with the 10-min video. Goal: front page for 4+ hours, 200 upvotes.
- Week 36–38 (Sep 7–27): **Beta iteration.** Daily bug triage. Fix or defer every issue within 48h. Bake learnings into v1.0.

**Exit:** 200+ beta downloads, 30+ pieces of feedback, 0 P0 bugs.

**Kill switch:** If beta crashes on >50% of test laptops, push v1.0 launch by 4 weeks. Better a delayed v1.0 than a humiliating one.

---

### Phase 5 — v1.0 Launch (Sep 28 → Dec 21, 12 weeks)

**Goal:** Ship Astrion OS 1.0 on Mon Dec 21 with infrastructure to handle a viral hit.

- Week 39–42 (Sep 28 – Oct 25): **Final polish.** Every animation, every empty state, every error state. Onboarding tour. First-run wizard. Tooltips for first 3 actions. Sample data on fresh install.
- Week 43–44 (Oct 26 – Nov 8): **Stripe + Pro tier.** *Note: you're 12 — Dad's Stripe account or a separate business entity. Solve this in October, not December.* Pro tier: $7/mo or $60/yr. Lifetime $129 for first 100 customers (urgency device). Pro unlocks: unlimited Anthropic budget, priority Claude Sonnet access, exclusive themes.
- Week 45–46 (Nov 9–22): **Launch infrastructure.** Press kit. Logo files (4 sizes, light + dark). Screenshots. One-sheet PDF. Founder bio (mention you're 12 — *that's the story*). Email outreach to 20 tech writers/youtubers.
- Week 47 (Nov 23–29): **Pre-launch beta wave.** 100 invited testers. Fix everything they break.
- Week 48 (Nov 30 – Dec 6): **Final v1.0 RC.** Feature freeze. Bug fixes only.
- Week 49 (Dec 7–13): **v1.0.0 cut + final hardware soak.** Sign the ISO. Tag the release.

**Dec 14–20 (launch week):**
- **Mon Dec 14:** Soft launch on r/SideProject + IndieHackers. Warm-up.
- **Wed Dec 16:** Email blast to waitlist (now 1000+ if Phase 2 worked).
- **Sun Dec 20:** Final review. Sleep early.

**Mon Dec 21 — LAUNCH DAY:**
- **6:00 AM PT:** Product Hunt post live
- **8:00 AM PT:** Show HN post live (don't ring fingers; have 5 friends ready to upvote and comment in first 30min)
- **9:00 AM PT:** Twitter/X thread, Mastodon, Reddit r/InternetIsBeautiful + r/sideproject
- **All day:** Live in HN comments, respond to every PH comment in <10min
- **Have:** Backup server capacity, AI cost monitoring, on-call discord channel for testers

**Dec 22–31:** Sustain. Press follow-ups. Bug-fix sprint based on launch traffic. Year-end retro.

---

## What gets cut and when

**Cut from v1.0 today (don't even start):**
- Tabbed browser inside Astrion (Chromium-as-app stays)
- Voice I/O (push to v1.1)
- LibreOffice macro bridge
- Multi-agent specialization
- Workflow visual flow builder
- Screen-understanding (OCR)
- M8.P5 *if Phase 0 reveals it's risky*
- Asymmetric signing for self-mod (SHA-256 + kill switch is enough)
- Automated marketplace moderation (manual is fine for v1)

**Cut if any phase slips by >1 week (in this order):**
1. Marketplace backend → ship "20 built-in skills" only
2. Hardware matrix → Surface + Intel + AMD only (3 laptops not 5)
3. The 10-min safety video → 3-min screencast with text overlays
4. Pro tier billing → BYOK-only at launch, billing in v1.1
5. Beta phase polish → ship rough, fix in v1.0.1

**Cut LAST (these are load-bearing):**
- Real-API soak (Phase 0)
- Landing page + waitlist (Phase 2)
- Hardware soak on at least Surface (Phase 4)
- The launch day itself (Phase 5)

---

## Risks ranked

1. **(High likelihood × High impact)** M8.P5 disk-write bricks a tester's machine. → Kill switch env var. Rollback in fork. **If unsure by end of May, defer to v1.1.**
2. **(High × High)** Solo dev burnout. → 26 working weeks budgeted vs 35 calendar. Take real Sundays off. Don't compress sprints (lesson #70).
3. **(Med × High)** Real-API JSON tolerance fails on Anthropic. → Already solved for Ollama via `format: 'json'`. Anthropic equivalent: prompt + retry-loop already built. Phase 0 finds the actual gaps.
4. **(Med × High)** Distribution flops. Nobody downloads. → Phase 2 starts the flywheel in June, not September. If Phase 2 hits crickets, fix messaging before continuing features.
5. **(High × Med)** Anthropic deprecates a model mid-roadmap. → Provider abstraction in `ai-service.js`. Use the `claude-api` skill for migration prompts.
6. **(Med × Med)** Hardware compat — beta crashes on >half of test laptops. → Phase 4 buffer + narrower supported-device list at launch.
7. **(Low × High)** Stripe/legal blockers because you're 12. → Solve in October. Talk to Dad TODAY.
8. **(Low × Med)** Competition (someone else ships an "AI OS" with a better demo first). → Doesn't matter. Be best at *one* thing (the safety story is real). First-mover advantage is overrated; product-market-fit isn't.

---

## What launch success looks like (be honest about tiers)

**Tier 1 (most likely — call this the win condition):**
- 1k–5k downloads first week
- 50–200 Pro purchases ($350–$1400 MRR)
- HN front page, 1 piece of press
- 100+ active community members
- Foundation to keep building in 2027

**Tier 2 (good outcome):**
- 5k–20k downloads
- 500+ Pro ($3500+ MRR)
- TechCrunch / The Verge / Wired writes about it
- "AI-native OS" enters the zeitgeist
- Investor interest (don't take money — keep optionality)

**Tier 3 (lottery ticket — Sam Altman tweets):**
- 100k+ downloads
- 5000+ Pro ($35k+ MRR)
- Acquihire offers
- 12-year-old on TechCrunch front page

**Plan for Tier 1. Hope for Tier 2. Tier 3 is Tier 3.**

If launch lands at "<500 downloads, no press" — **don't panic**. Iterate, relaunch in 6 weeks with a better demo. The product is what matters, not Day 1.

---

## What to do this week (operational)

**Mon Apr 20 (today):**
- Read this file. Disagree. Push back. Edit the cuts.
- Confirm or revise: are you taking the ambitious M8.P5 path or the realistic hardening path?
- Talk to Dad about Anthropic API key + Stripe account future-proofing
- Pick the launch URL. Register tonight.

**Tue–Fri Apr 21–24:**
- Phase 0: real-API soak (per Phase 0 day-by-day above)

**Sat Apr 25:**
- Surface Pro 6 demo recording

**Sun Apr 26:**
- Weekly retro
- If Phase 0 surfaced >5 critical bugs, freeze forward work
- If Phase 0 was clean, start Phase 1 on Monday

---

## Files to maintain (don't let drift)

| File | Purpose | Update cadence |
|---|---|---|
| `ROADMAP-DEC-2026-v3.md` | This file. The plan. | Don't touch. Reality diverges in weekly logs. |
| `tasks/weekly-YYYY-WW.md` | Weekly retro: shipped + stuck + next | Every Sunday |
| `tasks/lessons.md` | Lessons learned (append-only) | Every session |
| `PLAN.md` | Architectural milestone status | When a phase ships |
| `SESSION_HANDOFF.md` | Per-session handoff | Overwrite each session |
| `tasks/launch-prep.md` | Distribution + launch ideas | As they come |

---

## The one sentence (revised)

> **Astrion OS ships v1.0 on Monday December 21, 2026 — the first AI-native operating system whose safety story is actually true and whose 12-year-old founder lived to see it land.**

The second clause matters. Pace yourself. Take Sundays. Don't compress sprints. The architecture is built. The remaining work is grinding it into something a stranger can install without bricking their laptop, and convincing them it's worth installing in the first place.

Good luck. The substrate you've shipped is genuinely impressive. Now go finish it.
