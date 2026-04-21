# Astrion OS — Roadmap to v1.0 (Apr 20 → Dec 21, 2026)

**Today:** Monday, April 20, 2026. **Finish line:** Sunday, December 21, 2026.
That's **36 calendar weeks**. Accounting for school + exams + life +
weekends, call it **~24 productive weeks of dev time**.

## TL;DR

Plan v2 architecture is substantially shipped (M0–M8 substrate). The work
between now and December is **making it real** — hardware soak, real-model
soak, third-party automation, browser-inside-Astrion, marketplace, voice,
public beta, v1.0 release. No moonshots; every phase lands.

The cadence rule: **every week ships a visible improvement**. If a phase
starts slipping, cut — don't extend.

---

## December Finish Line — what "done" means

By **Dec 21, 2026**, all of these are true:

1. **`astrion-os-1.0.0-amd64.iso` is publicly downloadable** from the
   GitHub release. Signed SHA-256, < 2 GB, boots on UEFI + BIOS.
2. **100+ real users** have installed it and sent at least one feedback signal.
3. **The full demo** (Spotlight phrase → skill → 2-col preview → red-team →
   clone-preview → apply → rewind) works on **5+ laptop models** including
   the Surface Pro 6.
4. **M4 chain works end-to-end on gpt-oss:16b AND claude-haiku-4-5**. The
   pomodoro / habit-tracker demos produce docked apps with real provenance.
5. **All M8 safety gates** (golden, value-lock, red-team, typed-confirm,
   rollback-plan) have been exercised in production — at least one real
   self-mod proposal applied cleanly + one rollback executed.
6. **Website + docs** live (`astrion.computer` or a GitHub Pages site) with
   download, install guide, skill authoring tutorial, safety story.
7. **First revenue attempt** live — donation link, Patreon, or early-access
   tier. Doesn't need to be profitable; just live.
8. **Tabbed browser inside Astrion** works. Chromium-as-app stays as the
   fallback.
9. **Voice I/O** works for English — say "astrion, organize downloads" and
   the skill dispatches.
10. **Public skill marketplace** with 50+ entries, browseable + installable
    from inside the OS.

Anything past this list ships in 2027.

---

## Phase-by-phase plan

### Phase 0 — Sunday demo sprint (Apr 20–26, 1 week)

**Deliverable:** the demo succeeds on the Surface Pro 6 with remote Ollama
(9800X3D + 5080 + gpt-oss:16b).

- Chat side panel with 3 modes: Normal / Plan / Bypass
- 5 new capabilities wired to planner: `system.setVolume`,
  `system.setBrightness`, `system.shutdown`, `system.lockScreen`,
  `terminal.exec`
- Clone-preview wrapper — one-click "rehearse in branch, show diff, apply"
- App Store activation (wire js/apps/appstore.js to the M7 skill installer)
- ISO E2E verified on the Surface Pro 6 — boot, connect to remote Ollama,
  drive the demo queries

**Cut first if behind:** the clone-preview wrapper (existing Spotlight
interception already shows previews; a dedicated wrapper is polish).

**Exit:** a 60-second recorded demo video showing 5 features working.

### Phase 1 — Hardening + real-model soak (Apr 27 – May 10, 2 weeks)

**Deliverable:** M0–M8 all verified against real Ollama AND real Anthropic.
Bug list zero-critical.

- Real-Anthropic M4 chain end-to-end (you said Agent Core is the trigger —
  if not yet, use the funded key NOW for soak)
- Real-Ollama M4 code.generate verified with the post-fix validator +
  prompt (acbaa4c + 57840e0)
- Golden integrity check running 48h continuous boot soak, no drift
- v03 expanded to 250+ tests covering every M7+M8 path
- Documentation pass: every new file gets a header comment with its
  contract; every capability in capability-providers.js gets one-line docs

**Cut first if behind:** v03 expansion past 200 tests. Core already covers
the safety-critical paths.

**Exit:** one test-runner pass cleanly completes against both Ollama and
Anthropic in the same boot.

### Phase 2 — M8.P5 real self-modification (May 11 – Jun 7, 4 weeks)

**Deliverable:** a proposal that passes all 5 gates actually writes to
disk, and the system auto-rolls-back if golden check trips after apply.

- Disk-write path — takes the proposal's diff, applies it atomically to
  the target file, re-verifies hash against new expected value (or
  triggers rollback)
- Automatic rollback — on post-apply golden failure, apply the proposal's
  `rollbackDiff` to revert + emit `selfmod:rolled-back`
- Keystore — per-install ECDSA key for signing value-lock baseline.
  Private key in secure OS keychain (keytar on Electron? macOS Keychain
  Services? TBD). Defer asymmetric sig to Phase 2.b if it costs >1 week.
- Synthetic proposal generator — creates 10 known-good + 10 known-bad
  proposals to exercise the gates without a real AI agent
- Kill-switch env var `ASTRION_SELFMOD_APPLY=never` that hard-disables
  disk writes regardless of gate state

**Cut first if behind:** asymmetric signing. SHA-256 + kill-switch is
enough for v1.0; real signing is a post-v1 upgrade.

**Exit:** 10 synthetic proposals apply + rollback cleanly without
human intervention across a 24h soak.

### Phase 3 — Tabbed browser inside Astrion (Jun 8–28, 3 weeks)

**Deliverable:** a WebKit-based tabbed browser app with real chrome.
Chromium-as-app remains as fallback (never ripped out).

- Multi-tab window with new-tab / close-tab / reorder
- Address bar with DuckDuckGo/Google search fallback
- Bookmarks (stored as graph nodes, type='bookmark')
- History (last 500 visits, graph node per visit)
- Downloads manager with pause/resume
- Back/forward/reload
- Dev-tools toggle

**Cut first if behind:** downloads pause/resume (just trigger browser
default download), dev-tools.

**Exit:** the browser is the default "click a link" handler; 10 tabs open
simultaneously, bookmarks survive reboot.

### Phase 4 — Voice I/O + VLC automation (Jun 29 – Jul 12, 2 weeks)

**Deliverable:** you can say "hey astrion, …" and the planner dispatches.
VLC plays/pauses/nexts via capability.

- Web Speech API wired: `voice:wake` event on wake word, `voice:query`
  event with transcript. Dispatches through the normal intent:plan path.
- Speech synthesis for responses (optional user toggle)
- VLC capability bridge: `vlc.play`, `vlc.pause`, `vlc.next`, `vlc.volume`
  via D-Bus (standard VLC interface)

**Cut first if behind:** speech synthesis output. Text-only is fine.

**Exit:** "hey astrion, play music" launches VLC and plays.

### Phase 5 — Marketplace backend (Jul 13 – Aug 9, 4 weeks)

**Deliverable:** hosted catalog of skills, browse + one-click install
from inside Astrion.

- Backend: Cloudflare Workers or Deno Deploy, serves `/api/skills/catalog`
  JSON + individual `/api/skills/<id>.skill` endpoints
- Upload flow: `astrion-skill publish <file>` CLI hashes + uploads. Queue
  for moderation (manual for v1; red-team auto-review in v2).
- Catalog UI in the App Store app
- Install flow — downloads .skill, validates signature, adds to local
  registry, user approves via M5 interception gate

**Cut first if behind:** automated moderation — start with manual review
of every upload; automate in v2.

**Exit:** 50 skills in the catalog, you can install any of them in
under 10 seconds.

### Phase 6 — ISO polish + hardware soak (Aug 10–30, 3 weeks)

**Deliverable:** ISO tested on 5 different laptops + Surface Pro. UI
polish pass. Bug triage to zero-P0.

- Hardware matrix: Intel laptop (Wi-Fi chip A), AMD laptop (Wi-Fi chip B),
  Surface Pro 6, Framework 13, ThinkPad T-series
- Fix whatever breaks per chip/driver
- UI polish: animations, transitions, empty states, error states
- Accessibility pass: keyboard-only navigation works for every primary
  flow, screen reader labels on every button

**Cut first if behind:** the Framework / ThinkPad tests. Surface + one
each of Intel/AMD is the minimum.

**Exit:** boot-to-desktop on 5 laptops, demo works on all, zero-P0 bugs.

### Phase 7 — Public beta launch (Aug 31 – Sep 27, 4 weeks)

**Deliverable:** v0.9 beta ISO published, website live, 50+ testers
downloaded it.

- Website: `astrion.computer` (or GitHub Pages) with: download CTA,
  install guide, skill authoring tutorial, safety story, about page
- Demo video (3–5 min) highlighting the safety triple + skill marketplace
- Release notes + changelog tooling
- Beta feedback form (Typeform or Google Form for v1; proper tracker in v2)
- Announcement post (Hacker News, Reddit r/linux, Mastodon, X)

**Cut first if behind:** professional demo video — record a screencast
with voiceover; polish later.

**Exit:** 50 downloads + 10 pieces of feedback within the first week
of launch.

### Phase 8 — Beta iteration (Sep 28 – Nov 8, 6 weeks)

**Deliverable:** bugs triaged, features requested triaged, 90% of P0
bugs fixed, at least 2 community skills submitted.

- Weekly bug-fix sprints
- Two P1 features picked based on user feedback (not preset)
- Community skill authoring — one guest skill per week in the catalog
- Performance pass if latency is a complaint

**Cut first if behind:** the two P1 features — defer to v1.1.

**Exit:** zero P0 bugs open, P1 backlog under 20 items.

### Phase 9 — v1.0 prep + polish (Nov 9 – Dec 6, 4 weeks)

**Deliverable:** v1.0 ISO cut, launch materials ready, press/demo video
polished.

- Final hardware soak on all 5+ laptops
- Release ISO signed with real SHA-256 + GPG (if possible)
- v1.0 launch blog post
- Polished demo video (cut from beta recordings)
- Press kit: logo, screenshots, one-sheet
- First revenue attempt: Buy Me a Coffee link or Patreon page

**Cut first if behind:** GPG signing (SHA-256 alone is fine for v1.0).

**Exit:** final ISO passes smoke test on Surface Pro 6 + one other laptop
without intervention.

### Phase 10 — v1.0 launch (Dec 7–21, 2 weeks)

**Deliverable:** Astrion OS 1.0 is out.

- Launch week: announcement posts on HN / Reddit / Mastodon / X / IndieHackers
- Monitor feedback, hotfix any launch-day critical bug
- Onboard new users
- Collect stories for a v1.1 retrospective

**Exit:** `astrion-os-1.0.0-amd64.iso` is the top asset on the GitHub
release page; 500+ downloads first week; at least one story in public
somewhere.

### Phase 11 — Buffer + retro (Dec 22–31, ~1 week)

- Year-end retrospective
- Plan v3 (what 2027 looks like)
- Holiday break

---

## Cut-first list (in order) if any phase slips

When a phase is behind, cut from this list — top first:

1. Asymmetric signing (keep SHA-256)
2. Automated marketplace moderation (keep manual)
3. Speech synthesis output (keep text-only voice)
4. Dev-tools in the tabbed browser
5. Downloads pause/resume
6. LibreOffice macro bridge (already not in v1)
7. Multi-agent specialization (already not in v1)
8. Workflow visual flow builder (already not in v1)
9. Third-party app automation beyond VLC (already not in v1)
10. Screen-understanding (OCR + element detection) — never in v1

---

## If-we-have-extra-time list

Some phases may finish early. Pick from here, top first:

1. One more laptop in the hardware matrix (e.g., MacBook via UTM, or a
   cheap Chromebook with Linux installed)
2. Workflow visual flow builder (v1 MVP — drag 3 block types, no UI polish)
3. A second "featured" AI agent persona (e.g., "Creative Writer" that
   specializes the planner's prompt toward writing tasks)
4. Multi-language support for Voice (Spanish, Mandarin)
5. LibreOffice automation bridge
6. One example third-party automation (e.g., Thunderbird "send email" cap)
7. Community Discord / forum

---

## Shipping cadence (never break)

- **Every commit:** auto-pushed to origin via the launchd job.
- **Every day:** at least one meaningful diff.
- **Every week:** a weekly retrospective note in `tasks/weekly-YYYY-WW.md`
  listing shipped + stuck + next.
- **Every 2 weeks:** a test ISO build on GitHub Actions, verified to boot.
- **Every 4 weeks:** a demo-able ISO that a stranger can download and try.

---

## Measured metrics (look at weekly)

1. `v03-verification.html` test count — must grow or hold
2. Commit count per week — target 5+
3. ISO build success rate — target 100%
4. Real-model chain success rate (Ollama + Anthropic) — target 90%+
5. Beta download count (from Phase 7 on)
6. Open P0 bugs — target 0 from Phase 6 on
7. Open community issues responded to within 48h

---

## Revenue timeline (parallel to features)

Staged, honest pricing — no SaaS compute-included lies.

| Phase | Revenue move | Target |
|---|---|---|
| Phase 0–1 | Free + open source | build audience |
| Phase 4 (post-voice) | Donation link (Buy Me a Coffee) | $50–200/mo |
| Phase 5 (post-marketplace) | Patreon early-access tier ($5/mo) | $200–500/mo |
| Phase 9 (pre-launch) | Premium AI tier — higher daily S2 budget, priority | $500–2k/mo |
| Post v1.0 (2027) | Paid skills 70/30 split on marketplace | marketplace fees |
| 2027+ | Enterprise tier ($20/seat/mo) | B2B |

Note: the v1 revenue model is "voluntary." Nobody has to pay. The user
can bring their own API key OR pay for hosted inference. This keeps the
software genuinely free and "premium" genuinely optional.

---

## Risks that could kill the timeline

**High risk:**
- M8.P5 disk-write self-bricks the system during testing. Mitigation:
  kill-switch env var + rollback executed in a fork, never on live files.
- Real-model JSON-mode tolerance on non-Ollama models. Mitigation:
  already tolerant parser + format:'json' + retry loop.
- Hardware incompatibility on enough laptops to block public beta.
  Mitigation: Phase 6 matrix is 5 devices; if 3+ fail, go public with
  a narrower supported-device list.

**Medium risk:**
- Solo dev bandwidth. You have school, sleep, life. Mitigation: the
  cut-first list is ordered; if you're behind, cut and keep shipping.
- Naren/team availability for QA / naming / hype. Mitigation: per the
  persona file, they help via tester/designer/UX/writer/namer roles —
  not on the critical-path code.

**Low risk:**
- A model vendor (Anthropic/Ollama) changes their API and breaks the
  integration. Mitigation: provider abstraction already in ai-service.js.

---

## What gets written where

- `tasks/weekly-YYYY-WW.md` — weekly sprint logs
- `tasks/lessons.md` — lessons learned per session (append-only)
- `PLAN.md` — architectural milestones (update status when a phase ships)
- `ROADMAP-2026.md` — this file; timeline + phases + cuts (don't touch
  once written; let reality diverge and note it in weekly logs)
- `SESSION_HANDOFF.md` — per-session handoff (overwrite each time)
- `docs/*.md` — user-facing + developer-facing guides

---

## The one sentence

Astrion OS ships v1.0 on December 21, 2026 as the first AI-native
operating system whose safety story is actually true — verifiable code,
reversible actions, Socratic defaults, skill marketplace, and five
gates between "propose a self-mod" and "write to disk."
