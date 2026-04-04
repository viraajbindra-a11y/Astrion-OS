# NOVA OS — Desktop App Installer

Download and run NOVA OS as a native desktop application.

## Downloads

Go to the GitHub Actions tab → latest "Build NOVA OS Desktop App" run → download:

- **macOS**: `nova-os-mac.dmg` — drag to Applications, done
- **Windows**: `nova-os-win.exe` — run the installer
- **Linux**: `nova-os-linux.AppImage` — make executable and run

## Build Locally

```bash
cd installer

# Copy web files into the app
bash setup.sh

# Test it
npm start

# Build for your platform
npm run build:mac    # macOS .dmg
npm run build:win    # Windows .exe
npm run build:linux  # Linux .AppImage
```

## How It Works

The installer packages NOVA OS into an Electron app:
1. A local Express server serves NOVA OS files
2. Electron opens a frameless window (no native chrome)
3. NOVA OS renders its own menubar, dock, and windows
4. The result looks and feels like a standalone operating system

## AI Features

Set the `ANTHROPIC_API_KEY` environment variable to enable real AI:

```bash
ANTHROPIC_API_KEY=sk-ant-... ./nova-os
```

Without the key, the built-in mock AI handles basic queries.
