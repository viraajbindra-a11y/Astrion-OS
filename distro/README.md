# Astrion OS — Linux Distribution

A real operating system based on Debian, with Astrion OS as the desktop environment.

> **v0.2.0 ISO (2026-04-11):** bundles the Polish Sprint — Naren's Astrion Brain
> hero wallpaper as default, Finder v2 with keyboard nav and media previews,
> multi-monitor awareness, auto-updater wiring, accessibility scaffolding,
> and the M2 hypergraph storage layer.

## What this is

Astrion OS is a complete Linux distribution. It's not a web app in a browser — it's a real operating system that:
- Boots on real hardware (UEFI + Legacy BIOS)
- Runs real applications (Firefox, LibreOffice, GIMP, VS Code, etc.)
- Has a real terminal with bash
- Has a real file manager
- Can install apps from apt, flatpak, or the NOVA App Store
- Has the NOVA AI assistant built into the desktop
- Has our custom dock, menubar, window manager, and desktop shell

## How to build

### Automatic (GitHub Actions)
Push to main → Actions tab → "Build NOVA OS ISO" → download the ISO from artifacts.

### Manual (requires Ubuntu/Debian)
```bash
sudo bash distro/build.sh
```

## How to use

1. Download the ISO
2. Flash to USB with Balena Etcher (https://etcher.balena.io)
3. Boot from USB on any PC
4. NOVA OS runs — real OS, real apps, real AI

## System Requirements
- 4GB RAM (2GB minimum)
- 20GB disk space
- x86_64 processor
- USB drive (8GB+) for live boot
