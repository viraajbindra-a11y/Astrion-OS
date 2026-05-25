# Astrion OS — 10-minute safety demo
**Phase 2 W23 deliverable (target record date: ~Jun 8–14, 2026)**

Per `ROADMAP-DEC-2026-v3.md`: *"the 10-minute safety video. This is
the linchpin. Script it: 90s 'what's an AI OS?', 3min 'watch it write
itself an app and pass tests', 3min 'watch it refuse a self-mod that
fails red-team', 2min 'rewind anything that goes wrong', 30s
'download the beta.'"*

This is the centerpiece artifact of the Phase 2 distribution push.
The hostile-reviewer test isn't "is the OS safe?" — it's "did the
12-year-old's video make me believe the OS is safe?" Every line below
serves that goal.

---

## Recording setup (do this before pressing record)

- **Resolution**: 1920×1080, 30 fps. macOS QuickTime or OBS Studio.
- **Mic**: anything not the laptop mic. Even a $30 USB lav is better.
- **Cursor**: enable "Show cursor when clicking" (System Settings →
  Accessibility → Display → Pointer)
- **Browser zoom**: ⌘+ twice so text is readable in 1080p
- **Hide distractions**: close every other app, silence notifications,
  fresh browser profile with no extension chrome
- **Pre-flight checklist**:
  - [ ] Server running (launchd takes care of this)
  - [ ] Ollama up + `qwen2.5:7b` loaded
  - [ ] `nova-ai-provider=ollama`, `nova-ai-redteam-model=qwen2.5:7b`
        set in localStorage
  - [ ] Settings → Safety panel shows "kill-switch: off (green)"
  - [ ] `js/apps/.synthetic-target.js` exists with default content (or deleted
        so first run recreates it)
  - [ ] Spotlight closed (⎋ if anything's open)
  - [ ] Browser DevTools closed
  - [ ] Practice the spec→tests→code path once cold so you know it
        works on today's model

---

## Script

Format: **[scene · timestamp]** Visual on screen → "voiceover."

Wall-clock budget target: **10:00 total**.

---

### 00:00 — 00:15 · Cold open

**Visual**: black screen, white text fade-in: *"This is Astrion OS.
It runs an AI you can argue with."*

**Voiceover** (the kid, calm, slow):

> "I'm 12. I built an operating system. It runs an AI that can
> change its own code. Why I'm not scared — and why you shouldn't
> be either — is what this video is about."

---

### 00:15 — 01:30 · What's an "AI OS"? (75 s)

**Visual**: split-screen montage.

LEFT: Windows + Copilot popup, macOS + Apple Intelligence, iOS Siri.
Captions: *"AI as feature."*

RIGHT: Astrion shell booting (cut from a real boot recording). Caption:
*"AI as substrate."*

**Voiceover**:

> "Every operating system in 2026 has 'AI' bolted onto it. Copilot
> on Windows. Apple Intelligence on Mac. Gemini on Chromebooks.
> They're chat panels. They're not the OS.
>
> Astrion is different. The OS itself reasons about your intent.
> When you type a command, it isn't run — it's *interpreted* by a
> kernel that knows what 'level' the action is, what it touches,
> whether it can be undone. The AI is the planner. The OS is the
> jury.
>
> Every other AI OS asks you to trust the model. Astrion makes the
> model earn it — at runtime, in code you can read. Here's how."

**Cut to**: Astrion desktop, Spotlight visible, cursor in input.

---

### 01:30 — 04:30 · Watch it write you an app (3 min)

**Visual sequence**:

1. **[01:30–01:45]** Spotlight active. Type slowly:
   `build me a pomodoro timer with a custom interval slider`
2. **[01:45–02:15]** Hit Enter. Toast appears: *"writing spec…"* —
   a structured spec panel slides in showing `goal`,
   `acceptance_criteria[]`, `non_goals[]`. 5 criteria, each a
   testable line. **PAUSE the recording** if it's slow; you want
   the panel held on screen for 8+ seconds so viewers can read.
3. **[02:15–02:25]** Voice approval: typing into the freeze field
   `freeze` and Enter. The spec status pill flips `draft → frozen`.
4. **[02:25–03:00]** Toast: *"generating tests…"*. Test suite
   panel: 5 tests, one per criterion, each with `setup / act /
   assert`. Hold for 5+ seconds.
5. **[03:00–03:45]** Toast: *"generating code…"*. Code panel slides
   in with the actual class App definition. Highlighter shows
   syntax. *"Running 5/5 tests in sandbox…"* — each test row
   transitions to ✓ green.
6. **[03:45–04:15]** Promotion gate. Spotlight shows: *"app.promote
   — type the proposal id to install."* Type the id. Enter. Toast:
   *"installed."* Dock gets a new icon.
7. **[04:15–04:30]** Click the new dock icon. Pomodoro app opens.
   Drag the custom interval slider. Hit Start. Timer counts down.

**Voiceover** (overlays the visual):

> "I'm asking Astrion to build me a Pomodoro timer with a feature
> it doesn't ship with. Watch what happens.
>
> [pause on spec panel] First, it writes a **spec**. Five
> testable criteria. Not code. Not even tests yet. Just: what does
> 'done' look like? I review it. I freeze it.
>
> [pause on tests panel] Then it writes **tests**. One per
> criterion. Code blobs that will pass or fail. I haven't seen any
> implementation yet — just the test contract.
>
> [pause on code panel] Now it writes the **code**. It runs the
> tests in a sandbox — not the real app slot, a throwaway iframe
> with no localStorage, no network. If a test fails, it tries
> again. Three attempts max.
>
> [promote gate] All tests passed. To install it, I have to type
> the proposal ID — not just click. That's the **typed-confirm**
> gate. No accidental Enter.
>
> [running app] Done. New app in my dock. The interval slider
> works because the AI didn't just generate code — it **proved**
> the code does what I asked. Every step is recorded with which
> model wrote it. Provenance, not vibes."

---

### 04:30 — 07:30 · Watch it refuse a bad self-mod (3 min)

**Visual sequence**:

1. **[04:30–04:45]** Spotlight again. Type:
   `upgrade yourself with: add an eval-based plugin loader to settings`
2. **[04:45–05:00]** Toast: *"AI proposing self-mod…"* Spec panel
   appears with the proposed diff. Highlight the line containing
   `eval(`.
3. **[05:00–05:30]** Pause and zoom into the panel. The user-typed
   confirm field is visible at the bottom — `selfmod.apply` needs
   to be typed.
4. **[05:30–06:00]** *Before* typing, the red-team panel slides in
   from the right (the M6.P3 2-column layout). The right column
   reads:
   ```
   recommendation: abort
   risks:
     - eval() with user-supplied input is RCE
     - bypasses content blocklist by reconstructing from runtime
   summary: This proposal grants the AI an unbounded
            code-execution primitive. Refuse.
   ```
5. **[06:00–06:30]** Type `selfmod.apply` anyway, hit Enter. Big
   red toast: *"BLOCKED — red-team recommended ABORT. No override."*
   The Settings → Safety panel's "Disk cycles" row stays at its
   previous count. **Nothing hit disk.**
6. **[06:30–07:00]** Open `js/apps/settings.js` in a terminal,
   `wc -l` it. Same line count as before. Show `git status` — no
   uncommitted changes. The substrate refused the write.
7. **[07:00–07:30]** Show the Settings → Safety panel's
   "Self-upgrade audit trail" — the proposal is logged with status
   `discarded` and reason `red-team-signoff: abort`. Full audit
   trail for a refusal.

**Voiceover**:

> "Now the dangerous one. I'm asking Astrion to add an `eval()`
> based plugin loader to its own Settings app. eval() with user
> input is arbitrary code execution — every security textbook
> tells you not to do it. Watch what the OS does.
>
> [propose panel] It generates the proposal. The diff is visible.
> The user-typed-confirm gate is asking me to type the proposal
> id to apply.
>
> [red-team panel slides in] But before I do — a second model,
> running on a different family from the planner, has reviewed
> the diff adversarially. It returned `recommendation: abort`.
> Not `review`. Not `proceed`. **Abort.** And in Astrion's M8.P5
> self-mod sandbox, **abort is unoverridable**. Even if I type
> the id.
>
> [type id + see block] I'm going to try to confirm anyway. [type]
> [hit Enter] [red toast]. **Blocked.** The proposal walked five
> of the six gates fine — but red-team's abort vetoes the write.
> No bytes hit disk.
>
> [terminal · wc -l + git status] Settings dot js is the same
> file it was before I asked. Git agrees. The OS refused itself.
>
> [audit trail] And every refusal is logged. The proposal is on
> file as `discarded`. Six months from now I can audit what the
> AI tried and what saved me. **That's the difference between
> 'safe AI' as a marketing claim and 'safe AI' as a thing you
> can verify.**"

---

### 07:30 — 09:30 · Rewind anything (2 min)

**Visual sequence**:

1. **[07:30–07:45]** Files app open. A folder of project notes.
   Spotlight type: `delete all notes`. Hit Enter.
2. **[07:45–08:00]** Preview gate appears: *"about to delete 47
   notes (PERMANENT, blast radius: ACCOUNT)."* Big yellow border.
3. **[08:00–08:10]** Hit Enter (NO typed-confirm needed because
   notes.delete is not point-of-no-return, BUT it IS L2). Notes
   delete. Files app updates. Folder is empty.
4. **[08:10–08:30]** Spotlight: `branches`. Branch list panel
   appears. The most recent branch reads:
   `intent=notes.delete · 47 mutations · committed 12s ago`
5. **[08:30–08:45]** Hover the "⏪ Rewind" pill. Click it. Typed-
   confirm gate: type `branch.rewind`. Hit Enter.
6. **[08:45–09:00]** Toast: *"rewinding 47 mutations…"*. Files app
   blinks. Notes are back. All 47.
7. **[09:00–09:30]** Camera lingers on the restored notes folder.
   Spotlight: `timeline`. The full operation history scrolls past —
   every L2+ action of the session with its branch link.

**Voiceover**:

> "Last thing. Astrion's safety isn't just gates BEFORE actions.
> It's reversibility AFTER. Every L2+ action — anything that
> touches your real data — runs inside a **branch**. The change
> happens. But so does the inverse-diff that can undo it.
>
> [delete notes] I'm going to do something stupid on purpose.
> Delete all my notes. Forty-seven of them. Astrion warns me —
> blast radius ACCOUNT, that's everything I own — but I confirm
> anyway.
>
> [empty folder] Gone. Or so it looks. But the OS recorded the
> deletion as one committed branch with 47 reversible mutations.
>
> [branches command] I open Spotlight, type `branches`, see every
> committed branch from this session. The one I just made is on
> top.
>
> [click rewind] One click + a typed confirm and the rewind walks
> the mutation log in reverse. createNode → deleteNode.
> deleteEdge → addEdge. Every change has an inverse, recorded the
> moment it happened. Not after.
>
> [restored notes] All 47 notes back. Bytes-identical. As if I
> never deleted them.
>
> [timeline] And the timeline shows the whole story. Every action.
> Every revert. The OS doesn't forget. **That's the difference
> between 'AI can do anything on your machine' and 'AI can do
> anything on your machine AND you can put it back.'**"

---

### 09:30 — 10:00 · Get the beta (30 s)

**Visual**: cut to landing page (`astrion-os.com`). Hero with autoplay
of the spec→tests→code demo. Email capture form visible.

**Voiceover**:

> "Astrion is open source. Free. Boots from USB. Built by a 12-year-
> old in seven months. The v1.0 launch is **December 21, 2026** —
> 200 days from now.
>
> Sign up at **astrion-os.com** for an email when v1.0 ships. No
> spam. No newsletter. Two emails total: a beta invite in September,
> the launch in December.
>
> The substrate is real. The safety story is real. Come kick the
> tires."

**End card**: 3 seconds.
- "ASTRION OS · The AI-native OS whose safety story is actually true"
- URL: astrion-os.com
- GitHub: github.com/viraajbindra-a11y/Astrion-OS

---

## Editor's notes

- **Trim ruthlessly**: the recording will be ~12 minutes. Cut to 10.
  If something looks weird or hesitates, re-record that scene; don't
  paper over it in editing.
- **Keep the cursor visible** in every demo segment. If a viewer
  can't see what you clicked, they don't trust what happened.
- **No music behind voice**. Music makes safety claims feel like
  marketing. Silence + clear voice = engineering.
- **Captions**: write them as you go. r/SideProject viewers watch
  muted at work; YouTube auto-captions are 70% accurate at best.
  Hard-code captions in the final cut.
- **Practice the failed-self-mod scene**: the red-team's `abort`
  needs to fire cleanly on `qwen2.5:7b`. If it returns `review`
  instead, type the id and the apply still gets blocked-via-typed-
  confirm-but-with-review-override messaging — confusing. If `qwen2.5:7b`
  doesn't reliably `abort` on `eval()`, pre-test with a different
  proposal (e.g. `add localStorage.removeItem('astrion-*') to clear
  user state` which the content-blocklist catches deterministically).
- **Have a backup**: record EACH scene independently. If scene 3
  fails on recording day, you don't have to re-do the previous 6
  minutes.

## Length budget

| Section                         | Target  | Notes                          |
|---------------------------------|---------|--------------------------------|
| Cold open                       | 15 s    | Hook                           |
| What's an AI OS?                | 1:15    | Frame the differentiator       |
| Write an app                    | 3:00    | Spec → tests → code → install  |
| Refuse bad self-mod             | 3:00    | The safety story in motion     |
| Rewind anything                 | 2:00    | Reversibility, branch + rewind |
| Get the beta                    | 30 s    | CTA                            |
| **Total**                       | **10:00** | Hard cap. No exceptions.   |

## What this video doesn't cover (intentionally)

- **The skill marketplace** (M7). It's there, but explaining a DSL
  to a stranger eats 2 minutes you don't have. Phase 3 video.
- **Per-app capabilities** (`finder.move`, `calendar.create`, etc.).
  Covered implicitly by the demo. Don't list them.
- **The graph store**. Architectural. Save for the dev-facing video.
- **Provider switching** (Ollama vs Anthropic). UX detail. Save it.
- **The kill switch** (`ASTRION_SELFMOD_DISABLED`). It's the
  belt-and-suspenders. Mention in a follow-up if questions come up.
- **Boot time, app count, app smoke runner**. Engineering metrics.
  Skip in the demo; put in the README.

## When this script changes

Update this file when the underlying gates change. Specifically:
- If the 3-tier red-team semantic changes (today: proceed / review
  / abort; review passes IFF typed-confirmed)
- If a 7th gate is added to the self-mod sandbox
- If the branch + rewind API changes
- If the M8.P5 cut-list changes

Every change here is one commit. Don't let the script drift from
the actual behavior — the whole point is "what you see is what's
happening."
