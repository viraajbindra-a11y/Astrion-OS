# 🐛 Bug Hunter — Starter Task

## What to send them

> Hey! Thanks for picking Bug Hunter. Here's your first 15-minute task.
>
> **Goal:** Find **1 bug** in Astrion OS and give me enough info to fix it.
>
> **Step 1 — Open Astrion in your browser:**
> https://viraajbindra-a11y.github.io/Astrion-OS/
>
> No download needed. It loads in ~30 seconds.
>
> **Step 2 — Use it for 10 minutes and try to break it.**
> Click weird things. Open 10 apps at once. Drag windows around. Type long stuff into Notes. Try Ctrl+Space. Try right-clicking. Spam-click buttons.
>
> **Step 3 — When something breaks or looks wrong, FREEZE and send me 4 things:**
>
> 1. **What app or screen you were on** (e.g., "the Calculator app")
> 2. **What you did** (e.g., "I typed 9999999999999 × 9999999999999")
> 3. **What happened** (e.g., "the whole calculator went blank and showed 'NaN'")
> 4. **A screenshot** (Mac: Shift+Cmd+4, then drag. Windows: Windows+Shift+S)
>
> That's it. One bug. 15 minutes.
>
> **Bonus points** if you can make the bug happen TWICE — that means it's reproducible and I can definitely fix it.
>
> I'll fix your bug and put your name in the release notes when the fix ships.

## What Viraaj does with the result

1. Save the screenshot to `tasks/bug-reports/<name>-<date>.png`
2. Reproduce the bug yourself. If you can, great. If not, reply asking for more steps.
3. Fix it if trivial. If not, add it to `tasks/bug-backlog.md` (create if doesn't exist) with their name.
4. **CREDIT THEM in the fix's commit message** — `git commit -m "Fix: calculator NaN on huge numbers (reported by <name>)"`
5. When the fix ships, tell them: "that bug you found is gone now."
6. If they found a good bug, ask them for another one.

## Follow-up task

Once they've found their first bug, set them loose. Tell them:
> "I need 3 more bugs by next weekend. Any kind. Go hunt."
> 
> They'll treat it like a game and you'll get free QA.

## Power-up for committed bug hunters

If they love this job, teach them how to file a GitHub issue directly:
1. Show them how to click "New Issue" on the repo
2. Give them a simple template: app + steps + result + screenshot
3. Now they don't even need you as the middleman — they can report bugs directly to the project

This is the most high-leverage thing you can teach a non-coder friend.
