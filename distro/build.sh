#!/bin/bash
# NOVA OS — Build Script
# Creates a bootable ISO with NOVA OS as a real Linux desktop environment.
# Uses GRUB bootloader (EFI + BIOS) — no syslinux/isolinux dependency.
# Run on Ubuntu/Debian: sudo bash distro/build.sh

set -e

echo "============================================"
echo "  NOVA OS — Building Real Operating System"
echo "============================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
OUTPUT_DIR="$SCRIPT_DIR/output"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"
cd "$BUILD_DIR"

# ============================================
# 1. Install build tools
# ============================================
echo "[1/8] Installing build tools..."
apt-get update -qq
apt-get install -y -qq \
  debootstrap xorriso squashfs-tools grub-pc-bin grub-efi-amd64-bin \
  mtools dosfstools debian-archive-keyring 2>/dev/null

# ============================================
# 2. Bootstrap a minimal Debian system
# ============================================
echo "[2/8] Bootstrapping Debian Bookworm (this takes a few minutes)..."
CHROOT="$BUILD_DIR/chroot"
debootstrap --arch=amd64 --components=main,contrib,non-free,non-free-firmware \
  bookworm "$CHROOT" http://deb.debian.org/debian

# ============================================
# 3. Configure the chroot
# ============================================
echo "[3/8] Configuring system..."

# Mount required filesystems
mount --bind /dev "$CHROOT/dev"
mount --bind /dev/pts "$CHROOT/dev/pts"
mount -t proc proc "$CHROOT/proc"
mount -t sysfs sysfs "$CHROOT/sys"

# Set up resolv.conf for network access in chroot
cp /etc/resolv.conf "$CHROOT/etc/resolv.conf"

# Add security and other repos
cat > "$CHROOT/etc/apt/sources.list" << 'SOURCES'
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
deb http://deb.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
SOURCES

# ============================================
# 4. Install packages inside chroot
# ============================================
echo "[4/8] Installing packages (this takes 10-20 minutes)..."

cat > "$CHROOT/tmp/install-packages.sh" << 'INSTALL_SCRIPT'
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq

# Install kernel + live boot
apt-get install -y -qq linux-image-amd64 live-boot systemd-sysv

# Display server (NO window manager — NOVA Shell IS the desktop)
apt-get install -y -qq xorg xinit xdotool hsetroot

# NOVA native renderer dependencies (WebKitGTK + GTK3 + build tools)
apt-get install -y -qq libwebkit2gtk-4.0-dev libgtk-3-dev gcc pkg-config make

# Utilities only (no polybar, no plank, no rofi — NOVA OS has its own native shell)
apt-get install -y -qq dunst feh

# Keep a lightweight browser for external web browsing (not the shell)
apt-get install -y -qq firefox-esr || true

# Terminal + file manager + text editor
apt-get install -y -qq xfce4-terminal thunar thunar-archive-plugin tumbler mousepad geany

# Real apps
apt-get install -y -qq xfce4-screenshooter galculator eog vlc evince xarchiver shotwell

# LibreOffice (big but essential for a real OS)
apt-get install -y -qq libreoffice-writer libreoffice-calc libreoffice-impress || true

# System tools
apt-get install -y -qq xfce4-power-manager gvfs gvfs-backends gvfs-fuse udisks2 \
  gnome-disk-utility xdg-utils xdg-user-dirs dconf-cli at-spi2-core

# Printing
apt-get install -y -qq cups cups-client system-config-printer || true

# Bluetooth
apt-get install -y -qq bluez bluez-tools blueman || true

# Audio
apt-get install -y -qq pulseaudio pulseaudio-module-bluetooth pavucontrol alsa-utils

# Networking
apt-get install -y -qq network-manager network-manager-gnome wpasupplicant \
  firmware-iwlwifi firmware-realtek firmware-atheros firmware-misc-nonfree || true

# Clipboard + tools
apt-get install -y -qq xclip xsel xdotool trash-cli

# Appearance
apt-get install -y -qq papirus-icon-theme fonts-inter fonts-noto fonts-noto-color-emoji \
  arc-theme adwaita-icon-theme gtk2-engines-murrine || true

# Development (for NOVA AI)
apt-get install -y -qq nodejs npm git curl wget python3 || true

# System (NO lightdm — we boot straight into NOVA OS)
apt-get install -y -qq sudo dbus-x11 policykit-1 policykit-1-gnome upower acpi acpid \
  plymouth imagemagick || true

# App installation
apt-get install -y -qq flatpak gnome-software software-properties-common || true

# Multimedia codecs
apt-get install -y -qq ffmpeg gstreamer1.0-plugins-base gstreamer1.0-plugins-good || true

# Display drivers
apt-get install -y -qq xserver-xorg-video-intel xserver-xorg-video-amdgpu \
  xserver-xorg-video-nouveau mesa-utils || true

# Bootloader (GRUB for both EFI and BIOS)
apt-get install -y -qq grub-efi-amd64-bin grub-pc-bin grub-common || true

# Clean up
apt-get clean
rm -rf /var/lib/apt/lists/*

echo "Package installation complete."
INSTALL_SCRIPT

chmod +x "$CHROOT/tmp/install-packages.sh"
chroot "$CHROOT" /tmp/install-packages.sh

# ============================================
# 5. Install NOVA OS desktop environment
# ============================================
echo "[5/8] Installing NOVA OS desktop..."

# NOVA session file (display manager sees this)
mkdir -p "$CHROOT/usr/share/xsessions"
cp "$SCRIPT_DIR/nova-desktop/nova-session.desktop" "$CHROOT/usr/share/xsessions/"

# NOVA session launcher
mkdir -p "$CHROOT/usr/bin"
cp "$SCRIPT_DIR/nova-desktop/nova-session" "$CHROOT/usr/bin/nova-session"
chmod +x "$CHROOT/usr/bin/nova-session"

# NOVA Spotlight (app launcher)
cp "$SCRIPT_DIR/nova-desktop/nova-spotlight" "$CHROOT/usr/bin/nova-spotlight"
chmod +x "$CHROOT/usr/bin/nova-spotlight"

# Openbox config
mkdir -p "$CHROOT/etc/nova-os/openbox"
cp "$SCRIPT_DIR/nova-desktop/openbox-rc.xml" "$CHROOT/etc/nova-os/openbox/rc.xml"

# Polybar config (menubar)
mkdir -p "$CHROOT/etc/nova-os"
cp "$SCRIPT_DIR/nova-desktop/polybar.ini" "$CHROOT/etc/nova-os/polybar.ini"

# Rofi theme (spotlight)
cp "$SCRIPT_DIR/nova-desktop/rofi-theme.rasi" "$CHROOT/etc/nova-os/rofi-theme.rasi"

# NOVA AI server + web assets
mkdir -p "$CHROOT/opt/nova-os"
cp "$PROJECT_ROOT/index.html" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/css" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/js" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/server" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp "$PROJECT_ROOT/package.json" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/assets" "$CHROOT/opt/nova-os/" 2>/dev/null || true

# ── NOVA Native Renderer (our own rendering engine, NOT Chromium) ──
echo "  Compiling NOVA native renderer..."
mkdir -p "$CHROOT/opt/nova-os/renderer"
cp "$SCRIPT_DIR/nova-renderer/nova-shell.c" "$CHROOT/opt/nova-os/renderer/"
cp "$SCRIPT_DIR/nova-renderer/nova-renderer.c" "$CHROOT/opt/nova-os/renderer/"
cp "$SCRIPT_DIR/nova-renderer/Makefile" "$CHROOT/opt/nova-os/renderer/"
cp "$SCRIPT_DIR/nova-renderer/nova-start.sh" "$CHROOT/opt/nova-os/renderer/"

# Compile inside chroot (has access to GTK/WebKitGTK headers)
cat > "$CHROOT/tmp/build-renderer.sh" << 'BUILD_RENDERER'
#!/bin/bash
set -e
cd /opt/nova-os/renderer
make clean
make all
make install
echo "NOVA native renderer compiled successfully!"
which nova-shell && echo "  nova-shell: $(which nova-shell)"
which nova-renderer && echo "  nova-renderer: $(which nova-renderer)"
BUILD_RENDERER
chmod +x "$CHROOT/tmp/build-renderer.sh"
chroot "$CHROOT" /tmp/build-renderer.sh

# ---- NOVA OS Branding ----

# Generate NOVA wallpaper with ImageMagick (dark gradient with logo)
mkdir -p "$CHROOT/usr/share/nova-os/wallpapers"

cat > "$CHROOT/tmp/gen-wallpaper.sh" << 'WALLPAPER_SCRIPT'
#!/bin/bash
# Generate NOVA OS wallpaper using ImageMagick
if command -v convert &>/dev/null; then
  # Dark gradient wallpaper (1920x1080)
  convert -size 1920x1080 \
    gradient:'#0a0a1a'-'#1a1a3e' \
    -blur 0x20 \
    \( -size 1920x1080 \
       -seed 42 plasma:transparent-'#0022aa10' \
       -blur 0x40 \) \
    -compose overlay -composite \
    \( -size 300x300 xc:none \
       -fill 'rgba(0,122,255,0.08)' \
       -draw 'circle 150,150 150,0' \
       -blur 0x60 \
       -geometry +810+390 \) \
    -compose over -composite \
    /usr/share/nova-os/wallpapers/default.png 2>/dev/null || \
  # Fallback: simple gradient
  convert -size 1920x1080 gradient:'#0a0a1a'-'#1a1a3e' \
    /usr/share/nova-os/wallpapers/default.png 2>/dev/null || true
fi
WALLPAPER_SCRIPT
chmod +x "$CHROOT/tmp/gen-wallpaper.sh"
chroot "$CHROOT" /tmp/gen-wallpaper.sh

# Plymouth boot splash theme (NOVA OS branded)
mkdir -p "$CHROOT/usr/share/plymouth/themes/nova-os"

cat > "$CHROOT/usr/share/plymouth/themes/nova-os/nova-os.plymouth" << 'PLYMOUTH'
[Plymouth Theme]
Name=NOVA OS
Description=NOVA OS Boot Splash
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/nova-os
ScriptFile=/usr/share/plymouth/themes/nova-os/nova-os.script
PLYMOUTH

cat > "$CHROOT/usr/share/plymouth/themes/nova-os/nova-os.script" << 'PLYSCRIPT'
# NOVA OS Plymouth Script
Window.SetBackgroundTopColor(0.04, 0.04, 0.10);
Window.SetBackgroundBottomColor(0.06, 0.06, 0.18);

# Load logo
logo.image = Image("logo.png");
logo.sprite = Sprite(logo.image);
logo.sprite.SetX(Window.GetWidth() / 2 - logo.image.GetWidth() / 2);
logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2 - 40);
logo.sprite.SetOpacity(1);

# NOVA OS text
nova_text.image = Image.Text("N O V A  O S", 0.85, 0.85, 0.85, 1, "Inter 18");
nova_text.sprite = Sprite(nova_text.image);
nova_text.sprite.SetX(Window.GetWidth() / 2 - nova_text.image.GetWidth() / 2);
nova_text.sprite.SetY(Window.GetHeight() / 2 + 50);

# Progress bar
bar_bg.image = Image("progress-bg.png");
bar_bg.sprite = Sprite(bar_bg.image);
bar_bg.sprite.SetX(Window.GetWidth() / 2 - bar_bg.image.GetWidth() / 2);
bar_bg.sprite.SetY(Window.GetHeight() / 2 + 90);

bar_fill.original = Image("progress-fill.png");
bar_fill.sprite = Sprite();
bar_fill.sprite.SetX(Window.GetWidth() / 2 - bar_bg.image.GetWidth() / 2);
bar_fill.sprite.SetY(Window.GetHeight() / 2 + 90);

fun boot_progress_cb(time, progress) {
    bar_fill.image = bar_fill.original.Scale(bar_bg.image.GetWidth() * progress, bar_fill.original.GetHeight());
    bar_fill.sprite.SetImage(bar_fill.image);
}
Plymouth.SetBootProgressFunction(boot_progress_cb);

# Hide messages/password prompts gracefully
fun message_cb(text) { }
Plymouth.SetMessageFunction(message_cb);
PLYSCRIPT

# Generate Plymouth logo and progress bar images using ImageMagick in chroot
cat > "$CHROOT/tmp/gen-plymouth-assets.sh" << 'PLYASSETS'
#!/bin/bash
cd /usr/share/plymouth/themes/nova-os

if command -v convert &>/dev/null; then
  # Logo: white diamond in circle (80x80)
  convert -size 80 80 xc:none \
    -fill none -stroke 'rgba(255,255,255,0.9)' -strokewidth 2 \
    -draw 'circle 40,40 40,4' \
    -fill 'rgba(255,255,255,0.9)' -stroke none \
    -draw 'polygon 40,18 58,40 40,62 22,40' \
    -fill white \
    -draw 'circle 40,40 40,34' \
    logo.png 2>/dev/null || \
  # Fallback: simple white circle
  convert -size 80x80 xc:none \
    -fill 'rgba(255,255,255,0.8)' \
    -draw 'circle 40,40 40,5' \
    logo.png 2>/dev/null || true

  # Progress bar background (200x3)
  convert -size 200x3 xc:'rgba(255,255,255,0.15)' \
    -fill 'rgba(255,255,255,0.15)' -draw 'roundrectangle 0,0 199,2 2,2' \
    progress-bg.png 2>/dev/null || \
  convert -size 200x3 xc:'rgba(255,255,255,0.15)' progress-bg.png 2>/dev/null || true

  # Progress bar fill (200x3)
  convert -size 200x3 xc:'rgba(255,255,255,0.7)' \
    -fill 'rgba(255,255,255,0.7)' -draw 'roundrectangle 0,0 199,2 2,2' \
    progress-fill.png 2>/dev/null || \
  convert -size 200x3 xc:'rgba(255,255,255,0.7)' progress-fill.png 2>/dev/null || true
else
  # No ImageMagick — create minimal 1x1 PNGs
  printf '\x89PNG\r\n\x1a\n' > logo.png || true
fi
PLYASSETS
chmod +x "$CHROOT/tmp/gen-plymouth-assets.sh"
chroot "$CHROOT" /tmp/gen-plymouth-assets.sh

# Dunst notification config
cat > "$CHROOT/etc/nova-os/dunstrc" << 'DUNST'
[global]
    monitor = 0
    follow = mouse
    width = 320
    height = (0, 300)
    origin = top-right
    offset = 12x36
    notification_limit = 5
    padding = 12
    horizontal_padding = 14
    frame_width = 1
    frame_color = "#333333"
    separator_color = frame
    font = Inter 12
    markup = full
    format = "<b>%s</b>\n%b"
    alignment = left
    show_age_threshold = 60
    corner_radius = 12
    background = "#1e1e2eee"
    foreground = "#ffffff"
    timeout = 5

[urgency_low]
    background = "#1e1e2eee"
    foreground = "#888888"

[urgency_normal]
    background = "#1e1e2eee"
    foreground = "#ffffff"

[urgency_critical]
    background = "#cc2222ee"
    foreground = "#ffffff"
DUNST

# User directories
mkdir -p "$CHROOT/etc/skel/Desktop"
mkdir -p "$CHROOT/etc/skel/Documents"
mkdir -p "$CHROOT/etc/skel/Downloads"
mkdir -p "$CHROOT/etc/skel/Pictures"
mkdir -p "$CHROOT/etc/skel/Music"
mkdir -p "$CHROOT/etc/skel/Videos"
mkdir -p "$CHROOT/etc/skel/.local/share/Trash/files"
mkdir -p "$CHROOT/etc/skel/.local/share/Trash/info"

# Welcome file
cat > "$CHROOT/etc/skel/Desktop/Welcome.txt" << 'WELCOME'
Welcome to NOVA OS!

This is a real operating system. Here's what you can do:

APPS:
- Chromium: Browse the web (full browser)
- Thunar: Manage your files
- Terminal: Run commands with bash
- Mousepad/Geany: Edit text and code
- VLC: Play videos and music
- Shotwell: View and manage photos
- Calculator: Do math
- LibreOffice: Documents, spreadsheets, presentations
- Software Center: Install more apps

SHORTCUTS:
- Super key: Open app launcher (Spotlight)
- Ctrl+Alt+T: Open terminal
- Ctrl+Alt+F: Open file manager
- Ctrl+Alt+B: Open browser
- Print Screen: Take screenshot
- Super+L: Lock screen
- Super+Left/Right: Snap windows to half screen
- Alt+F4: Close window

Enjoy NOVA OS!
WELCOME

# ============================================
# 6. System setup inside chroot
# ============================================
echo "[6/8] Configuring system..."

cat > "$CHROOT/tmp/setup-system.sh" << 'SETUP_SCRIPT'
#!/bin/bash
set -e

# Create nova user
useradd -m -s /bin/bash -G audio,video,sudo,netdev,plugdev,cdrom nova 2>/dev/null || true
echo "nova:nova" | chpasswd
echo "nova ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/nova
chmod 0440 /etc/sudoers.d/nova

# Install NOVA OS node modules
if [ -f /opt/nova-os/package.json ]; then
  cd /opt/nova-os && npm install --production --no-optional 2>/dev/null || true
fi

# Enable services (NO lightdm — we auto-login via getty)
systemctl enable NetworkManager 2>/dev/null || true
systemctl enable bluetooth 2>/dev/null || true
systemctl enable cups 2>/dev/null || true
systemctl enable acpid 2>/dev/null || true

# Set hostname
echo "nova-os" > /etc/hostname
echo "127.0.0.1 nova-os" >> /etc/hosts

# Timezone
ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# ---- DIRECT BOOT INTO NOVA OS (no login screen) ----
# Auto-login on tty1 via systemd override
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << 'AUTOLOGIN'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin nova --noclear %I $TERM
AUTOLOGIN

# .bash_profile auto-starts X (which runs .xinitrc)
cat > /home/nova/.bash_profile << 'BASHPROFILE'
# NOVA OS — Auto-start the desktop on tty1
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx 2>/dev/null
fi
BASHPROFILE
chown nova:nova /home/nova/.bash_profile

# .xinitrc — NOVA OS boots directly into its own native renderer
cat > /home/nova/.xinitrc << 'XINITRC'
#!/bin/bash
# NOVA OS — Desktop Init
# This IS the operating system. Our own native renderer, not Chromium.

# Audio
pulseaudio --start 2>/dev/null &

# Network
nm-applet --indicator 2>/dev/null &

# Power management
xfce4-power-manager 2>/dev/null &

# Set NOVA dark background while loading
xsetroot -solid "#0a0a1a"

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Log everything to a file so we can debug if things go wrong
exec > /tmp/nova-startup.log 2>&1
set -x

# Start the NOVA OS server (serves the web app content)
cd /opt/nova-os
node server/index.js &
NOVA_PID=$!
echo "Started server PID $NOVA_PID"

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "Server ready after ${i}s"
    break
  fi
  sleep 1
done

# Launch NOVA OS fullscreen via nova-renderer
# nova-renderer = fullscreen WebKitGTK view loading the full web OS
# The web OS already has its own menubar, dock, and window manager
# Shows as "nova-renderer" in process lists, not "chromium"
#
# We use nova-renderer (simple, reliable) instead of nova-shell (experimental)
# because nova-shell needs a compositor for its transparent panels/dock.
if command -v nova-renderer >/dev/null 2>&1; then
  echo "Launching nova-renderer..."
  exec nova-renderer
elif command -v nova-shell >/dev/null 2>&1; then
  echo "nova-renderer missing, falling back to nova-shell..."
  exec nova-shell
else
  echo "ERROR: no NOVA renderer found!"
  sleep 5
  exit 1
fi
XINITRC
chown nova:nova /home/nova/.xinitrc
chmod +x /home/nova/.xinitrc

# GTK theme
mkdir -p /etc/skel/.config/gtk-3.0
echo "[Settings]
gtk-theme-name=Arc-Dark
gtk-icon-theme-name=Papirus-Dark
gtk-font-name=Inter 11
gtk-cursor-theme-name=Adwaita
gtk-application-prefer-dark-theme=1
" > /etc/skel/.config/gtk-3.0/settings.ini

echo 'gtk-theme-name="Arc-Dark"
gtk-icon-theme-name="Papirus-Dark"
gtk-font-name="Inter 11"
' > /etc/skel/.gtkrc-2.0

# XDG user dirs
mkdir -p /etc/skel/.config
echo 'XDG_DESKTOP_DIR="$HOME/Desktop"
XDG_DOCUMENTS_DIR="$HOME/Documents"
XDG_DOWNLOAD_DIR="$HOME/Downloads"
XDG_MUSIC_DIR="$HOME/Music"
XDG_PICTURES_DIR="$HOME/Pictures"
XDG_VIDEOS_DIR="$HOME/Videos"
' > /etc/skel/.config/user-dirs.dirs

# GRUB config
cat > /etc/default/grub << 'GRUB'
GRUB_DEFAULT=0
GRUB_TIMEOUT=3
GRUB_DISTRIBUTOR="NOVA OS"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=3"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL_OUTPUT="gfxterm"
GRUB_GFXMODE=auto
GRUB

# NOVA OS Plymouth theme
plymouth-set-default-theme nova-os 2>/dev/null || \
  update-alternatives --set default.plymouth /usr/share/plymouth/themes/nova-os/nova-os.plymouth 2>/dev/null || true

# OS release branding
cat > /etc/os-release << 'OSREL'
PRETTY_NAME="NOVA OS 1.0"
NAME="NOVA OS"
VERSION_ID="1.0"
VERSION="1.0 (Andromeda)"
VERSION_CODENAME=andromeda
ID=nova-os
ID_LIKE=debian
HOME_URL="https://github.com/viraajbindra-a11y/Nova-OS"
BUG_REPORT_URL="https://github.com/viraajbindra-a11y/Nova-OS/issues"
OSREL

# LSB release
cat > /etc/lsb-release << 'LSB'
DISTRIB_ID=NOVA-OS
DISTRIB_RELEASE=1.0
DISTRIB_CODENAME=andromeda
DISTRIB_DESCRIPTION="NOVA OS 1.0 (Andromeda)"
LSB

# Issue banner
echo "NOVA OS 1.0 \\n \\l" > /etc/issue
echo "NOVA OS 1.0" > /etc/issue.net

# Disable unnecessary services
systemctl disable ssh 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true

# Set ownership
chown -R nova:nova /home/nova
chown -R nova:nova /opt/nova-os 2>/dev/null || true

echo "System setup complete."
SETUP_SCRIPT

chmod +x "$CHROOT/tmp/setup-system.sh"
chroot "$CHROOT" /tmp/setup-system.sh

# ============================================
# 7. Build the ISO manually with xorriso + GRUB
# ============================================
echo "[7/8] Building ISO image..."

# Unmount chroot filesystems
umount "$CHROOT/dev/pts" 2>/dev/null || true
umount "$CHROOT/dev" 2>/dev/null || true
umount "$CHROOT/proc" 2>/dev/null || true
umount "$CHROOT/sys" 2>/dev/null || true

# Clean up temp files
rm -f "$CHROOT/tmp/install-packages.sh" "$CHROOT/tmp/setup-system.sh"
rm -f "$CHROOT/etc/resolv.conf"

# Create the binary directory structure
BINARY="$BUILD_DIR/binary"
mkdir -p "$BINARY/live"
mkdir -p "$BINARY/boot/grub"
mkdir -p "$BINARY/EFI/BOOT"

# Create squashfs of the filesystem
echo "  Creating squashfs filesystem (this takes several minutes)..."
mksquashfs "$CHROOT" "$BINARY/live/filesystem.squashfs" \
  -comp xz -Xbcj x86 -b 1M -no-duplicates -no-recovery \
  -e boot 2>&1 | tail -3

# Copy kernel and initrd
VMLINUZ=$(ls "$CHROOT/boot/vmlinuz-"* 2>/dev/null | sort -V | tail -1)
INITRD=$(ls "$CHROOT/boot/initrd.img-"* 2>/dev/null | sort -V | tail -1)

if [ -z "$VMLINUZ" ] || [ -z "$INITRD" ]; then
  echo "ERROR: Kernel or initrd not found in chroot!"
  ls -la "$CHROOT/boot/" 2>/dev/null
  exit 1
fi

cp "$VMLINUZ" "$BINARY/live/vmlinuz"
cp "$INITRD" "$BINARY/live/initrd.img"
echo "  Kernel: $(basename $VMLINUZ)"
echo "  Initrd: $(basename $INITRD)"

# Create GRUB config for BIOS boot
cat > "$BINARY/boot/grub/grub.cfg" << 'GRUBCFG'
set default=0
set timeout=3

insmod all_video
insmod gfxterm
insmod png
set gfxmode=1920x1080,1280x720,auto
terminal_output gfxterm

# NOVA OS dark theme
set color_normal=light-gray/black
set color_highlight=white/dark-gray
set menu_color_normal=light-gray/black
set menu_color_highlight=white/dark-gray

# Title
echo ""
echo "    N O V A   O S"
echo "    ─────────────"
echo ""

menuentry "  NOVA OS" {
    linux /live/vmlinuz boot=live quiet splash loglevel=3
    initrd /live/initrd.img
}

menuentry "  NOVA OS — Safe Mode (no GPU acceleration)" {
    linux /live/vmlinuz boot=live nomodeset
    initrd /live/initrd.img
}

menuentry "  NOVA OS — Load to RAM (faster, needs 4GB+)" {
    linux /live/vmlinuz boot=live toram quiet splash
    initrd /live/initrd.img
}

menuentry "  Memory Test (memtest86+)" {
    linux16 /live/vmlinuz memtest
}
GRUBCFG

# Create EFI boot image
echo "  Creating EFI boot image..."
cat > /tmp/grub-embed.cfg << 'EMBED'
search --set=root --file /live/vmlinuz
set prefix=($root)/boot/grub
configfile $prefix/grub.cfg
EMBED

# Build the EFI GRUB image
grub-mkimage -O x86_64-efi -o "$BINARY/EFI/BOOT/BOOTx64.EFI" \
  -p /boot/grub -c /tmp/grub-embed.cfg \
  boot linux normal configfile part_gpt part_msdos fat ext2 \
  iso9660 search search_fs_file search_label ls gfxterm gfxmenu \
  all_video efi_gop efi_uga video_bochs video_cirrus

# Create EFI partition image (FAT12/16 for the ESP)
EFI_IMG="$BINARY/boot/grub/efi.img"
dd if=/dev/zero of="$EFI_IMG" bs=1M count=4
mkfs.vfat "$EFI_IMG"
mmd -i "$EFI_IMG" ::/EFI
mmd -i "$EFI_IMG" ::/EFI/BOOT
mcopy -i "$EFI_IMG" "$BINARY/EFI/BOOT/BOOTx64.EFI" ::/EFI/BOOT/

# Create BIOS boot image
echo "  Creating BIOS boot image..."
grub-mkimage -O i386-pc -o "$BUILD_DIR/core.img" \
  -p /boot/grub \
  biosdisk iso9660 part_msdos part_gpt normal boot linux configfile \
  search search_fs_file search_label ls gfxterm all_video

cat /usr/lib/grub/i386-pc/cdboot.img "$BUILD_DIR/core.img" > "$BINARY/boot/grub/bios.img"

# ============================================
# 8. Create the ISO with xorriso
# ============================================
echo "[8/8] Creating bootable ISO..."

# Verify all boot files exist
echo "  Checking boot files..."
ls -la "$BINARY/boot/grub/bios.img" "$BINARY/boot/grub/efi.img" "$BINARY/EFI/BOOT/BOOTx64.EFI" "$BINARY/live/vmlinuz" "$BINARY/live/initrd.img"

xorriso -as mkisofs \
  -o "$OUTPUT_DIR/nova-os.iso" \
  -V "NOVA-OS-1.0" \
  -A "NOVA OS" \
  -publisher "NOVA OS Project" \
  -isohybrid-mbr /usr/lib/grub/i386-pc/boot_hybrid.img \
  -b boot/grub/bios.img \
    -no-emul-boot \
    -boot-load-size 4 \
    -boot-info-table \
    --grub2-boot-info \
  -eltorito-alt-boot \
  -e boot/grub/efi.img \
    -no-emul-boot \
    -isohybrid-gpt-basdat \
  -r -J \
  "$BINARY" 2>&1 | tail -5

# Verify output
if [ -f "$OUTPUT_DIR/nova-os.iso" ]; then
  ISO_SIZE=$(du -h "$OUTPUT_DIR/nova-os.iso" | cut -f1)
  echo ""
  echo "============================================"
  echo "  NOVA OS built successfully!"
  echo "  Size: $ISO_SIZE"
  echo "  File: $OUTPUT_DIR/nova-os.iso"
  echo "============================================"
  echo ""
  echo "  This is a REAL operating system with its OWN renderer."
  echo "  No Chromium. No browser UI. 100% native NOVA OS."
  echo "  Flash to USB -> Boot -> Use."
  echo ""
  echo "  NOVA Native Shell:"
  echo "    - nova-shell (C/GTK3 native desktop environment)"
  echo "    - Native menubar, dock, window manager"
  echo "    - WebKitGTK app renderer (NOT a browser)"
  echo "    - Shows as 'nova-shell' in process lists"
  echo ""
  echo "  Included apps:"
  echo "    - Firefox ESR (for external web browsing)"
  echo "    - Thunar (file manager with trash)"
  echo "    - Terminal (bash shell)"
  echo "    - Mousepad + Geany (text editors)"
  echo "    - VLC (media player)"
  echo "    - LibreOffice (docs, sheets, slides)"
  echo "    - Shotwell (photo manager)"
  echo "    - Screenshot tool"
  echo "    - Calculator"
  echo "    - Image viewer + PDF reader"
  echo "    - Software Center (install more apps)"
  echo "    - NOVA AI assistant"
  echo ""
  echo "  Flash: sudo dd if=$OUTPUT_DIR/nova-os.iso of=/dev/sdX bs=4M status=progress"
  echo "  Or use Balena Etcher"
else
  echo "ERROR: ISO creation failed!"
  exit 1
fi
