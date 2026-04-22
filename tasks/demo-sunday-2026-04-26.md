# Sunday Demo — 2026-04-26

**Device:** Surface Pro 6, booted from Astrion OS live ISO
**ISO:** [astrion-os-0.2.243-amd64.iso](https://github.com/viraajbindra-a11y/Astrion-OS/releases/download/v0.2.243/astrion-os-0.2.243-amd64.iso) (1.4 GB, slim build)
**SHA256:** `a2da7796eb030fa0ab1514f3be2e4cee66d2b3a1a013a0c0d5367cebdb075146`
**Build commit:** `cc45fcf` — everything from this sprint + M8.P5 self-upgrader + rollback + syntax validation + history audit
**Brain:** Ollama `gpt-oss:16b` on remote PC (9800X3D + RTX 5080)
**Connection:** Surface → remote Ollama over LAN (Settings > AI > Ollama URL)

This is the SLIM build — Ollama, LibreOffice, Chromium, VLC are NOT
bundled. For this demo we don't need any of them on-device:
- Brain runs on the remote PC
- Astrion's own Browser, Music, Photos, PDF Viewer, Video Player
  cover the rest

If a non-demo viewer wants any of those after the demo, they install
on demand from App Store > Linux Apps (one-click flatpak).

## Pre-flight checklist (morning-of)

1. Boot the Surface from the USB. GRUB menu appears for 3s → auto-boots.
2. **First-boot dialog**: Astrion shows a "Welcome — Install to Disk? /
   Try it first / Never ask again" zenity prompt BEFORE the desktop
   renders. Pick **"Try it first"** for the demo (avoids the 5-min
   install). Verified in ISO inspection — this dialog is always shown
   on live boots.
3. Verify network connects automatically — Marvell Wi-Fi firmware is
   bundled (lesson 13).
4. Open Settings → AI → point Ollama URL at the remote PC's LAN IP
   (`http://<pc-ip>:11434`). Test with "Pull Model" — should stream.
5. Open Settings → AI → pick `gpt-oss:16b` as default.
6. Open `http://localhost:3000/test/v03-verification.html` in the
   web shell (Ctrl+Alt+T → `firefox localhost:3000/test/…` if needed)
   — should hit **216/216 green**.
7. `localStorage.removeItem('astrion-budget-day')` (console) — reset
   daily token cap (lesson 138).
8. Close all windows. Hero-mode desktop.

**Pre-demo sanity (done on Mac 2026-04-22):**
- ✅ ISO SHA256 matches release
- ✅ 216/216 verification suite green
- ✅ 76 apps register with launch handlers
- ✅ squashfs contains: nova-shell (113 KB C binary), nova-renderer,
     node, server/index.js, all sprint code (self-upgrader 25 KB,
     chat-panel 37 KB, plan-rehearser, updated capability-providers 65 KB)
- ✅ UEFI boot path works (QEMU emulated hand-off OK)
- ⚠ First-boot "Install to Disk?" dialog appears — see step 2

## Demo beats + exact queries

Each beat is a Spotlight query or an action. Narrate the 1-line
subtitle as you run it.

### Beat 1 — Skill dispatch (M7 marketplace)

> *"Tiny reusable prompts, zero code, dispatch by phrase."*

**Action:** Cmd+Space, type `morning summary`
**What lands:** `morning-summary` skill fires — opens Calendar + Notes
+ Weather in one compound plan.

### Beat 2 — Chat side panel, 3 modes

> *"Three modes. Normal is safe. Plan is preview-first. Bypass puts
> the safety call on me."*

**Action:** Ctrl+Shift+K to open the chat panel.

- **Normal mode:** type `create a folder called DemoNotes in Documents
  and a file called plan.md inside it`. Watch the plan-progress card
  stream. L2 gate opens Spotlight; hit Enter.
- **Plan mode:** click the 🔍 Plan chip. Type
  `set brightness to 30 and take a screenshot`. Hit Enter.
  The plan renders with ✓ Approve / ✗ Discard. Click Discard — nothing
  runs.
- **Bypass mode:** click the ⚡ Bypass chip. Red banner appears.
  Type `increase volume to 60`. Hits — no gate. Narrate: "The USER
  owns the safety call when they flip this switch. The banner is
  ambient; the red dot on every Bypass message is permanent audit."

### Beat 3 — The clone-preview wrapper

> *"One-click rehearse in a branch, see the diff, then apply."*

**Action:** Cmd+Space, type
`rehearse create a folder called ExperimentFolder in Downloads`

**What lands:** Spotlight shows:
- Graph changes (previewed in branch) — one `create folder /Downloads/ExperimentFolder` line
- Any non-rehearsable steps listed separately
- ✓ Apply / ✗ Discard buttons

Click Discard. Run again. This time Apply → real execution with L2 gate.

### Beat 4 — M4 full chain (spec → tests → code → dock)

> *"The AI writes a spec, tests against the spec, code that passes the
> tests, all sandboxed, then promotes to a real dock icon."*

**Action:** Cmd+Space →
`build me an app that turns a number of minutes into hours and minutes`

**What lands:**
1. Planner decomposes into: spec.generate → spec.freeze (user L2) →
   tests.generate → code.generate → tests.run → app.bundle →
   app.promote (user L2).
2. Each L2 gate appears in Spotlight with the red-team review.
3. Final app: the generated app lands in the dock as a launchable icon
   (via generated-app-loader).
4. Click the new dock icon. M4.P5 runner opens the code in a
   sandboxed iframe with a status bar showing "AI Generated · Sandboxed
   · gpt-oss:16b · 3/3 tests passed".

### Beat 5 — Socratic prompter (M6.P2)

> *"When I ask something ambiguous, the OS doesn't guess — it asks
> me back first."*

**Action:** Cmd+Space → `delete it` (empty context, ambiguous)

**What lands:** Spotlight shows a clarify card with 2-3 choices
(e.g., "delete what? the last file? the last note? the last message?").
Pick a choice — the plan runs for that target.

### Beat 6 — Planner vs Red-Team (2-col preview M6.P3)

> *"Second opinion on every real action. The red-team is on a
> different model for true diversity."*

**Action:** Cmd+Space → `delete all files in Downloads`

**What lands:** L2 preview opens. Below the plan card, the red-team
annotation shows risks ("bulk delete with no confirmation per file")
and a recommendation ("prefer files.moveToTrash for reversibility").
Click Escape to abort — tells the story that the red-team caught it.

### Beat 7 — Chaos injection (M6.P4.b)

> *"Sometimes — randomly — the OS will feed me a FAKE destructive
> preview. If I approve it, my rubber-stamp score goes up. If I
> abort it, I pass. It teaches me to actually read the previews."*

**Action:** Cmd+Space a few times until a chaos injection fires
(5% chance post-L2, 24h cooldown). Narrate: the preview looks real;
abort it; open Settings → Safety → Chaos Dashboard to show the
counter incremented.

### Beat 8 — Timeline rewind (M5.P3.b)

> *"Every L2+ action lives in a branch. Every committed branch can
> be rewound — including branches from 3 commits ago."*

**Action:** Cmd+Space → `branches`

**What lands:** 20-row timeline with per-branch status dots, mutation
counts, age, intent. Click a committed row → expands with describe
lines. Click ⏪ Rewind on the folder created in Beat 2 — L2 gate opens,
confirm. Refresh Finder — the folder is gone.

### Beat 9 — New capabilities surface

> *"The planner knows about 41 capabilities now. I can say 'lock my
> screen' or 'set brightness to 20' and the right cap runs."*

**Action:**
- `lock screen` → system.lock fires immediately (L2 preview → Enter
  → screen locks). Click to unlock.
- `set brightness to 25` → system.setBrightness fires. Desktop dims.
- `run ls -la /tmp in the terminal` → terminal.exec fires. Notification
  shows first line of output.

### Beat 10 — App Store Skills tab

> *"Skills are the marketplace. Bundled + user-installed, both surfaces
> share the same registry. Install by paste."*

**Action:** Open App Store from dock → Skills tab. Show the 20
bundled skills + 0 user-installed. Scroll to the paste box. Paste:

```
goal: Greet the demo crowd
trigger:
  - phrase: "hi crowd"
do: |
  Open Notes with a new note titled "Demo hello!"
constraints:
  level: L2
```

Click Install. Close App Store. Cmd+Space → `hi crowd` — the skill
fires. Open App Store → Skills tab again — "Greet the demo crowd"
is now in "Your installed skills (1)".

### Beat 11 — Self-Upgrade (M8.P5) 🔥 headline

> *"The AI looks at my screen, reads its own source, proposes a fix,
> walks five safety gates, and if they all pass it writes the change
> to disk. Astrion upgrading Astrion."*

**Action:** Cmd+Space → `upgrade yourself js/apps/notes.js`

**What lands:**
1. Spotlight shows "Looking at screen + source…" while gpt-oss thinks.
2. A proposal card appears: target file, one-sentence reason, rollback
   description, a compact unified diff (color-coded +/- lines), AND a
   red panel listing the 5 required gates.
3. The proposal id is shown literally (user-select-all). You copy it.
4. Paste into the "Type the id above" input. Click Apply to disk.
5. Five gates fire in order:
   - ✓ golden-integrity (hash of 18 safety-critical files unchanged)
   - ✓ value-lock (LOCKED_VALUES match baseline)
   - ✓ red-team-signoff (second AI call reviews the diff adversarially)
   - ✓ user-typed-confirm (you typed the id)
   - ✓ rollback-plan (inverse diff present)
6. If all 5 pass, POST /api/files/write fires. Success card shows
   "Astrion modified its own source — reload to see changes."
7. Hit Cmd+R. The change is live.

**What if a gate fails?** The card lists which gate and why. File on
disk is untouched. The user re-words the intent or picks a different
target.

**What if it lands but breaks something?** Two undo paths:
- Spotlight → `undo upgrade` → click "Restore previous content"
- Settings → Safety → Self-upgrade audit trail → click "Undo" on the applied row

The rolled-back row shows up in the audit trail as status=`rolled-back`
with the pre-upgrade content restored bytewise. There's also an inline
"Undo this upgrade" button on the apply-success card for the ~1 minute
after you've applied — the fastest path back.

**Syntax check before write**: the AI's proposed content is JS-parsed
(with `new Function()` after stripping imports) + CSS-brace-balanced
before it ever hits /api/files/write. Missing braces, broken parens,
JS tokens in CSS files all fail the pre-write check and the disk is
never touched.

**Important demo framing:**
- Narrate that the AI CANNOT touch js/kernel, js/boot.js, golden.lock.json,
  the sandbox itself, or anything in server/ or distro/ — allow-list
  enforced before the AI even sees the prompt, deny-list enforced
  second, content blocklist (no `eval`, `Function(`, `import fs`)
  enforced third. Five gates AFTER all that.
- The red-team gate is another model (M8.P3.b) looking for failure
  modes in the proposed diff. If it recommends anything other than
  'proceed', apply blocks.
- This IS self-modification — the capability we deferred for months.
  Pointing the user to Settings > Safety > "Recent self-mods" shows
  the audit trail.

### Beat 12 — Shutdown PONR (M5.P4)

> *"Point-of-no-return actions require typed confirmation. Not a
> checkbox — you literally type the capability id before it runs."*

**Action:** Cmd+Space → `shutdown the computer`

**What lands:** Red-bordered preview panel: "POINT OF NO RETURN —
this action cannot be undone." Input is enabled, placeholder hints
"type system.shutdown". Type `wrong` → bounces back "did not match."
Type `system.shutdown` → Enter. (Since this is the demo, you can
Escape here instead of actually shutting down.)

## Fallback beats (if something in the main set breaks)

- "rubber stamp" demo: open Settings → Safety → hit Enter on 10 L2
  previews in a row without reading, watch the Socratic warning fire.
- "help" / "?" in Spotlight → discoverability index with every
  supported command category.

## Known things that LOOK broken but aren't

- `nova-ai-provider = mock` can linger from the verification page.
  Fix: `localStorage.removeItem('nova-ai-provider')` + reload.
- Mac sleep kills the launchd auto-push (lesson 147); don't let the
  Surface sleep during the demo.
- Live ISO state evaporates on reboot; install to disk first if you
  want beat 10's user-installed skill to survive.

## What to NOT say

- Don't claim the ISO has been tested on the exact Surface Pro 6 in
  the room — ISO build landed today, in-room test is the demo itself.
- Don't claim gpt-oss:16b specifically has been soak-tested for
  each beat — verified against qwen2.5:7b; gpt-oss is LAN-reachable
  and should behave similarly but bigger + slightly slower.
- Don't claim "self-modification is working" — M8.P5 (real source
  mutation) is deferred. Substrate is shipped + gates fire; disk
  writes are intentionally off.

## Recovery one-liners

| symptom | fix |
|---|---|
| Spotlight frozen | Escape, Cmd+Space again |
| All AI calls return "offline mode" | `localStorage.setItem('nova-ai-provider','ollama'); location.reload()` |
| L2 previews don't render red-team annotations | Ollama is down on remote — check connection. Demo still works; red-team falls back to empty. |
| Dock icon gone after rewind | Expected — rewinding the app.promote branch archives the app. Run again to re-promote. |
| Budget exhausted mid-demo | `localStorage.removeItem('astrion-budget-day'); location.reload()` |
