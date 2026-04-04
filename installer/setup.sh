#!/bin/bash
# NOVA OS Installer — Setup Script
# Run this before building the Electron app.
# It copies the web OS files into the installer's app/ directory.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$SCRIPT_DIR/app"

echo "NOVA OS Installer Setup"
echo "======================="

# Clean and create app directory
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

# Copy web OS files
echo "Copying NOVA OS files..."
cp "$PROJECT_ROOT/index.html" "$APP_DIR/"
cp -r "$PROJECT_ROOT/css" "$APP_DIR/"
cp -r "$PROJECT_ROOT/js" "$APP_DIR/"
[ -d "$PROJECT_ROOT/assets" ] && cp -r "$PROJECT_ROOT/assets" "$APP_DIR/"

echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

echo ""
echo "Setup complete! Now run:"
echo "  npm start        — to test locally"
echo "  npm run build     — to build for all platforms"
echo "  npm run build:mac — to build for macOS only"
echo "  npm run build:win — to build for Windows only"
