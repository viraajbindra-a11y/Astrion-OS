# I2 — make it hold a conversation

The intent layer is broad now (18 questions, 8 actions, 8 apps) and Rex has
cross-checked its answers against the serial log, so they are true. It is still
not an assistant. It is a command line with synonyms.

The reason is one thing: **every prompt is standalone.** Nobody talks like that.

```
> make notes.txt
created notes.txt
> write hello to it          <- means notes.txt. Today: creates "it.txt".
> open it                    <- still notes.txt. Today: fails.
> actually delete it         <- still notes.txt.
```

Fixing this is worth more than another twenty intents, and it needs no model —
it is pure string logic, so it is host-testable like everything else here.

## What to build

**A "last file" slot.** Any intent that succeeds on a named file records that
name. The referring words — `it`, `that`, `this`, `the file`, `the same file`,
and a bare `same` — resolve to it.

**One slot, not a history.** `it` means the most recent file, full stop. A
two-deep stack invites "the other one" and there is no way to be sure which the
user meant. When we cannot be sure, we ask — same principle as the delete gate.

**The slot must expire.** A pronoun that resolves to something the user typed
ten minutes and four topics ago is worse than not resolving at all: it acts
confidently on a guess. Clear it when the Assistant window closes. Consider
clearing it after N unrelated prompts.

**Refuse rather than guess.** `open it` with nothing recorded must say "I don't
know what 'it' refers to — name the file", never fall back to a literal
`it.txt`. That fallback is exactly the shape of every bug we fixed today: a
confident action on a name the user never typed.

## Why this is safe to attach to destructive verbs

`delete it` goes through the same confirm gate, and the gate NAMES THE FILE. So
the pronoun's resolution is shown to the user before anything happens:

```
> delete it
delete notes.txt (14 B)?
```

If `it` resolved wrongly, they see the wrong name and say no. The confirmation
we spent four rounds building is what makes this feature safe to ship — the
pronoun never acts invisibly.

That is also the ordering argument: this could not have been built first.

## Second, smaller: did-you-mean

`read notes.txt` when the file is `note.txt` currently says "no file called
notes.txt." It knows the whole directory. It should say:

```
no file called notes.txt. did you mean note.txt?
```

Cheap, purely local, and it turns a dead end into a recovery. Edit distance of
1-2 over the real directory listing, best match only, and say nothing if
nothing is close — a bad suggestion is worse than none.

**Never auto-correct**, especially not for a destructive verb. Suggest, and
make them retype. A near-miss on `delete` is precisely where a helpful guess
destroys the wrong file.

## Rules

Same as the rest of this arc. Every referring word gets rows in
`tests/test_assist_match.c`, including negatives — `is it working` must not
resolve `it` as a filename, and `read it.txt` names a real file called `it.txt`
and must not be treated as a pronoun at all. Sequence rows for the whole
conversation, not single prompts: this feature lives entirely in the join
between two submissions, which is where today's two worst bugs both hid.

Control every gate: revert, confirm the new rows fail, restore, report it.
