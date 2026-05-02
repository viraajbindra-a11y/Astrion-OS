# Astrion OS

An AI-native operating system with 76 apps, built from scratch.

**Native C/GTK3 desktop shell** — not a web page pretending to be an OS. Each app opens in its own real window. The menubar, dock, and desktop are native widgets. Hardware access (battery, Wi-Fi, volume) reads directly from the system.

## Screenshots

*Coming soon*

## Features

### Native Desktop Shell (C/GTK3)
- Native menubar with real clock, battery, Wi-Fi status
- Dock with SVG app icons
- Alt+Tab app switcher
- Desktop right-click menu
- Window snap to edges (left/right/top)
- Colored traffic light buttons (close/minimize/maximize)
- Spotlight search (Ctrl+Space)
- Screensaver (5 min idle)
- HiDPI support (auto-detects Surface Pro resolution)

### 76 Apps

| Category | Apps |
|---|---|
| **Productivity** | Notes, Text Editor, Reminders, Todo, Kanban, Pomodoro, Sticky Notes, Calendar |
| **Communication** | Messages (AI chat), Contacts |
| **Development** | Terminal (real bash), Markdown Editor, System Info |
| **Media** | Music, Photos, Video Player, Draw, Whiteboard, Screen Recorder, Voice Memos |
| **Utilities** | Calculator, Clock, Stopwatch, Timer, Weather, Maps, Translator, Unit Converter, Color Picker, Dictionary, QR Code, Password Generator |
| **System** | Finder, Settings, Task Manager, Vault (password manager), Trash, Installer |
| **Learning** | Flashcards, Typing Test, Journal, Habit Tracker |
| **Games** | Chess, Snake, 2048 |
| **Store** | App Store (Flatpak + Android/Waydroid), Budget Tracker, PDF Viewer, Daily Quotes |
| **Browser** | Astrion Browser (custom WebKitGTK with tabs) |

### AI Integration
- **Ollama support** — connect to local/remote LLMs
- **Anthropic API** — Claude integration
- **AI in Messages** — chat with Astrion AI
- **AI in Notes** — summarize, rewrite, expand
- **AI in Spotlight** — ask anything
- **AI Translator** — powered by LLM

### Security
- **Vault** — AES-GCM encrypted password manager
- **PBKDF2 login** — 250k iteration password hashing
- **App permissions** — camera/mic/location prompts
- **Server rate limiting** — token bucket per endpoint
- **Idle auto-lock** — configurable timeout

### App Store
- **Flatpak** — install real Linux apps (Firefox, VS Code, Spotify, Discord, Steam)
- **Android/Waydroid** — Google Play Store support (setup required)
- **AI Skills** — installable AI capabilities

## Running

### Web Version (demo)
Visit [viraajbindra-a11y.github.io/Astrion-OS](https://viraajbindra-a11y.github.io/Astrion-OS/)

### Desktop App (Electron)
Download from [Releases](https://github.com/viraajbindra-a11y/Astrion-OS/releases)

### Bootable ISO (real OS)
1. Download the ISO from [GitHub Actions](https://github.com/viraajbindra-a11y/Astrion-OS/actions)
2. Flash to USB with [Balena Etcher](https://etcher.balena.io/)
3. Boot from USB
4. Tested on: Surface Pro 6, UTM/QEMU VMs

### Development
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
│  │  Panel    │ │   Dock   │ │Desktop │  │
│  │ (native) │ │ (native) │ │(native)│  │
│  └──────────┘ └──────────┘ └────────┘  │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  App 1  │ │  App 2  │ │  App 3  │  │
│  │(WebKit) │ │(WebKit) │ │(WebKit) │  │
│  └─────────┘ └─────────┘ └─────────┘  │
│         ↕            ↕           ↕      │
│    ┌──────────────────────────────┐     │
│    │   Express.js Server (:3000) │     │
│    │   + WebSocket Terminal      │     │
│    └──────────────────────────────┘     │
└─────────────────────────────────────────┘
```

## Tech Stack
- **Shell**: C, GTK3, Cairo
- **Apps**: Vanilla JavaScript, CSS, HTML
- **Renderer**: WebKitGTK
- **Server**: Node.js, Express
- **Browser**: Custom WebKitGTK (astrion-browser)
- **AI**: Ollama, Anthropic API
- **OS Base**: Debian Bookworm (for ISO)
- **Build**: debootstrap + xorriso + GRUB

## License
MIT

## Credits
Built by a 12-year-old developer with Claude AI.
