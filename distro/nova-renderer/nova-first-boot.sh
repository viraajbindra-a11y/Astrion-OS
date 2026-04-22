#!/bin/bash
# Astrion OS — First-Boot Install Prompt (M0.P4)
#
# Runs from .xinitrc BEFORE nova-shell starts. Detects whether we're
# running from the live ISO (not installed), and if so shows a zenity
# dialog asking the user if they want to install to disk.
#
# Three choices:
#   1) Install now           → runs `sudo nova-install` in xterm
#   2) Try it first          → skips install, continues to nova-shell,
#                              but doesn't set the "don't ask" flag
#   3) Never ask again       → writes a flag file so this script no-ops
#                              on future boots (useful for test VMs)
#
# The script is idempotent: if the user picks "never ask", or if we're
# already installed (not live), it exits immediately so nova-shell
# starts without delay.

FLAG_DIR="$HOME/.config/astrion"
NEVER_ASK_FLAG="$FLAG_DIR/never-ask-install"

# Fast exit: not running live → nothing to do
if ! grep -q "boot=live" /proc/cmdline 2>/dev/null; then
    exit 0
fi

# Fast exit: user previously said "never ask"
if [ -f "$NEVER_ASK_FLAG" ]; then
    exit 0
fi

# Ensure config dir exists
mkdir -p "$FLAG_DIR"

# zenity is the dialog tool. If it's missing, fall back to auto-skip so
# we don't block boot forever.
if ! command -v zenity >/dev/null 2>&1; then
    echo "nova-first-boot: zenity not installed, skipping install prompt"
    exit 0
fi

# Show the welcome dialog with an 8-second auto-dismiss to "Try it first".
# Reasoning: demos + casual USB boots shouldn't block on a modal.
# The "Install to Disk" option is still there for users who want it;
# they just have to click within 8 seconds. Anyone who ignores the
# prompt gets the "try it first" path by default (no install, no
# never-ask flag, dialog returns on next live boot).
#
# --timeout=8 causes zenity to auto-close with exit code 5 (treated
# same as Cancel/"Try it first" below — no action taken).
CHOICE=$(zenity --question \
    --title="Welcome to Astrion OS" \
    --width=520 \
    --timeout=8 \
    --ok-label="Install to Disk" \
    --cancel-label="Try it first" \
    --extra-button="Never ask again" \
    --text="<span font_size='x-large' weight='bold'>Welcome to Astrion OS</span>

You're running Astrion OS from a live USB. Changes you make now
will NOT be saved when you reboot.

<b>Install Astrion to your disk</b> so you can keep your settings,
files, and installed apps. The installer takes about 5 minutes
and requires an empty disk (or one you can wipe).

<i>You can also try Astrion first without installing — changes
just won't persist. Or pick 'Never ask again' to skip this
prompt on future live boots.</i>

<small>This dialog auto-dismisses in 8 seconds with 'Try it first'.</small>" \
    2>&1)

RETCODE=$?
# Exit code 5 = timeout (zenity auto-closed). Treat same as "Try it first".
if [ "$RETCODE" -eq 5 ]; then
    RETCODE=1
    CHOICE=""
fi

# Zenity exit codes:
#   0 — OK button (Install to Disk)
#   1 — Cancel button (Try it first) OR extra button (Never ask again)
# We distinguish by checking stdout for the extra-button label.

if [ "$RETCODE" -eq 0 ]; then
    # Install now — spawn xterm running nova-install as root
    if command -v xterm >/dev/null 2>&1; then
        xterm -fa 'Monospace' -fs 14 -bg black -fg white \
              -title "Astrion OS Installer" \
              -e "sudo nova-install" &
        INSTALL_PID=$!
        # Wait for installer to finish — this keeps nova-shell from
        # starting and racing with the installer for the screen.
        wait "$INSTALL_PID" 2>/dev/null
    else
        # No xterm — show an error and continue
        zenity --error --title="Cannot install" \
            --text="xterm is not installed. You can install manually from a terminal:\n\n    sudo nova-install"
    fi
elif echo "$CHOICE" | grep -q "Never ask again"; then
    touch "$NEVER_ASK_FLAG"
    zenity --info --title="Astrion OS" --width=360 \
        --text="Got it. I won't ask again on this live USB." &
    sleep 0.5
fi

# In all cases, continue to nova-shell after this script exits
exit 0
