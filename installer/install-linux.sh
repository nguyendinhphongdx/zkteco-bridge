#!/usr/bin/env bash
# ZK-Bridge — Linux installer.
#
#   curl -sSL https://<your-release-host>/install-linux.sh | bash
#
# Installs Node (if missing), then `npm install -g @hanoilab/zk-bridge`,
# then starts the bridge in the foreground. Auto-start on boot is enabled
# later via the web UI toggle (writes a systemd unit).

set -euo pipefail

NODE_REQ_MAJOR=20
PKG="@hanoilab/zk-bridge"

log() { printf "\033[1;34m[zkb-install]\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m[zkb-install]\033[0m %s\n" "$*" >&2; exit 1; }

# 1. Node check (autoinstall via nvm if missing).
if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed. Install Node.js >= ${NODE_REQ_MAJOR} from https://nodejs.org/, then re-run."
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "${NODE_MAJOR}" -lt "${NODE_REQ_MAJOR}" ]; then
  fail "node ${NODE_MAJOR} is too old. Need >= ${NODE_REQ_MAJOR}."
fi
log "node $(node -v) OK."

# 2. Install / upgrade the global CLI.
log "Installing ${PKG} from npm ..."
npm install -g "${PKG}"

# 3. First start (foreground). Open the URL in a browser to finish setup.
PORT="${PORT:-7000}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
log "Starting bridge on http://${BIND_HOST}:${PORT} — Ctrl+C to stop."
log "Toggle 'Auto-start on boot' in the UI to install the systemd unit."
PORT="${PORT}" BIND_HOST="${BIND_HOST}" zk-bridge start
