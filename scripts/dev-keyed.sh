#!/usr/bin/env bash
# Start the Astrion server with .env loaded.
# Usage: ./scripts/dev-keyed.sh   OR   npm run dev:keyed
#
# Reads .env (gitignored) and exports every KEY=VALUE before launching
# `node server/index.js`. Refuses to start if ANTHROPIC_API_KEY is empty.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

# Source .env, ignoring blank lines and comments
set -a
# shellcheck disable=SC1091
source <(grep -v '^[[:space:]]*#' .env | grep -v '^[[:space:]]*$')
set +a

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ERROR: ANTHROPIC_API_KEY is empty in .env. Phase 0 soak needs a real key." >&2
  exit 1
fi

# Mask all but the last 4 chars in the log line — verifies the key is set
# without spilling it in shell history / scrollback.
KEY_PREVIEW="…${ANTHROPIC_API_KEY: -4}"
echo "[dev-keyed] ANTHROPIC_API_KEY loaded ($KEY_PREVIEW)"
echo "[dev-keyed] Starting server on http://localhost:3000"
echo ""

exec node server/index.js
