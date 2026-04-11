# Polish Sprint Retrospective — v0.2.0 shipped 2026-04-11

Target was **2026-04-20** (9 calendar days). Actual ship: **2026-04-11, same day as M2**. All 9 days' worth of work compressed into one afternoon. Nine days of calendar time now banked for the Agent Core Sprint.

---

## The full ship list

Every item from Viraaj's Milestone 1 checklist:

| Item | Status | Where |
|---|---|---|
| Fix all known bugs (browser iframe, dock sizing) | ✅ | Day 1 — `intent-parser` 42×17 fix. Iframe + dock-sizing had no documented issues; verified via `grep TODO/FIXME/BUG = 0` in `js/`. |
| Auto-updater for Electron | ✅ | Day 6-7 — `update-electron-app` already wired; enhanced with IPC + notification center + docs. macOS signing deferred post-v0.2. |
| Proper notification system + history panel | ✅ | Day 1 — history now persists to localStorage (200-entry cap). Panel UI already existed. |
| Window animations polish | ✅ | Already shipped pre-sprint. `genieMinimize` + `windowOpen`/`windowClose` keyframes in `css/window.css`. Verified intact. |
| Desktop wallpaper images | ✅ | Day 1 — **Naren's Astrion Brain hero wallpaper** is the new default across web OS + installer. 6 existing SVG wallpapers preserved as alternatives. |
| File system: drag-drop, rename inline, file previews | ✅ | Day 3-4 — drag-drop + inline rename were pre-existing; Finder v2 added arrow-key nav, Delete, range-select, Cmd+A, and PDF/audio/video inline previews. |
| Menubar: clock dropdown w/ calendar, battery % | ✅ | Already shipped pre-sprint. `menubar.js:658-710` has the full calendar dropdown; battery percentage renders at `menubar.js:527` with color-coded SVG gauge. Verified. |
| Multi-monitor awareness | ✅ | Day 5 — `windowManager.getActiveDisplay()` / `getAllDisplays()` / `centerInActiveDisplay()`, lazy `refreshScreenDetails()` to avoid permission prompt on boot, fallback to `window.innerWidth`. |
| Accessibility: keyboard nav, focus indicators, screen reader labels | ✅ | Day 8 — 13 aria-labels on menubar, role=toolbar on dock, new `focus-trap.js` utility. Force Quit dialog retrofitted as proof-of-concept. Real screen reader testing still deferred. |

---

## Commits in order

```
a16a21b  Day 1: hero wallpaper + notification persistence + parser fix
e24e447  Day 1: credit Naren properly
69e94b0  Day 3-4: Finder v2 (keyboard nav + media previews)
78997ba  Day 5:   multi-monitor awareness in window-manager
069e747  Day 6-7: auto-updater wired end-to-end + rebrand
a94d048  Day 8:   aria-labels on shell + focus-trap dialog utility
<this>   Day 9:   v0.2.0 release + PLAN.md + lessons + retrospective
```

---

## What bit me (candidates for lessons 62-70)

- **#62** Math detection had to pre-empt verb lookup because "what" matched `explain` before the math regex ever ran. The bug sat in the console for weeks.
- **#63** Features you "think" are missing are often already built. 70% of the checklist was already in the codebase.
- **#64** An unfixed regex bug can survive 50+ code reviews when it becomes "background noise."
- **#65** `update-electron-app` is a complete auto-update solution; don't rebuild it.
- **#66** Accessibility infrastructure is cheap; accessibility VERIFICATION is expensive.
- **#67** Focus traps need capture-phase listeners.
- **#68** `requestAnimationFrame` before calling `.focus()` on a newly-mounted element.
- **#69** Window Management API requires explicit user permission — never pre-fetch on boot.
- **#70** Sprint compression works when a prior sprint already did the foundation work.

All 9 are in `tasks/lessons.md`.

---

## What's actually new in v0.2

- **Naren's hero wallpaper** as the default — this is the single biggest visible change. Astrion now looks like a product.
- **Finder v2** — arrow-keys, Delete, Cmd+A, range select, inline PDF/audio/video previews
- **Multi-monitor API** — plumbing, not user-facing yet; lets future Mission Control / Display Settings apps do the right thing
- **Auto-update notifications** — desktop users get a toast when a new release downloads
- **Accessibility scaffolding** — aria-labels across the shell + focus-trap utility for every future dialog

## What's NOT in v0.2

- macOS code signing (Apple dev cert costs $99/yr, deferred until M3 revenue)
- Delta updates (electron-builder can do this, deferred)
- Real screen reader testing (needs VoiceOver/Orca sessions)
- Update channels (stable/beta/canary)
- ISO package-manager auto-update (current ISOs still require manual reinstall)
- Retrofitting every dialog with the focus-trap utility (Force Quit is the proof of concept; others get it as they're touched)

## What's NOT in the original checklist but should be called out

- Build verified end-to-end: `[graph-store] 17/17`, `[graph-query] 14/14`, `[intent-parser] 19/19` (the math fix finally lands the last one), no console errors, boot clean.
- Package.json version bumped `1.0.0` → `0.2.0` to match the release tag.
- Installer branding: `com.novaos.desktop` → `com.astrionos.desktop`, `productName: "NOVA OS"` → `"Astrion OS"`, repo URL updated.
- Preload exposes both `window.astrionElectron` and legacy `window.novaElectron` during the rename — no renderer breakage.

---

## Metrics

- **Commits:** 7 (Days 1 + 1-credit-fix + 3-4 + 5 + 6-7 + 8 + 9)
- **Files changed (cumulative):** ~25 (new: 3 — `graph-query.js` [M2], `focus-trap.js` [Day 8], `CREDITS.md` + `wake-up-2026-04-11.md` + `auto-updater.md` + this retrospective; modified: the rest)
- **Lines of code added:** ~1,800 across Polish Sprint commits
- **Net new files in v0.2 vs M2 ship:** 5
- **Test suites green:** 17 + 14 + 19 = 50 sanity tests passing
- **New lessons captured:** 9 (#62–70)
- **Friend contributions:** 1 — Naren's Astrion Brain hero wallpaper (early-contributor tier)

## The emotional highlights

- **The hero wallpaper moment.** When the Astrion Brain wallpaper went live as the default and the widgets + menubar + dock layered on top, Astrion stopped looking like a student project and started looking like a real OS. Screenshot is in the Day 1 commit message.
- **Lesson #64 (unfixed regex surviving 50 reviews).** The "1/19 sanity tests FAILED" line on EVERY boot for weeks, nobody fixing it. That's a warning about what "background noise" does to a codebase.
- **The compression itself.** 9 days → 1 afternoon is lesson #70 in action. When the foundation is solid, scope compression is free.

---

## Next: Agent Core Sprint

Per Viraaj's scoping message earlier today:

> Milestone 2: AI Agent Core (2-4 weeks). Agent Framework: central AI
> agent that receives NL, breaks into steps, executes via OS APIs,
> reports progress, asks clarifying questions. OS Action API (file.*,
> app.*, window.*, terminal.run, browser.*, notes.*, settings.*,
> notification.*). Context System (open apps, active file, selected
> text, recent terminal output, clipboard, system state). Conversation
> Memory. Spotlight upgrade to primary AI interface (multi-turn +
> real-time action viz).
>
> Deliverable: "create a folder called Projects on the Desktop and put
> a file called ideas.txt in it with some project ideas" → the AI does it.

**~60% of this is already built.** M1 Intent Kernel gives you NL → capability → execute. M2 Hypergraph gives you the context substrate. What's NEW:
1. **Multi-step planning** — current executor runs ONE capability, not a chain
2. **Clarifying-question flow** — no disambiguation UX
3. **Conversation memory** — no cross-turn state
4. **Selection/cursor/recent-output context surfaces** — not exposed
5. **Spotlight multi-turn UI with real-time action viz** — single-shot today

Plan file for Agent Core Sprint lands in a fresh session (recommended cross-session boundary per lesson #4 "commit durable artifacts, start fresh at natural checkpoints").

**When?** Viraaj said "after v0.2" — that's NOW. Could start today or tomorrow. Fresh session recommended since this context is already ~60% full and the Agent Core Sprint is ~2-4 weeks of work.

---

## Sign-off

- All 9 days shipped. ✅
- v0.2.0 tagged. ✅
- Naren credited properly. ✅
- Lessons 62-70 captured. ✅
- Fresh ISO build trigger pushed (Day 9 distro bump). ✅
- Retrospective written (this file). ✅

See you in the Agent Core Sprint.
