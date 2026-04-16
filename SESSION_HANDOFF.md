# Session Handoff: ISO Parity + 80 Apps + Website

**Date:** 2026-04-16
**Branch:** main (all pushed)
**Commits this session:** 14
**Starting point:** 66 apps, commit `22b05e0`
**Ending point:** 80 apps, commit `d3fdf87`

---

## What Was Done This Session

### 1. Browser Multi-Tab Support (commit `e95a1c0`)
- Tab bar with closeable tabs, + button for new tabs, max 8 tabs
- Each tab has its own iframe, URL, history stack, title, favicon
- Keyboard shortcuts: Ctrl+T (new), Ctrl+W (close), Ctrl+Tab (next), Ctrl+1-9 (direct)

### 2. 14 New Apps (66 → 80)
Sudoku, Speed Test, Recipe Book, Emoji Kitchen, Wordle, Meditation, Soundboard, Countdown, Reaction Test, Color Palette, Rock Paper Scissors, Tic Tac Toe, Random Facts, BMI Calculator

### 3. 10 New Smart Answers
Age calculator, Roman numerals, binary conversion, reverse text, ROT13, tip calculator, morse code, emoji meanings, day of week, motivational quotes

### 4. ISO Overhaul
- Replaced WebKitGTK browser with Chromium
- Fixed close button visibility + window_count leak
- All 80 apps in native C registry
- Web Spotlight popup with smart answers
- Corner snap quadrants, grid tile, cascade
- Functional File/Edit/View/Window/Help menus
- Desktop icons from ~/Desktop
- Dock + launchpad scrollable
- Google/social media blocked from proxy (crash fix)
- WiFi: added network-manager package + service start
- App scroll fixed in native windows
- Spotlight click callback signature fix
- alert()/prompt() replaced with inline dialog (7 apps)
- app-categories.js updated for 80 apps

### 5. Astrion OS Website
- Separate repo: viraajbindra-a11y/astrion-os-website
- Live: https://viraajbindra-a11y.github.io/astrion-os-website/
- CSS desktop mockup hero, 9 features, 35 app chips, 3 download options

---

## App Count: 80

## What's Left / Next Session
- Timer leak fixes (8+ apps missing MutationObserver cleanup)
- YouTube/Music/TextEditor still use native prompt() for API key input
- confirm() calls still native (finder delete)
- Function() eval security fix in ai-service.js
- Real desktop screenshot for website
- Phase 1 soak test with real AI key

## Architecture Notes
- Apps: processManager.register() in js/apps/*.js
- Boot: import + register in THREE blocks (spotlight popup, native, normal)
- Native shell: distro/nova-renderer/nova-shell.c app_registry[]
- Dialog: import('../lib/dialog.js').then(d => d.showPrompt(...))
- Proxy: /api/proxy?url=... strips headers, rewrites URLs
- Smart answers: getSmartAnswer() from js/lib/smart-answers.js
- Website: separate repo viraajbindra-a11y/astrion-os-website
