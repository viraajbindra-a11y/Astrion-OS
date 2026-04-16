#!/bin/bash
# NOVA OS — Startup Script
# Called from .xinitrc after X starts.
# Starts the NOVA server, waits for it, then launches the native renderer.

# Set environment
export XDG_CURRENT_DESKTOP=NOVA
export XDG_SESSION_DESKTOP=NOVA
export DESKTOP_SESSION=nova

# Audio
pulseaudio --start 2>/dev/null &

# Network — ensure NetworkManager is running for WiFi
sudo systemctl start NetworkManager 2>/dev/null || sudo service NetworkManager start 2>/dev/null || true
sleep 1
nm-applet --indicator 2>/dev/null &

# Power management
xfce4-power-manager 2>/dev/null &

# Set NOVA dark background while loading
xsetroot -solid "#0a0a1a"

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Start the NOVA OS server
cd /opt/nova-os
node server/index.js &
NOVA_SERVER_PID=$!

# Wait for server to be ready (up to 30 seconds)
echo "[NOVA OS] Waiting for server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "[NOVA OS] Server ready!"
    break
  fi
  sleep 1
done

# Launch the NOVA renderer — this IS the desktop
exec nova-renderer 2>/dev/null
