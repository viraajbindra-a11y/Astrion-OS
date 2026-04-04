#!/bin/bash
# NOVA OS — Build Script
# Creates a bootable ISO with NOVA OS as a real Linux desktop environment.
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
  live-build debootstrap syslinux isolinux xorriso \
  squashfs-tools grub-pc-bin grub-efi-amd64-bin mtools dosfstools \
  debian-archive-keyring 2>/dev/null

# ============================================
# 2. Configure live-build
# ============================================
echo "[2/8] Configuring..."
# Symlink Debian keyring so debootstrap finds it
ln -sf /usr/share/keyrings/debian-archive-keyring.gpg /etc/apt/trusted.gpg.d/debian-archive-keyring.gpg 2>/dev/null || true

lb config \
  --mode debian \
  --distribution bookworm \
  --parent-distribution bookworm \
  --parent-mirror-bootstrap "http://deb.debian.org/debian" \
  --parent-mirror-chroot "http://deb.debian.org/debian" \
  --parent-mirror-chroot-security "http://security.debian.org/debian-security" \
  --mirror-bootstrap "http://deb.debian.org/debian" \
  --mirror-chroot "http://deb.debian.org/debian" \
  --mirror-chroot-security "http://security.debian.org/debian-security" \
  --mirror-binary "http://deb.debian.org/debian" \
  --mirror-binary-security "http://security.debian.org/debian-security" \
  --archive-areas "main contrib non-free non-free-firmware" \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --bootappend-live "boot=live quiet splash" \
  --debian-installer false \
  --memtest none \
  --iso-application "NOVA OS" \
  --iso-publisher "NOVA OS Project" \
  --iso-volume "NOVA-OS-1.0"

# ============================================
# 3. Package list — REAL applications
# ============================================
echo "[3/8] Setting up packages..."
cat > config/package-lists/nova.list.chroot << 'PACKAGES'
# === DISPLAY SERVER & WINDOW MANAGER ===
xorg
xinit
openbox
picom
hsetroot

# === NOVA DESKTOP SHELL ===
polybar
rofi
plank
dunst
feh
lxappearance

# === REAL BROWSER ===
chromium

# === REAL TERMINAL ===
xfce4-terminal

# === REAL FILE MANAGER ===
thunar
thunar-archive-plugin
tumbler

# === TEXT EDITOR ===
mousepad
geany

# === REAL APPS ===
xfce4-screenshooter
galculator
eog
vlc
evince
xarchiver
libreoffice-writer
libreoffice-calc
libreoffice-impress
shotwell
transmission-gtk
simple-scan
cheese

# === SYSTEM TOOLS ===
xfce4-power-manager
xfce4-settings
xfce4-taskmanager
gvfs
gvfs-backends
gvfs-fuse
udisks2
gparted
baobab
gnome-disk-utility
gnome-system-monitor
xfce4-notifyd
xdg-utils
xdg-user-dirs
dconf-cli
at-spi2-core

# === PRINTING ===
cups
cups-client
system-config-printer
printer-driver-all

# === BLUETOOTH ===
bluez
bluez-tools
blueman

# === AUDIO ===
pulseaudio
pulseaudio-module-bluetooth
pavucontrol
alsa-utils

# === NETWORKING ===
network-manager
network-manager-gnome
network-manager-openvpn
wpasupplicant
wireless-tools
firmware-iwlwifi
firmware-realtek
firmware-atheros
firmware-misc-nonfree
firmware-brcm80211

# === DRAG AND DROP / CLIPBOARD ===
xclip
xsel
xdotool

# === TRASH / FILE OPERATIONS ===
trash-cli
gvfs-backends

# === APPEARANCE ===
papirus-icon-theme
fonts-inter
fonts-noto
fonts-noto-color-emoji
fonts-noto-cjk
arc-theme
adwaita-icon-theme
gtk2-engines-murrine
qt5-style-plugins

# === DEVELOPMENT (for NOVA AI and apps) ===
nodejs
npm
git
curl
wget
python3
python3-pip

# === SYSTEM ===
sudo
dbus-x11
policykit-1
policykit-1-gnome
upower
acpi
acpid
unclutter
lightdm
lightdm-gtk-greeter
lightdm-gtk-greeter-settings
plymouth
plymouth-themes

# === APP INSTALLATION ===
flatpak
gnome-software
gnome-software-plugin-flatpak
software-properties-common
apt-transport-https

# === MULTIMEDIA CODECS ===
ffmpeg
gstreamer1.0-plugins-base
gstreamer1.0-plugins-good
gstreamer1.0-plugins-bad
gstreamer1.0-plugins-ugly
gstreamer1.0-libav

# === DISPLAY DRIVERS ===
xserver-xorg-video-intel
xserver-xorg-video-amdgpu
xserver-xorg-video-nouveau
mesa-utils
PACKAGES

# ============================================
# 4. Copy NOVA OS desktop environment files
# ============================================
echo "[4/8] Installing NOVA OS desktop..."
CHROOT="config/includes.chroot"

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

# NOVA AI server
mkdir -p "$CHROOT/opt/nova-os"
cp "$PROJECT_ROOT/index.html" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/css" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/js" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/server" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp "$PROJECT_ROOT/package.json" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/assets" "$CHROOT/opt/nova-os/" 2>/dev/null || true

# Wallpapers
mkdir -p "$CHROOT/usr/share/nova-os/wallpapers"
# Generate a default wallpaper with Python
cat > /tmp/gen-wallpaper.py << 'PYGEN'
from PIL import Image, ImageDraw
img = Image.new('RGB', (3840, 2160), (26, 26, 46))
draw = ImageDraw.Draw(img)
for y in range(2160):
    for x in range(0, 3840, 4):
        r = int(26 + y * 15 / 2160 + x * 8 / 3840)
        g = int(20 + y * 10 / 2160)
        b = int(46 + y * 25 / 2160 + x * 12 / 3840)
        draw.rectangle([x, y, x+3, y], fill=(r, g, b))
img.save('/tmp/nova-wallpaper.png')
print("Wallpaper generated")
PYGEN
python3 /tmp/gen-wallpaper.py 2>/dev/null && cp /tmp/nova-wallpaper.png "$CHROOT/usr/share/nova-os/wallpapers/default.png" || echo "Wallpaper generation skipped (PIL not available)"

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

# Plank dock config — all real apps
mkdir -p "$CHROOT/etc/skel/.config/plank/dock1/launchers"
for app in chromium thunar xfce4-terminal mousepad vlc shotwell galculator gnome-software; do
  cat > "$CHROOT/etc/skel/.config/plank/dock1/launchers/${app}.dockitem" << DOCKITEM
[PlankDockItemPreferences]
Launcher=file:///usr/share/applications/${app}.desktop
DOCKITEM
done

# Plank dock settings
cat > "$CHROOT/etc/skel/.config/plank/dock1/settings" << 'PLANKCFG'
[PlankDockPreferences]
Alignment=3
IconSize=48
HideMode=3
Position=3
Theme=Transparent
ZoomEnabled=true
ZoomPercent=130
PLANKCFG

# Desktop shortcuts for quick access
mkdir -p "$CHROOT/etc/skel/Desktop"

# Create XDG user dirs
mkdir -p "$CHROOT/etc/skel/Documents"
mkdir -p "$CHROOT/etc/skel/Downloads"
mkdir -p "$CHROOT/etc/skel/Pictures"
mkdir -p "$CHROOT/etc/skel/Music"
mkdir -p "$CHROOT/etc/skel/Videos"
mkdir -p "$CHROOT/etc/skel/.local/share/Trash/files"
mkdir -p "$CHROOT/etc/skel/.local/share/Trash/info"

# Welcome file on desktop
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
- Ctrl+Left/Right: Switch desktops

AI:
- NOVA AI assistant is built into the system
- Open the NOVA web app for AI features

Enjoy NOVA OS!
WELCOME

# ============================================
# 5. LightDM config (login screen)
# ============================================
echo "[5/8] Configuring login screen..."
mkdir -p "$CHROOT/etc/lightdm"
cat > "$CHROOT/etc/lightdm/lightdm.conf" << 'LDM'
[Seat:*]
autologin-user=nova
autologin-session=NOVA OS
user-session=NOVA OS
greeter-session=lightdm-gtk-greeter
LDM

cat > "$CHROOT/etc/lightdm/lightdm-gtk-greeter.conf" << 'GREETER'
[greeter]
theme-name = Arc-Dark
icon-theme-name = Papirus-Dark
font-name = Inter 11
background = #1a1a2e
indicators = ~host;~spacer;~clock;~spacer;~session;~power
GREETER

# ============================================
# 6. System setup hook
# ============================================
echo "[6/8] Creating system hooks..."
mkdir -p config/hooks/normal

cat > config/hooks/normal/0100-nova-setup.hook.chroot << 'HOOK'
#!/bin/bash
set -e

# Create nova user
useradd -m -s /bin/bash -G audio,video,sudo,netdev,plugdev,cdrom nova 2>/dev/null || true
echo "nova:nova" | chpasswd
echo "nova ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/nova
chmod 0440 /etc/sudoers.d/nova

# Set NOVA as default session
mkdir -p /home/nova/.config/openbox
ln -sf /etc/nova-os/openbox/rc.xml /home/nova/.config/openbox/rc.xml

# Install NOVA OS node modules
if [ -f /opt/nova-os/package.json ]; then
  cd /opt/nova-os && npm install --production --no-optional 2>/dev/null || true
fi

# Enable services
systemctl enable lightdm 2>/dev/null || true
systemctl enable NetworkManager 2>/dev/null || true
systemctl enable bluetooth 2>/dev/null || true
systemctl enable cups 2>/dev/null || true
systemctl enable acpid 2>/dev/null || true

# Add Flathub for flatpak apps
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo 2>/dev/null || true

# Set hostname
echo "nova-os" > /etc/hostname
echo "127.0.0.1 nova-os" >> /etc/hosts

# Set timezone
ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# Set default apps
update-alternatives --set x-terminal-emulator /usr/bin/xfce4-terminal.wrapper 2>/dev/null || true
update-alternatives --set x-www-browser /usr/bin/chromium 2>/dev/null || true

# Set Chromium as default browser
mkdir -p /etc/skel/.config
echo "[Default Applications]
text/html=chromium.desktop
x-scheme-handler/http=chromium.desktop
x-scheme-handler/https=chromium.desktop
application/xhtml+xml=chromium.desktop
" > /etc/skel/.config/mimeapps.list

# GTK theme settings
mkdir -p /etc/skel/.config/gtk-3.0
echo "[Settings]
gtk-theme-name=Arc-Dark
gtk-icon-theme-name=Papirus-Dark
gtk-font-name=Inter 11
gtk-cursor-theme-name=Adwaita
gtk-application-prefer-dark-theme=1
" > /etc/skel/.config/gtk-3.0/settings.ini

# GTK2
echo 'gtk-theme-name="Arc-Dark"
gtk-icon-theme-name="Papirus-Dark"
gtk-font-name="Inter 11"
' > /etc/skel/.gtkrc-2.0

# XDG user dirs
echo 'XDG_DESKTOP_DIR="$HOME/Desktop"
XDG_DOCUMENTS_DIR="$HOME/Documents"
XDG_DOWNLOAD_DIR="$HOME/Downloads"
XDG_MUSIC_DIR="$HOME/Music"
XDG_PICTURES_DIR="$HOME/Pictures"
XDG_VIDEOS_DIR="$HOME/Videos"
' > /etc/skel/.config/user-dirs.dirs

# Disable unnecessary services
systemctl disable ssh 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true

# Set correct ownership
chown -R nova:nova /home/nova
chown -R nova:nova /opt/nova-os 2>/dev/null || true

echo "NOVA OS setup complete."
HOOK
chmod +x config/hooks/normal/0100-nova-setup.hook.chroot

# ============================================
# 7. GRUB config
# ============================================
echo "[7/8] Configuring bootloader..."
CHROOT="config/includes.chroot"
mkdir -p "$CHROOT/etc/default"
cat > "$CHROOT/etc/default/grub" << 'GRUB'
GRUB_DEFAULT=0
GRUB_TIMEOUT=3
GRUB_DISTRIBUTOR="NOVA OS"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=3"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL_OUTPUT="gfxterm"
GRUB_GFXMODE=auto
GRUB

# ============================================
# 8. Build the ISO
# ============================================
echo "[8/8] Building ISO (this takes 15-30 minutes)..."
lb build 2>&1 | tail -20

# Move output
if ls *.hybrid.iso 1>/dev/null 2>&1 || ls *.iso 1>/dev/null 2>&1; then
  mv *.iso "$OUTPUT_DIR/nova-os.iso" 2>/dev/null || mv *.hybrid.iso "$OUTPUT_DIR/nova-os.iso" 2>/dev/null
  ISO_SIZE=$(du -h "$OUTPUT_DIR/nova-os.iso" | cut -f1)
  echo ""
  echo "============================================"
  echo "  NOVA OS built successfully!"
  echo "  Size: $ISO_SIZE"
  echo "  File: $OUTPUT_DIR/nova-os.iso"
  echo "============================================"
  echo ""
  echo "  This is a REAL operating system."
  echo "  Flash to USB → Boot → Use."
  echo ""
  echo "  Included apps:"
  echo "    - Chromium (full browser)"
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
  echo "    - Bluetooth manager"
  echo "    - Printer setup"
  echo "    - System monitor"
  echo "    - NOVA AI assistant"
  echo "    - NOVA dock + menubar"
  echo ""
  echo "  Flash: sudo dd if=$OUTPUT_DIR/nova-os.iso of=/dev/sdX bs=4M status=progress"
  echo "  Or use Balena Etcher"
else
  echo "ERROR: Build failed"
  exit 1
fi
