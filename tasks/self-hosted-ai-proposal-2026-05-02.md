# Self-hosted AI on the AI OS — proposal (2026-05-02)

> Astrion should host its own AI brain. The remote-PC dependency in the
> demo plan was a workaround, not a feature.

## Why now

The cancelled Sunday demo exposed a structural weakness: Astrion's
"AI brain" required a separate gaming PC (9800X3D + 5080 + LAN +
gpt-oss:16b pulled). For a stranger downloading the ISO and booting
from USB, that's three problems they don't want to solve. **A real
"AI-native OS" runs its own AI by default.**

## What's already shipped

- **Ollama is installed in non-slim ISOs** (`distro/build.sh:215-228`)
  via `curl https://ollama.com/install.sh | sh` in the chroot.
  systemd unit enabled so it starts on boot.
- **Slim ISOs skip Ollama** to fit under the 2 GiB GitHub release cap.
  Settings has an "Install local AI runtime" affordance (per build.sh
  line 224 reference).
- **`ai-service.js`** defaults Ollama URL to `http://localhost:11434`
  and model to `qwen2.5:7b`. Both configurable in Settings > AI.
- **Settings > AI > Pull Model** streams ndjson progress from
  `/api/ai/ollama-pull` (server proxy of Ollama's `/api/pull`).
  Works for primary AND red-team model.
- **Server has `/api/ai/ollama-tags`** to list locally pulled models —
  used by the Settings model picker dropdown.

So the SUBSTRATE is there. Astrion already runs its own Ollama. The
demo plan just defaulted to remote because the Surface Pro 6 doesn't
have enough RAM (~16 GB usually) for `gpt-oss:16b` (~10 GB) without
swapping hard.

## What's missing (the gap)

### 1. First-boot AI brain picker
The setup wizard has 5-6 steps (welcome, account, wallpaper, accent,
ready). It does NOT ask which AI brain you want. Result: a fresh boot
has no model pulled, the AI provider defaults to "auto" which falls
through to mock responses, and the user gets the offline experience
silently.

**Fix:** add one step — "Pick your AI brain" — with 4 options:

| Option | Model | Size | RAM needed | When |
|---|---|---|---|---|
| **Tiny** | `phi3:3.8b-mini` or `qwen2.5:1.5b` | ~1.5 GB | 4 GB | Default for low-RAM machines, Chromebooks |
| **Standard** | `qwen2.5:7b` | ~4.7 GB | 8 GB | Default for most laptops |
| **Big** | `gpt-oss:16b` (or successor) | ~10 GB | 16 GB+ | Surface Pro 6 + similar |
| **Remote** | (URL prompt) | n/a | n/a | "I have a beefy PC on the LAN" |
| **None** | mock | 0 | 0 | "I'll set it up later" — provider stays auto, falls back to mock |

The wizard:
- Detects available RAM via `/api/system/memory`
- Recommends Tiny if < 6 GB free, Standard if 8+ GB, Big if 16+ GB
- On confirm, kicks off `ollama pull <model>` with the existing
  ndjson progress UI in the wizard pane (no need to reach Settings)
- Sets `localStorage['nova-ai-ollama-model']` and provider='ollama'
- Default URL stays localhost:11434

### 2. RAM-aware safety
Settings > AI > Pull Model currently has size hints in text but
doesn't BLOCK a user with 4 GB free from trying to pull a 10 GB model.
Add a check before kicking off the pull:
- If `(model_size + 2GB headroom) > free_ram`, show a warning
  modal: "This model needs N GB free; you have M. Pulling will swap
  hard. Continue anyway?" with explicit confirm.

### 3. LAN share mode (optional, post-v1.0)
"This Astrion is hosting AI on port 11434 — let other Astrion installs
on the network use it as their brain?" Toggle in Settings > AI > Host.
Default OFF for privacy. When ON:
- Bind Ollama to 0.0.0.0:11434 (currently default = localhost)
- mDNS broadcast `_astrion-ai._tcp.local`
- Other Astrion installs see "Discovered: viraajs-surface.local"
  in their AI URL picker
- Adds a tiny "shared mode" lock icon in the menubar

This turns one beefy Astrion into a brain for the household. **Real
"local sovereign agency"** at the family-network scale.

### 4. Default Ollama service hardening
Currently Ollama starts via systemd at boot. But:
- If user pulled a model that won't fit in RAM, Ollama OOM-kills
  and the user sees "AI offline" with no diagnostic
- No "AI is starting up, please wait" indicator anywhere in shell
- No way to see Ollama's logs from inside Astrion (no journalctl UI)

**Fix:** Settings > AI > Diagnostics panel — shows:
- Ollama service status (active/inactive/failed)
- Last 50 lines of `journalctl -u ollama`
- Pulled models with sizes
- Free RAM / disk
- "Restart Ollama" button (calls `sudo -n systemctl restart ollama`)

## Implementation plan (3 sprints)

### Sprint A: First-boot brain picker (week 19, May 4-10)
- New setup-wizard step `chooseAiBrain.js`
- Reuses existing `/api/ai/ollama-pull` ndjson streaming
- RAM detection from `/api/system/memory`
- Test: fresh ISO → wizard → Tiny picked → model pulls in 60s on
  reasonable connection → desktop boots with working AI
- Lessons checkpoint: write whatever breaks

### Sprint B: RAM safety + diagnostics (week 20, May 11-17)
- Add RAM check to Settings > AI > Pull Model
- Add Diagnostics panel
- Test: pull a model that's too big → warning fires → user can
  override → if they override and OOM, diagnostics shows it cleanly

### Sprint C (post-v1.0, deferred): LAN share mode
- Bind Ollama to all interfaces (kernel cmdline opt-in)
- mDNS broadcaster
- Discovered-hosts UI in Settings > AI > Connect
- Test: two ISOs on same Wi-Fi, one shares, the other discovers,
  cross-host plan executes correctly with the shared brain

## Why this matters for the launch story

"Astrion runs its own AI on your laptop. You don't need a cloud
account, you don't need to pay per token, you don't need our servers
up. Pick a model that fits your RAM, hit pull, and Astrion is
sovereign."

Compare to:
- Microsoft Copilot+: needs cloud + 40-TOPS NPU
- Apple Intelligence: needs Apple Silicon + cloud handoff for
  big-model queries
- Anthropic Claude Cowork: needs Claude API + paid plan
- OpenInterpreter / 01: open source but agent-on-host, not OS layer
- Brain Tech Natural OS: closed phone with their own cloud

**Astrion: open desktop OS, your hardware, your AI, no cloud, no key.**
That's the marketing claim and it should be literally true on first
boot, not after a 30-min setup.

## What to do this week

1. Sprint A starts week 19 if user picks (a) hardening for Spotlight
   help — defer Sprint A to week 20.
2. OR Sprint A starts NOW because the Chromebook + AMD Lenovo
   testers funded for Phase 4 will hit this exact path on first boot,
   and "you need a separate PC to use the AI OS" is the worst possible
   first impression.

**Recommendation:** Sprint A this week, Spotlight help polish week 20.

## Files that will change

- New: `js/shell/setup-wizard.js` — add `step-ai-brain` between accent
  picker and ready
- New: `js/shell/wizard-ai-brain.js` — the picker UI + pull logic
- Modified: `server/index.js` — add `/api/system/memory` if not exposing
  free RAM (check; might already be there per agent reports)
- Modified: `js/kernel/ai-service.js` — handle "wizard chose tiny but
  user has limited RAM later" (re-pull suggestion)
- Modified: `distro/build.sh` — slim ISO should NOT skip Ollama
  install entirely; instead skip the SYSTEMD ENABLE so the user opts
  in via the wizard. (Avoids bricking on resource-constrained boxes.)
- New: `tasks/self-hosted-ai-sprint-A.md` (sprint plan + tests)
- Lessons +N captured per Sprint A pass

## Open questions for Viraaj

1. Default model: `phi3:3.8b-mini` (Microsoft, 1.7 GB, very capable)
   or `qwen2.5:1.5b` (Alibaba, 1.0 GB, smaller)?
2. Should the wizard's "Big" option require typed confirmation given
   pulling 10 GB on a slow connection is a 30-min commitment?
3. LAN share mode: pre-v1.0 or post-v1.0? Adds polish + headline
   ("Astrion as a household AI brain"), costs ~1 week.

---

*Filed 2026-05-02 by Claude Opus 4.7. Replace assumptions with evidence
when the Chromebook + AMD Lenovo arrive.*
