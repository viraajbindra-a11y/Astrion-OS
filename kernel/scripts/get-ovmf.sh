#!/usr/bin/env bash
# Download upstream EDK2 nightly OVMF firmware for QEMU testing.
#
# Background (2026-05-26): the Homebrew QEMU 11.0 bundle at
# /opt/homebrew/share/qemu/edk2-x86_64-code.fd hits a #GP in
# BootScriptExecutorDxe when our bootloader calls LocateHandleBuffer.
# Retrage's upstream EDK2 nightly build does not have that bug.
#
# Usage:
#   ./kernel/scripts/get-ovmf.sh
#
# Writes:
#   kernel/firmware/RELEASEX64_OVMF.fd   (4MB flat firmware, use with -bios)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIRMWARE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/firmware"
mkdir -p "$FIRMWARE_DIR"

URL="https://retrage.github.io/edk2-nightly/bin/RELEASEX64_OVMF.fd"
OUT="$FIRMWARE_DIR/RELEASEX64_OVMF.fd"

if [ -f "$OUT" ]; then
    SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 1000000 ]; then
        echo "OVMF already present: $OUT ($SIZE bytes)"
        exit 0
    fi
fi

echo "Downloading retrage EDK2 nightly OVMF -> $OUT"
curl -sSL -o "$OUT" "$URL"

SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 1000000 ]; then
    echo "ERROR: download too small ($SIZE bytes). Check URL: $URL"
    rm -f "$OUT"
    exit 1
fi

echo "OK: $OUT ($SIZE bytes)"
