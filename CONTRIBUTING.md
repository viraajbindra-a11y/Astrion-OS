# Contributing to Astrion OS

## The Team

| Role | Person | Focus |
|---|---|---|
| **CEO / Lead Developer** | Viraaj | Architecture, code, features, AI integration |
| **Chief Marketing Officer** | Naren | Brand, social media, outreach, pitch deck |
| **Tester / QA** | Koa | Bug reports, app testing, UX feedback |
| **Designer** | Lauren | Icons, UI design, wallpapers, logo |

---

## Naren — Chief Marketing Officer

### Your job: make people know about Astrion OS

**Week 1 tasks:**

1. **Create social media accounts**
   - Twitter/X: @AstrionOS
   - Instagram: @astrion.os
   - TikTok: @astrionos
   - YouTube channel: Astrion OS

2. **Write the pitch** (use this as a starting point):
   > "Astrion OS is an AI-native operating system built by teenagers.
   > 76 apps, native C desktop shell, runs on real hardware.
   > Built from scratch in 2 weeks."

3. **Create content:**
   - Screen recording of Astrion OS running on the Surface Pro 6
   - "How a 12-year-old built an operating system" story
   - Before/after comparison (day 1 vs now)
   - App showcase videos (30s each for TikTok/Reels)

4. **Outreach:**
   - Post on r/linux, r/programming, r/webdev
   - Submit to Hacker News (Show HN: Astrion OS)
   - Product Hunt launch
   - Dev.to blog post

5. **Track metrics:**
   - GitHub stars
   - Website visits (GitHub Pages)
   - Social media followers
   - ISO downloads

**Tools you need:** Canva (free), OBS for recording, your phone for TikTok

**You do NOT need to code.** Everything is marketing, writing, and video.

---

## Koa — Tester / QA

### Your job: find every bug and report it

**How to test:**

1. Go to https://viraajbindra-a11y.github.io/Astrion-OS/
2. Try EVERY app — there are 76 of them
3. For each app, fill out this template:

```
App: [name]
Status: [Works / Partially works / Broken]
Bug: [what went wrong]
Steps: [how to reproduce]
Screenshot: [attach if possible]
```

**What to test in each app:**
- Does it open?
- Does the UI look right?
- Do buttons work?
- Does data save? (close and reopen)
- What happens with weird input? (empty, super long text, special characters)
- Does it work on your phone too?

**Bug report template** (create GitHub Issues):
1. Go to https://github.com/viraajbindra-a11y/Astrion-OS/issues
2. Click "New Issue"
3. Title: `[Bug] App Name — what's broken`
4. Describe the bug, steps to reproduce, expected vs actual behavior
5. Add screenshots

**Priority testing (test these first):**
- [ ] Finder (file management)
- [ ] Notes (text editing + AI)
- [ ] Terminal (does it show anything?)
- [ ] Calculator (math works?)
- [ ] Messages (AI responds?)
- [ ] Browser (opens new tab?)
- [ ] Weather (shows your city?)
- [ ] Settings (all sections work?)
- [ ] Music (plays audio?)
- [ ] Calendar (dates correct?)

**Then test the rest:**
- [ ] All 76 apps in the dock
- [ ] Spotlight search (Cmd+Space or Ctrl+Space)
- [ ] Setup wizard (clear localStorage in DevTools, refresh)
- [ ] Login screen (set a password in wizard, try logging in)
- [ ] Dark theme (everything readable?)
- [ ] Resize browser window (responsive?)
- [ ] Mobile phone (touch works?)

**You do NOT need to code.** Just use the OS, break things, and write down what's wrong.

---

## Lauren — Designer

### Your job: make Astrion OS look professional

**Week 1 tasks:**

1. **Design a logo** for Astrion OS
   - Current: simple diamond shape
   - Needs: professional logo that works at all sizes
   - Style: modern, dark theme friendly, recognizable
   - Deliver: SVG file, PNG at 512x512 and 1024x1024
   - Tools: Figma (free), Illustrator, or Canva

2. **Redesign app icons** (currently basic SVGs)
   - 76 apps need icons
   - Style guide: rounded square (like macOS), gradient backgrounds
   - Each icon: 120x120 SVG
   - Look at macOS/iOS icons for inspiration
   - Files go in: `assets/icons/[app-name].svg`

3. **Design wallpapers**
   - Current: 6 SVG wallpapers (basic gradients)
   - Need: 6-10 beautiful wallpapers
   - Resolution: 1920x1080 minimum (SVG preferred for scaling)
   - Style: dark, cosmic, abstract, nature
   - Files go in: `assets/wallpapers/`

4. **Design the boot screen**
   - Current: simple logo + progress bar
   - Could be: animated logo, branded loading screen
   - Edit: `index.html` (the boot screen section)

5. **Design the login screen**
   - Current: basic user icon + password field
   - Could be: beautiful blurred background, profile pic, clock

**How to submit your work:**
- Option A: Send files to Viraaj, he'll add them
- Option B: Fork the repo, add files, open a Pull Request
- Option C: Upload to a shared Google Drive/Dropbox

**Color palette:**
```
Background:  #0a0a1a (near black)
Surface:     #1e1e2e (dark card)
Accent:      #007aff (blue, configurable)
Text:        #e0e0e0 (light gray)
Success:     #34c759 (green)
Warning:     #ff9500 (orange)
Error:       #ff3b30 (red)
```

**You do NOT need to code.** Just design and deliver image files.

---

## Viraaj — Lead Developer

You already know what you're doing. Keep building with Claude.

**Your focus:**
- Architecture decisions
- Core system features
- AI integration (Ollama, Anthropic)
- ISO builds and Surface Pro testing
- Code review for any PRs
- Merging contributions from the team

---

## How We Work Together

1. **Communication:** Set up a Discord server or group chat
2. **Tasks:** Use GitHub Issues for bugs and feature requests
3. **Code:** Fork → branch → PR → review → merge
4. **Design:** Share files via Discord or Google Drive
5. **Marketing:** Naren posts, everyone shares

## Quick Start (for everyone)

1. Visit https://viraajbindra-a11y.github.io/Astrion-OS/
2. Try it out
3. Star the repo: https://github.com/viraajbindra-a11y/Astrion-OS
4. Join the Discord (link from Viraaj)
5. Start on your tasks above
