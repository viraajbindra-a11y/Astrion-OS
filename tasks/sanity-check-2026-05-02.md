# Astrion OS — Honest Sanity Check (2026-05-02)

> Brutal audit, no spin. Snapshot from week 18 of 35 to v1.0.

## TL;DR

**Architecturally sound. Behind on shipping. Known debt three weeks old.**

The substrate is real: the safety triple ships while Anthropic publishes papers about it. 216/216 tests pass. The ISO boots. The lockfile is clean. The intent kernel + capability registry + 5-gate self-mod that the advisor message proposed building — already done. All 76 apps register cleanly. All key kernel modules parse clean.

The risk is **execution, not concept**. The demo's headline (M8.P5 self-upgrade) has never been verified end-to-end on a frontier model. 20+ apps still crash on localStorage quota errors three weeks after the bug was filed. Distribution work hasn't started. 6 days of post-demo silence on the repo.

The moat is **shipped safety + open + free + boots from USB**. Competitors can't easily copy that combination. But the moat doesn't matter if v1.0 doesn't actually land Dec 21.

---

## ✅ Verified true (with evidence, today)

| Claim | How verified |
|---|---|
| 76 apps registered cleanly | 76 `.js` in `js/apps/`, all exporting `register*`, all called in `boot.js` (popup/native/normal blocks) |
| 165 lessons documented | `grep -cE "^[0-9]+\."` in `tasks/lessons.md` = 165 |
| 216/216 verification green | Re-ran in preview today: `summary: "216 / 216 passed — all green"` |
| Golden lock integrity | `node tools/sign-golden.mjs --check` → `all 18 golden files match lock` |
| Key kernel files parse | `node --check` clean on intent-executor / intent-planner / capability-providers / self-upgrader / spotlight / chat-panel / boot |
| Skill manifest consistent | All 20 `.skill` files in manifest exist on disk |
| ISO boots UEFI → GRUB → kernel → X | QEMU/OVMF on Sunday: serial log `BdsDxe: starting Boot0001`, screenshot of ASTRION-branded GRUB, screenshot of dark wallpaper + cursor |
| Real Ollama planner path works | Sunday: qwen2.5:7b returned valid 2-step plan in 15.9s for canonical compound query |
| 30+ capabilities live | `grep -c "registerCapability("` in capability-providers.js confirms |
| GitHub Pages deploy | `last-modified` matches push timestamp; deployed code includes voice mic |
| TODO/FIXME backlog: 0 | Only 2 markers in entire codebase, both benign |

---

## ⚠ Claimed but unverified (real risk)

| Claim | Why unverified | Risk |
|---|---|---|
| **M8.P5 self-upgrade end-to-end on `gpt-oss:16b`** | Local qwen2.5:7b timed out >30s; remote PC URL never tested | **Highest.** Beat 11 is the demo headline. If JSON shape mismatches, retry-loop saves you — but slow. |
| M4 chain (spec → tests → code → app) end-to-end on real model | Same — only stub-verified | High. 4-attempt code-gen loop may not converge on a real model. |
| Hardware compat beyond Surface Pro 6 | Matrix is Aug per roadmap | Medium. Beta crash rate could push v1.0. |
| Boot time <1.5s target | Unmeasured | Low. Achievable but unverified. |
| Auto-updater on installed system | Untested end-to-end | Medium. Lesson 17 says updater only touches web files, not C binaries. |
| Ollama install via curl in chroot works on every host | Tolerant fallback exists, but real-host CI is rare | Low. |

---

## 🔧 Known debt — unfixed since 2026-04-12 (3 weeks old)

From `SESSION_HANDOFF_MUSIC_AUDIT.md`:

| Issue | File | Status today | Severity |
|---|---|---|---|
| `Function()` injection same as ai-service had | `js/shell/spotlight.js:1355` | **Still vulnerable.** Permissive regex allows `Math.constructor` breakout. ai-service.js was fixed; spotlight wasn't. | Moderate (single-user OS, but real) |
| ~~18 apps unguarded `localStorage.*`~~ | ~~js/apps/*.js~~ | **FALSE ALARM (corrected 2026-05-02).** `js/lib/safe-storage.js` globally monkey-patches `Storage.prototype.{getItem,setItem,removeItem}` with try/catch. boot.js imports it first. Every localStorage call in every app gets the safe wrapper for free. The "20+ apps unguarded" complaint was already mitigated at the substrate level before I re-flagged it. Lesson #166. | Resolved |
| Drag pointer listeners leak on window close | `js/kernel/window-manager.js:361-389` | Unfixed | Low — slow leak only |
| Escape listener leak in launchpad close | `js/shell/launchpad.js:89` | Unfixed | Low |
| Activity-monitor 2s refresh re-adds listeners | `js/apps/activity-monitor.js:156-184` | Unfixed | Medium — leak grows over time |
| XSS via `err.message` in innerHTML | `js/apps/appstore.js:394, 478, 530` | Unfixed | Moderate — error messages from network can be malicious |
| `file-system.js` rename data loss between delete+put | `js/kernel/file-system.js:106-118` | Unfixed | Medium — rare but data loss |
| Chess has no real engine | `js/apps/chess.js` | Known incomplete | Low — game, not safety-critical |

**Three weeks. Zero commits closing these.** Not show-stoppers individually, but a credibility issue at v1.0 review time.

---

## 🏗 Architectural concerns

1. **76 apps is the trap PLAN.md flagged.** Audit recommended 3 primitives + 48 templates. The CI moratorium prevents *new* apps but doesn't reduce existing 76. Demoting to templates is unstarted work — and it's the thing that actually proves the "intent kernel makes apps obsolete" thesis. Without demotion, the 76 apps look like 76 traditional apps with AI on top.

2. **`boot.js` has 76 register calls in three separate blocks** (popup, native, normal) — every new app needs three updates. Maintenance hazard. Lesson #53 territory.

3. **`index.html` hardcodes CSS for ~13 apps.** Per-app CSS via `existsSync` only fires in `/app/:appId` (native mode). Web mode = 60+ apps render unstyled. Visible to anyone who tries the web demo at GitHub Pages.

4. **`nova-shell.c` is 4068 lines of manual-memory C.** Big bug surface. Lesson 164 (`*/` in C comment) and 165 (made-up `.installed` field) just bit two weeks ago. Expect more.

5. **No headless UI test runner.** 216 tests are kernel-level. UI breakages can land silently. Demo Sunday: lockfile drift wasn't caught by tests; only by my running the actual flow.

6. **Single-source-of-truth violations.** App count appears as `63+` in CONTRIBUTING.md, `50` in some docs, `52` in old PLAN, `76` in code, `80` in some lessons. Drift everywhere.

---

## 📅 Roadmap reality check vs Dec 21

| Phase | Target | Actual | Verdict |
|---|---|---|---|
| Phase 0 (Apr 20-26): Real-API soak | 16/20 adversarial pass, M4 produces real app, demo recorded, Phase 1 path picked | Demo happened; Beat 11 unverified; M4 chain unverified; no Phase 1 path picked | **Partially slipped** |
| Phase 1 (Apr 27 → May 24): Hardening OR M8.P5 deepen | 250+ tests, boot time measured/improved, all critical bugs fixed | Day 6 of 28: 0 commits since lockfile fix; tests still 216; bugs above unfixed | **Behind** |
| Phase 2 (May 25 → Jun 28): Distribution Engineering | URL bought, landing page live, 10-min safety video, soft launch | Today is May 2 — should start in 3 weeks; per competitive brief, **start now** | **Slipping unless action this week** |
| Phase 3 (Jun 29 → Aug 9): Marketplace + killer feature | Not yet | TBD | TBD |
| Phase 4 (Aug 10 → Sep 27): Hardware + beta | 5 laptops, 100+ downloads | Hardware testers not recruited | TBD |
| Phase 5 (Sep 28 → Dec 21): v1.0 launch | Stripe, press kit, RC, launch day | $7/mo Pro tier needs Dad's account; nothing built | **Largest risk** |

**Solo-dev calendar math:** 26 productive weeks remaining. Phase 0 already burned ~1 of those. Phase 1's first week burned with 0 commits. **Real budget: 24 productive weeks.** Five phases × ~5 weeks each = 25. Tight.

---

## 🎯 The 5 things to fix THIS WEEK (in priority order)

### 1. Real-AI soak: M8.P5 propose path on `gpt-oss:16b`
- Why: Demo headline. Never verified end-to-end with a frontier model.
- Cost: 2-3 hours when remote PC is up.
- Test: `upgrade yourself js/apps/notes.js` → propose card renders → all 5 gates pass → disk writes → reload sees change → undo works.
- If it fails: write a lesson, fix the prompt or schema validator, retry.

### 2. Spotlight `Function()` injection fix
- Why: Known security debt. ai-service.js was patched 3 weeks ago; spotlight.js wasn't.
- Cost: 1 hour. Port the safe-math-eval recursive-descent parser from ai-service.js.
- Test: existing math tests in v03 pass; add 3 hostile inputs (`Math.constructor("x")()`, etc.) — they must reject.

### ~~3. Settings.js localStorage hardening~~ — already shipped
- safe-storage.js globally patches Storage.prototype; settings.js inherits the safety. **No work needed.** (Audit corrected.)

### 4. Distribution unblock
- Register `astrion.computer` (or `.os` / `tryastrion.com`). DNS propagates 48h.
- Land the new landing page (already written, uncommitted at `website/index.html`).
- 10-min safety video script outline (write but don't record yet).
- Cost: ~3 hours total.

### 5. Demo retro + weekly-2026-18.md
- Capture demo learnings as lessons #166-#170 before they rot.
- Record the actual outcome of Sunday's demo (still unknown to me).
- Cost: 30 min if done today, 2 hours if done in two weeks (after memory fades).

---

## 🚫 What to explicitly NOT do this week

- **Don't rebuild the Intent Router or Central Registry.** Already shipped. The advisor message proposes them as new work; they're not.
- **Don't add more apps.** CI moratorium exists; the 76 are already too many. Lesson #1 from PLAN.md.
- **Don't start the tabbed-browser** (Chromium-as-app is fine — already cut in v3 roadmap).
- **Don't build voice I/O** beyond what shipped (mic input + TTS output already exist).
- **Don't optimize boot time yet.** Phase 1 hardening, not Phase 0 sprint.

---

## 🟢 What's actually ahead of schedule

- **M8 substrate is fully shipped.** v3 roadmap explicitly said "if M8.P5 disk-write looks risky by end of May, defer to v1.1." Astrion already has it shipping in main with rollback. **5 weeks ahead** of the v3 cut-line.
- **Skill marketplace substrate done.** 20 bundled skills, parser, registry, scheduler all live. Cloud catalog deferred but the local substrate is solid.
- **216/216 tests** vs the v3 target of "250+ by end of Phase 1." Off by 34, not catastrophic.
- **Native C shell at 8 polish passes.** No competitor has both web + native shells.

---

## 🎯 Honest competitive verdict

Astrion's claim "**the AI-native OS whose safety story is actually true**" is backed by code today. No other product in the market — not Brain Tech Natural OS, not Microsoft Copilot+, not Apple Intelligence, not Anthropic Cowork, not OpenClaw — ships:

- 5-gate verifiable self-modification
- Branch + rewind on every L2 action
- Red-team review on every L2+ capability
- Anti-rubber-stamp Socratic tracker
- Open source + free + boots from USB

The combination is unique. **The moat is real, but only if v1.0 ships clean by Dec 21.**

The blue sky is shrunk. Brain Tech owns "intent-based phone OS." OpenClaw owns "open-source local agent." Microsoft + Apple own "AI in your existing OS." Astrion owns: **"the AI-native desktop you can boot from USB, audit line-by-line, and actually trust."**

---

## What's NOT in this audit (acknowledged)

- Real-user behavior — N=1 (the founder) is not a sample
- Performance under load — graph-store with 10k+ nodes untested
- Memory leaks in the 76 apps — only 7 audited in 2026-04-12 pass
- Cross-tab race conditions — graph-migration handles concurrent tabs best-effort, real-world untested
- Security review — the 5-gate substrate hasn't been adversarially reviewed by anyone outside the project

---

## Update 2026-05-02 (later in day)

- **Sunday demo was CANCELLED, not run.** Lesson #169 added. Verification debt unchanged but forcing function shifted from "tomorrow's audience" to "v1.0 launch Dec 21."
- **Domain decided: `astrion-os.com`.** Landing page meta updated. Dad handles billing.
- **First two hardware testers in pipeline.** Friend with Chromebook (free) + AMD Lenovo (user-funded). Phase 4 hardware matrix: 2/5 testers committed (Surface Pro 6 + Chromebook + AMD Lenovo).
- **Self-hosted AI** added to roadmap — Astrion should host its own AI brain, not depend on a remote PC. See `tasks/self-hosted-ai-proposal-2026-05-02.md`.
- **Competitive-watch agent** scheduled via `/schedule` — runs weekly, searches for Brain Tech US expansion / OpenClaw OS-mode / Anthropic CoEvoSkills product / MS Recall rollback signals, notifies on hit.

---

*Audit date: 2026-05-02. Re-audit: 2026-06-01 (or after any major shipping milestone, whichever first).*
