#!/bin/bash
# NOVA OS — Bootable ISO Builder
#
# Creates a bootable ISO that runs NOVA OS on real hardware.
# Uses a minimal Debian base but NOVA OS is the ONLY interface.
# No terminal, no login prompt, no desktop environment — just NOVA OS.
#
# Requirements: Debian/Ubuntu with live-build, debootstrap, xorriso
# Run: sudo bash build.sh

set -e

echo "==========================================="
echo "  NOVA OS — Building Bootable ISO"
echo "==========================================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$SCRIPT_DIR/build"
OUTPUT_DIR="$SCRIPT_DIR/output"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR"
cd "$BUILD_DIR"

# ============================================
# STEP 1: Install build tools
# ============================================
echo "[1/7] Installing build dependencies..."
apt-get update -qq
apt-get install -y -qq \
  live-build debootstrap syslinux isolinux xorriso \
  squashfs-tools grub-pc-bin grub-efi-amd64-bin mtools dosfstools 2>/dev/null

# ============================================
# STEP 2: Configure live-build
# ============================================
echo "[2/7] Configuring live system..."
lb config \
  --distribution bookworm \
  --archive-areas "main contrib non-free non-free-firmware" \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --bootappend-live "boot=live quiet splash noautologin" \
  --debian-installer false \
  --memtest none \
  --iso-application "NOVA OS" \
  --iso-publisher "NOVA OS Project" \
  --iso-volume "NOVA-OS" \
  --image-name "nova-os"

# ============================================
# STEP 3: Define packages
# ============================================
echo "[3/7] Configuring packages..."
cat > config/package-lists/nova.list.chroot << 'PACKAGES'
# Minimal X11
xserver-xorg-core
xserver-xorg-input-all
xserver-xorg-video-all
xinit
openbox

# Chromium browser (renders NOVA OS)
chromium
chromium-sandbox

# Audio
pulseaudio
alsa-utils
alsa-oss

# Networking
network-manager
wpasupplicant
wireless-tools
firmware-iwlwifi
firmware-realtek
firmware-atheros
firmware-misc-nonfree

# Node.js (runs the local NOVA OS server)
nodejs
npm

# System
sudo
dbus-x11
policykit-1
upower
acpi
unclutter
PACKAGES

# ============================================
# STEP 4: Copy NOVA OS into the live system
# ============================================
echo "[4/7] Embedding NOVA OS..."
CHROOT="config/includes.chroot"

# Copy NOVA OS web app
mkdir -p "$CHROOT/opt/nova-os"
cp "$PROJECT_ROOT/index.html" "$CHROOT/opt/nova-os/"
cp -r "$PROJECT_ROOT/css" "$CHROOT/opt/nova-os/"
cp -r "$PROJECT_ROOT/js" "$CHROOT/opt/nova-os/"
cp "$PROJECT_ROOT/package.json" "$CHROOT/opt/nova-os/"
cp "$PROJECT_ROOT/package-lock.json" "$CHROOT/opt/nova-os/" 2>/dev/null || true
cp -r "$PROJECT_ROOT/server" "$CHROOT/opt/nova-os/"
[ -d "$PROJECT_ROOT/assets" ] && cp -r "$PROJECT_ROOT/assets" "$CHROOT/opt/nova-os/"

# ============================================
# STEP 5: Create boot scripts
# ============================================
echo "[5/7] Creating boot configuration..."

# The session script — this is what runs when the system boots
mkdir -p "$CHROOT/usr/local/bin"
cat > "$CHROOT/usr/local/bin/nova-session" << 'SCRIPT'
#!/bin/bash
export HOME=/home/nova
export DISPLAY=:0

# Start PulseAudio for sound
pulseaudio --start --exit-idle-time=-1 2>/dev/null &

# Install Node dependencies on first boot
if [ ! -d /opt/nova-os/node_modules ]; then
  echo "First boot — installing dependencies..."
  cd /opt/nova-os && npm install --production --no-optional 2>/dev/null
fi

# Start NOVA OS server
cd /opt/nova-os
node server/index.js &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  curl -s http://localhost:3000 > /dev/null 2>&1 && break
  sleep 0.5
done

# Get screen resolution
RESOLUTION=$(xdpyinfo 2>/dev/null | awk '/dimensions/{print $2}' || echo "1920x1080")

# Launch Chromium in kiosk mode (fullscreen, no UI chrome)
chromium \
  --no-first-run \
  --no-default-browser-check \
  --disable-translate \
  --disable-infobars \
  --disable-suggestions-ui \
  --disable-save-password-bubble \
  --disable-session-crashed-bubble \
  --disable-component-update \
  --disable-background-networking \
  --disable-sync \
  --noerrdialogs \
  --kiosk \
  --window-size=${RESOLUTION/x/,} \
  --app=http://localhost:3000 \
  --user-data-dir=/home/nova/.nova-chromium \
  2>/dev/null

# If Chromium exits, restart it
kill $SERVER_PID 2>/dev/null
exec /usr/local/bin/nova-session
SCRIPT
chmod +x "$CHROOT/usr/local/bin/nova-session"

# Openbox autostart — runs nova-session when X starts
mkdir -p "$CHROOT/etc/xdg/openbox"
cat > "$CHROOT/etc/xdg/openbox/autostart" << 'AUTOSTART'
# Disable screensaver and power management
xset s off &
xset -dpms &
xset s noblank &

# Hide mouse cursor when idle
unclutter -idle 3 -root &

# Set dark background (shown briefly before NOVA loads)
xsetroot -solid "#0a0a1e" &

# Launch NOVA OS
exec /usr/local/bin/nova-session
AUTOSTART

# X startup
mkdir -p "$CHROOT/home/nova"
cat > "$CHROOT/home/nova/.xinitrc" << 'XINITRC'
exec openbox-session
XINITRC

# Auto-login and auto-start X on tty1
mkdir -p "$CHROOT/etc/systemd/system/getty@tty1.service.d"
cat > "$CHROOT/etc/systemd/system/getty@tty1.service.d/autologin.conf" << 'GETTY'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin nova --noclear %I $TERM
Type=simple
GETTY

# Auto-start X when nova logs in
mkdir -p "$CHROOT/home/nova"
cat > "$CHROOT/home/nova/.bash_profile" << 'PROFILE'
# Auto-start X if not already running
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  exec startx -- -keeptty > /dev/null 2>&1
fi
PROFILE

# GRUB splash configuration
mkdir -p "$CHROOT/etc/default"
cat > "$CHROOT/etc/default/grub" << 'GRUB'
GRUB_DEFAULT=0
GRUB_TIMEOUT=2
GRUB_DISTRIBUTOR="NOVA OS"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash loglevel=0 vt.global_cursor_default=0"
GRUB_CMDLINE_LINUX=""
GRUB_TERMINAL_OUTPUT="gfxterm"
GRUB_GFXMODE=auto
GRUB

# Plymouth boot splash (NOVA branded)
mkdir -p "$CHROOT/usr/share/plymouth/themes/nova"
cat > "$CHROOT/usr/share/plymouth/themes/nova/nova.plymouth" << 'PLYMOUTH'
[Plymouth Theme]
Name=NOVA OS
Description=NOVA OS Boot Screen
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/nova
ScriptFile=/usr/share/plymouth/themes/nova/nova.script
PLYMOUTH

cat > "$CHROOT/usr/share/plymouth/themes/nova/nova.script" << 'PLYSCRIPT'
Window.SetBackgroundTopColor(0.04, 0.04, 0.12);
Window.SetBackgroundBottomColor(0.04, 0.04, 0.12);
PLYSCRIPT

# ============================================
# STEP 6: Setup hooks (run during build)
# ============================================
echo "[6/7] Setting up system hooks..."
mkdir -p config/hooks/normal

cat > config/hooks/normal/0100-nova-setup.hook.chroot << 'HOOK'
#!/bin/bash
set -e

# Create nova user (no password — auto-login)
useradd -m -s /bin/bash -G audio,video,sudo,netdev,plugdev nova 2>/dev/null || true
echo "nova ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/nova

# Install node modules for NOVA OS
cd /opt/nova-os
npm install --production --no-optional 2>/dev/null || true

# Set correct ownership
chown -R nova:nova /home/nova
chown -R nova:nova /opt/nova-os

# Enable NetworkManager
systemctl enable NetworkManager 2>/dev/null || true

# Disable unnecessary services for faster boot
systemctl disable ssh 2>/dev/null || true
systemctl disable apache2 2>/dev/null || true
systemctl disable cups 2>/dev/null || true

# Set hostname
echo "nova-os" > /etc/hostname

# Set timezone
ln -sf /usr/share/zoneinfo/UTC /etc/localtime 2>/dev/null || true
HOOK
chmod +x config/hooks/normal/0100-nova-setup.hook.chroot

# ============================================
# STEP 7: Build the ISO
# ============================================
echo "[7/7] Building ISO (this takes 10-20 minutes)..."
lb build 2>&1 | tail -20

# Move output
if ls *.iso 1>/dev/null 2>&1; then
  mv *.iso "$OUTPUT_DIR/nova-os.iso"
  ISO_SIZE=$(du -h "$OUTPUT_DIR/nova-os.iso" | cut -f1)
  echo ""
  echo "==========================================="
  echo "  NOVA OS ISO built successfully!"
  echo "  Size: $ISO_SIZE"
  echo "  File: $OUTPUT_DIR/nova-os.iso"
  echo "==========================================="
  echo ""
  echo "To use:"
  echo "  1. Flash to USB:  sudo dd if=$OUTPUT_DIR/nova-os.iso of=/dev/sdX bs=4M status=progress"
  echo "     Or use Balena Etcher (https://etcher.balena.io)"
  echo "  2. Boot from USB on any PC"
  echo "  3. NOVA OS starts automatically — no login, no setup"
  echo ""
  echo "  Supports: UEFI and Legacy BIOS boot"
  echo "  Requirements: 2GB RAM, x86_64 CPU"
else
  echo "ERROR: ISO build failed. Check logs above."
  exit 1
fi
