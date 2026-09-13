# Contributing to Astrion OS

## The Team

| Role | Person | Focus |
|---|---|---|
| **Lead Developer** | Viraaj | Architecture, code, features, AI integration |
| **Tester / QA** | Koa | Bug reports, app testing, UX feedback |

---

## Koa — Tester / QA

### Your job: find every bug and report it

**The product is the from-scratch kernel.** Test that first:

1. Read [docs/try-astrion.md](docs/try-astrion.md) and boot the latest
   `astrion.iso` in VirtualBox, QEMU or UTM.
2. Do everything the page says to do: the Assistant prompts, the teach-it
   step, the Terminal commands, the reboot-with-a-disk step.
3. Anything that looks wrong, freezes, or says something untrue is a bug.
   A screenshot plus the serial log (`-serial stdio`) is the perfect report.

**The web desktop** (frozen until Oct 1, but still testable):

1. Run it locally (`npm install && npm start`, then http://localhost:3000)
   or use https://viraajbindra-a11y.github.io/Astrion-OS/
2. Try EVERY app — there are 78 of them (62 real + 16 toys)
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
- [ ] All 78 apps register (62 real apps + 16 toys)
- [ ] Spotlight search (Cmd+Space or Ctrl+Space)
- [ ] Setup wizard (clear localStorage in DevTools, refresh)
- [ ] Login screen (set a password in wizard, try logging in)
- [ ] Dark theme (everything readable?)
- [ ] Resize browser window (responsive?)
- [ ] Mobile phone (touch works?)

**You do NOT need to code.** Just use the OS, break things, and write down what's wrong.

---

## Viraaj — Lead Developer

You already know what you're doing. Keep building with Claude.

**Your focus:**
- Architecture decisions
- The kernel (`kernel/`) and its release (`os-v*` tags)
- AI integration
- Code review for any PRs
- Merging contributions

---

## How We Work Together

1. **Communication:** group chat
2. **Tasks:** Use GitHub Issues for bugs and feature requests
3. **Code:** Fork → branch → PR → review → merge

## Quick Start (for everyone)

1. Boot the kernel ISO: [docs/try-astrion.md](docs/try-astrion.md)
2. Star the repo: https://github.com/viraajbindra-a11y/Astrion-OS
3. Start on your tasks above

## Gates

A check does not count until its mutation check is committed next to it. The mutation check deliberately breaks the thing the check guards and proves the check goes red; a gate that has never been seen to fail has never been tested. Land both in the same commit, or the check is a comment with a green badge on it.
