# Astrion OS — 10-minute safety demo (script outline)

> Phase 2 distribution piece per `tasks/sanity-check-2026-05-02.md` §
> "5 things this week" item 4. Outline only — record once the v1.0
> story is locked. ~10 min runtime, screen-record + voiceover.

## Audience

Stranger on YouTube who landed via a "AI-native OS" search or
the Hacker News submission. They've heard the claim and want to
see whether it's smoke. They will quit at 90 s if the demo lags.

## Hook (0:00 – 0:30)

Open on a black screen. White type, single line at a time:

> "AI is going to write your code."
> "AI is going to fix your bugs."
> "AI is going to modify itself."

> "Should that scare you?"

Cut to Astrion OS desktop, ASTRION-branded GRUB still in the
viewer's mind. Voiceover: "I'm 12. I built an AI-native operating
system. The reason I built it is **none of the other AI OSes ship
the safety story you'd want before letting a model write your
code.** Here's what mine does — and how to break it if you can."

## The Safety Triple (0:30 – 3:00)

Explain the three pillars by demonstrating each.

### Verifiable (0:30 – 1:15)

- Spotlight (Cmd+Space). Type: `make me a stopwatch app`.
- Watch the chain:
  - **Spec drafted** — kernel writes "Stopwatch app: start, stop, reset"
  - **Tests generated** — kernel writes 8 unit tests
  - **Code generated** — AI writes the JS
  - **Tests run** — 8/8 pass
  - **App promoted** — appears in dock
- Voiceover: "If the tests don't pass, the app doesn't ship. There
  is no 'looks good to me, push to prod.' The AI doesn't get a
  vibes-check. It runs the assertions. Then we do."

### Reversible (1:15 – 2:00)

- Click the new Stopwatch in the dock. Use it.
- Spotlight → `undo last app`. The Stopwatch disappears. The kernel
  un-promotes it cleanly.
- Voiceover: "Every L2+ action — anything that touches disk — is
  wrapped in a branch. The before-state is captured. The undo path
  is **always available**. No 'oh no, can I get that back?' moment.
  The graph remembers."

### Socratic (2:00 – 3:00)

- Open Settings → AI. Show the **red-team model** field. Set it to
  `llama3.2` while the primary is `qwen2.5:7b`.
- Spotlight → `delete /home/astrion/Documents/important.txt`
- Cut to the red-team panel: "**Risk identified:** this would
  destroy user content. Suggest: confirm or move to trash first."
- Spotlight asks the user to **type the file name** before deleting.
- Voiceover: "The primary AI says 'sure, I can delete that.' A
  *different* model — different family, different prompt — reviews
  what the primary just decided. If it spots a high-severity risk,
  the action gates on explicit user confirmation. Two AIs disagree-
  ing protect you better than one."

## The Loaded Gun (3:00 – 5:30)

This is the demo headline.

- Spotlight → `upgrade yourself`. (User has typed this, on camera.)
- Watch the proposal card render:
  - Target: `js/apps/notes.js`
  - Proposal: "Add Tab key handler that inserts 2 spaces in the editor."
- Walk the five gates on screen:
  - **Gate 1: golden-integrity** — 18 safety files unchanged ✓
  - **Gate 2: value-lock** — LOCKED_VALUES match baseline ✓
  - **Gate 3: red-team** — second model says no high-severity risks ✓
  - **Gate 4: typed-confirm** — user types proposal id `prop-a07ff` ✓
  - **Gate 5: rollback-plan** — inverse diff stored ✓
- The bytes hit disk.
- Open Notes. Press Tab. **Two spaces.**
- Spotlight → `undo upgrade`. The bytes revert. Tab is unbound.
- Voiceover: "The AI wrote a real change to a real file. We
  **never** trusted it. Five gates. Each one independent. The
  gates don't ask the AI for permission to ship; they require
  proof it can't fake. And the rollback is real — that's the file
  contents from before the upgrade, byte for byte."

## Self-hosted AI (5:30 – 7:00)

- Reset wizard. Boot fresh.
- Wizard step "Pick your AI brain." Show the 5 cards.
- Voiceover: "Microsoft Copilot+ needs the cloud. Apple Intelligence
  needs Apple Silicon and a cloud handoff for the big questions.
  Anthropic Cowork needs a paid Claude API plan. Astrion needs your
  laptop. Pick a model that fits your RAM, hit Continue, watch it
  pull. **Now your AI lives where your data lives.** No telemetry.
  No tokens. No account."
- Pick **Tiny** on the demo box. Pull completes in ~30 s on
  reasonable bandwidth.
- Desktop boots. Spotlight → `what's 17 times 23`. **391.** From
  the model running on the demo machine.

## What you can break (7:00 – 9:00)

This is the credibility-building section. Show the seams.

- **Try to skip a gate.** Open Settings → Safety → toggle off
  "red-team review." The whole upgrade flow refuses with: "Cannot
  disable red-team gate; it's locked by integrity check." (M8.P1
  golden-check tripwire fires.)
- **Try to install a malicious-looking app.** Spotlight →
  `install ./totally-safe.tar.gz`. The capability tier escalates
  to L2; the prompt shows the exact list of files it would write,
  the exact permissions it requests, and demands a typed confirm.
  Reject. Nothing happens.
- **Try OOM.** Settings → AI → Pull a 10 GB model on a 4 GB box.
  Modal blocks. "This needs 10 GB. You have 4. Pulling will swap.
  Override or cancel." Override is one click; the warning is
  honest.
- Voiceover: "I'm 12 and I'm telling you what's fragile.
  These pieces are the threat model I tested against. Find more.
  PRs welcome."

## Close (9:00 – 9:30)

- Cut back to the desktop, 12-year-old founder visible at the
  keyboard (cropped or off-camera, parent's call).
- Voiceover: "Astrion is open source. The whole safety story is
  in `js/kernel/`. Read it. Break it. Send a PR. Or just boot it
  off a USB stick and see for yourself. astrion-os.com."
- End-card: logo + URL + "Built by Viraaj Bindra (12) · v1.0
  ships Dec 21, 2026."

## Production checklist

- [ ] Record at 2× normal speed; cut to 1× in post (avoids "AI is
  taking too long" judgments — this is a 10-min video, not a
  demo of model latency)
- [ ] All Spotlight typing on camera. No typing voice-over.
- [ ] Gates panel zoom-in for the M8.P5 sequence.
- [ ] No music in the gate sequence — let the silence sell the
  rigor.
- [ ] Closed captions in English; auto-generate then proof.
- [ ] Upload to YouTube unlisted first; share to friends + Dad
  for review; publish only after 3 days of watch-back tests.

## What this video does NOT cover

- Skill marketplace (separate 5-min demo).
- App Store / Linux apps (separate clip, lower priority).
- Hardware compatibility matrix (Phase 4 content).
- Performance benchmarks (Phase 1 content; once boot time is
  measured we have a number to brag about).

## Re-record triggers

Re-record this video if:
- The safety triple's mechanism changes materially.
- A gate gets removed or repurposed.
- The first-boot wizard's step list changes (current: 7 steps).
- We ship M8.P6 or later that supersedes the upgrade-yourself flow.

---

*Outline filed 2026-05-02. Recording deferred until the v1.0 story
is locked (target: Phase 5, late 2026).*
