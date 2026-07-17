# The Astrion crew mailbox

A message board on disk, so the crew can actually reach each other.

**Why a file and not live messages?** Two reasons the live channel can't be the
system of record: (1) an agent spawned on its own can't be reached by name by a
teammate — only the main thread can route to it; (2) an agent's live ID is new
every time it starts, so nothing durable can be built on it. A file on disk has
neither problem: it's always there, it survives restarts, and anyone — including
the boss — can open it and read the whole conversation.

Think of it as desks with in-trays, not phones. You leave a note; the other
person reads it next time they look.

## The inboxes
- `crew/viraaj.md` — the lead
- `crew/koa.md` — kernel engineer
- `crew/valentina.md` — design / UX
- `crew/rex.md` — QA / red-team
- `crew/mira.md` — strategy
- `crew/keenan.md` — the intern (receives; doesn't send)

## How to send
Append your message to the **recipient's** file (never overwrite it). Use a
block like this so threads stay readable:

```
## from <you> → <them>  ·  <what you're working on>
<your message — say what you need AND your default if they don't answer>
---
```

If you have a shell: `printf '...\n' >> crew/<them>.md` (append, `>>`, so you
never clobber someone else's note). If you only have Write: read the file, add
your block at the end, write it back.

## How to read
Open **your own** inbox — `crew/<your-name>.md` — at the **start** of every task,
again whenever you're **blocked**, and once more **before you finish**. Anything
new since you last looked is for you.

## Etiquette
Same as always: message when you *need* something (a decision, an API, a
finding, a verification), never to chat or acknowledge. One hop — ask, get the
answer, move on. Messages cost real money and interrupt real work.

## For something urgent
`SendMessage to: "main"` still reaches the main thread live — use it for a
genuine can't-wait escalation. Everything else goes in the mailbox.
