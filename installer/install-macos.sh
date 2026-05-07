#!/usr/bin/env bash
# ZK-Bridge — macOS installer.

set -euo pipefail

NODE_REQ_MAJOR=20
PKG="@hanoilab/zk-bridge"

log() { printf "\033[1;34m[zkb-install]\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m[zkb-install]\033[0m %s\n" "$*" >&2; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed. Try: brew install node"
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "${NODE_MAJOR}" -lt "${NODE_REQ_MAJOR}" ]; then
  fail "node ${NODE_MAJOR} too old. Need >= ${NODE_REQ_MAJOR}."
fi
log "node $(node -v) OK."

log "Installing ${PKG} from npm ..."
npm install -g "${PKG}"

PORT="${PORT:-7000}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
log "Starting bridge on http://${BIND_HOST}:${PORT} — Ctrl+C to stop."
log "Toggle 'Auto-start on boot' in the UI to install the launchd plist."
PORT="${PORT}" BIND_HOST="${BIND_HOST}" zk-bridge start
