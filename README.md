# Astrion OS

> **An operating system that won't change itself behind your back.**
> Open source. Free. Boots from USB. Built solo by a 12-year-old.

Most "AI" software shipped today asks you to trust a black box. Astrion
takes a different bet: every AI action is **labeled**, **reversible**,
and **adversarially reviewed** before it touches your machine. The AI
runs on your hardware. There's no cloud, no key, no account.

→ **Try it now (no install):** <https://astrion-os.com>
→ **Boot it from USB (~10 min):** [docs/install.md](docs/install.md)
→ **Latest ISO:** [Releases](https://github.com/viraajbindra-a11y/Astrion-OS/releases/latest)

## What makes it different

The safety substrate isn't marketing — it's actual code that runs on
every action. Every line below is a real module the v0.3 verification
suite tests against:

| File | What it does |
|---|---|
| [`capability-api.js`](js/kernel/capability-api.js) | Every action declares its **level** (observe/sandbox/real/self-mod), **reversibility** (free/bounded/permanent), and **blast radius** (none/file/directory/account/external). The planner reads this *before* executing. |
| [`operation-interceptor.js`](js/kernel/operation-interceptor.js) | L2+ actions hit a typed-confirm gate. The user sees what's about to change before it changes. |
| [`red-team.js`](js/kernel/red-team.js) | A second model reviews every L2+ preview adversarially. If it spots a problem you didn't, it blocks. |
| [`rubber-stamp-tracker.js`](js/kernel/rubber-stamp-tracker.js) | Watches your confirm rate. Cross 80% rapid-confirm over 20+ samples and a Socratic warning fires. |
| [`branch-manager.js`](js/kernel/branch-manager.js) | Every change goes into a branch. One Spotlight command rewinds it. |
| [`plan-rehearser.js`](js/kernel/plan-rehearser.js) | Multi-step plans run on a sandbox graph first. You see the diff before the real write happens. |
| [`drift-detector.js`](js/kernel/drift-detector.js) | Tracks behavior drift across runs and flags when the AI's outputs are wandering. |
| [`value-lock.js`](js/kernel/value-lock.js) | Predicate-based runtime invariants the AI cannot relax. |
| [`golden-check.js`](js/kernel/golden-check.js) | 19 safety-critical files SHA-256 hashed at boot. Any drift logs `TAMPERED`. |
| [`api-surface.lock.js`](js/kernel/api-surface.lock.js) | The 41 capability IDs, 47 browser IPC channels, and 11 skill-registry exports are locked. New entries require updating the manifest, which fails v03 if you forget. |
| [`self-upgrader.js`](js/kernel/self-upgrader.js) + [`selfmod-sandbox.js`](js/kernel/selfmod-sandbox.js) | Self-modification gated by golden-integrity + value-lock + red-team + typed-confirm + rollback-plan. All five must pass. The pre-upgrade bytes are restored bytewise on undo. |
| [`chaos-injector.js`](js/kernel/chaos-injector.js) | Synthetic L2+ previews fire occasionally to keep the user's confirm muscle alive. |

The point isn't "we have lots of files." The point is: **every L2+ action
runs through this stack**. There is no path that bypasses it.

→ **Full walkthrough with citations:** [docs/SAFETY.md](docs/SAFETY.md) —
traces a real `terminal.exec` from intent parse through every gate,
explains self-modification's 5-gate flow, and includes an honest
"what this doesn't protect against" threat model.

## What's there

- **Self-hosted AI on first boot.** Wizard reads your free RAM, picks a
  model size (Tiny / Standard / Big / Remote / Skip), pulls it via the
  bundled Ollama runtime. Cloud is optional.
- **60 real apps + 16 toys.** Toys live in their own folder so real apps
  surface first.
- **Astrion Browser** — Electron-based, Chromium engine, custom chrome.
  Tabs (pin/mute/duplicate), AI sidebar, reader mode, command palette,
  reading list, ad/tracker blocker, sleeping tabs, themes,
  per-site zoom, vertical tabs, picture-in-picture. ~5500 lines.
  See [`distro/astrion-browser/`](distro/astrion-browser/).
- **Native desktop shell** in C/GTK3 — menubar, dock, alt+tab,
  desktop right-click, window snapping, screensaver, HiDPI auto-detect.
- **Spotlight** (Cmd+Space) — every keystroke runs through the intent
  parser. High-confidence intents become "Press Enter to run."
- **Skill registry** — 20 bundled skills + user-installable. Phrase
  triggers index to a case-insensitive lookup, so Spotlight can
  dispatch a skill in O(1).
- **Graph store** — notes, todos, reminders all share one graph.
  Spotlight searches across types in a single query.
- **Vault** — AES-GCM encrypted password manager, PBKDF2 login
  (250k iterations).
- **App Store** — Flatpak (real Linux apps), Android via Waydroid,
  AI skills marketplace.

## Apps

60 real apps (3 primitives + 57 templates) plus 16 toys.

| Group | Apps |
|---|---|
| **Primitives** (always shipped) | Terminal, Text Editor, Browser |
| **Productivity** | Notes, Reminders, Todo, Kanban, Pomodoro, Sticky Notes, Calendar, Journal, Habit Tracker, Flashcards, Markdown |
| **Comms** | Messages (AI chat), Contacts, Live Chat |
| **Media** | Music, Photos, Video Player, Video Editor, Draw, Whiteboard, Pixel Art, Animate, Beat Studio, Screen Recorder, Voice Memos, AI Art, AI Writer, YouTube |
| **Utilities** | Calculator, Clock, Stopwatch, Timer, Countdown, Weather, Maps, Translator, Unit Converter, Color Picker, Color Palette, Dictionary, QR Code, Password Generator, BMI Calculator, Speed Test, Recipe Book, Typing Test, Meditation, Budget |
| **System** | Finder, Settings, Activity Monitor, System Info, Vault, Trash, Installer, Appstore, PDF Viewer |
| **Toys** (separate folder) | 2048, Chess, Snake, Tetris, Minesweeper, Sudoku, Wordle, Tic-Tac-Toe, Rock-Paper-Scissors, Matrix Rain, Neon Void, Emoji Kitchen, Soundboard, Reaction Test, Random Facts, Quotes |

## Status — verified vs not

This part is honest because the strategic review on 2026-05-09 caught
us shipping faster than we were verifying. Numbers below are
machine-checkable — see `tasks/SESSION_HANDOFF.md` for the trail.

**Verified ✓**
- v0.3 verification suite: 227/227 tests pass (math parser, executor,
  budget, planner, intent parser, capability registry, plan rehearser,
  skill scheduler, predicate parser, API surface lock).
- Golden lock integrity: 19 files SHA-256 matched at boot.
- API surface drift: 41 capabilities + 47 browser IPC channels +
  11 skill-registry exports — locked + auto-checked every v03 run.
- Web build (web preview at astrion-os.com): boots, all apps register,
  Spotlight + Launchpad + Setup Wizard exercised.

**Not verified**
- Astrion Browser on real hardware. ~5500 lines, never run on Linux
  outside the dev preview. Pre-flash audit on 2026-05-09 caught two
  silent IPC bugs; a second pass is warranted.
- Surface Pro 6 end-to-end with the latest ISO. The hardware target is
  one device deep.
- Most apps haven't been individually exercised on the ISO yet —
  registration is verified, app-by-app behavior is not.

When something flips from "not verified" to "verified ✓" the README
should change with the same commit.

## Try it

### Web preview
<https://astrion-os.com> — runs in any browser, no install, no key.

### Bootable ISO (real OS)
[docs/install.md](docs/install.md) walks through boot-menu keys per
laptop maker, USB write commands per host OS, and the wizard
checklist. Tested on Surface Pro 6 + UTM/QEMU VMs only.
[Latest ISO](https://github.com/viraajbindra-a11y/Astrion-OS/releases/latest).

### Local dev
```bash
git clone https://github.com/viraajbindra-a11y/Astrion-OS.git
cd Astrion-OS
npm install
npm start
# Open http://localhost:3000
```

## Architecture

```
┌─────────────────────────────────────────┐
│         nova-shell (C/GTK3)             │
│  ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ Menubar  │ │   Dock   │ │Desktop │  │
│  │ (native) │ │ (native) │ │(native)│  │
│  └──────────┘ └──────────┘ └────────┘  │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  App 1  │ │  App 2  │ │ Browser │  │
│  │(WebKit) │ │(WebKit) │ │(Electron)│ │
│  └─────────┘ └─────────┘ └─────────┘  │
│        ↕           ↕            ↕      │
│   ┌────────────────────────────────┐   │
│   │ Express server (:3000)         │   │
│   │ + WebSocket terminal           │   │
│   │ + AI proxy (Ollama / Anthropic)│   │
│   └────────────────────────────────┘   │
│                  ↕                      │
│   ┌────────────────────────────────┐   │
│   │ Capability API (typed)         │   │
│   │ Operation Interceptor          │   │
│   │ Red-team review                │   │
│   │ Rubber-stamp tracker           │   │
│   │ Branch manager (rewind)        │   │
│   │ Plan rehearser                 │   │
│   │ Drift detector / Value lock    │   │
│   │ Golden check / API lock        │   │
│   └────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Tech stack
- **Shell**: C, GTK3, Cairo
- **OS-side apps**: Vanilla JS, CSS, HTML, WebKitGTK renderer
- **Browser**: Electron + Chromium (~5500 lines, custom chrome)
- **Server**: Node.js + Express + WebSocket
- **AI**: Ollama (local), Anthropic (optional cloud)
- **OS base**: Debian Bookworm (for the ISO)
- **Build**: debootstrap + xorriso + GRUB

## License
MIT

## Credits
Built solo by a 12-year-old. Pair-programmed with Claude.
