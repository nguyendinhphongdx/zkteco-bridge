#!/usr/bin/env bash
# C-HR ZK-Bridge — macOS installer. See install-linux.sh for the equivalent
# behavior — this script is a thin variant that uses launchctl for auto-start
# (offered later via the UI).

set -euo pipefail

REPO_URL="${ZKB_REPO_URL:-https://github.com/your-org/c-hr.git}"
INSTALL_DIR="${ZKB_INSTALL_DIR:-$HOME/c-hr}"
NODE_REQ_MAJOR=20

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

if ! command -v pnpm >/dev/null 2>&1; then
  log "Installing pnpm via corepack ..."
  corepack enable
  corepack prepare pnpm@latest --activate
fi

if [ -d "${INSTALL_DIR}/.git" ]; then
  log "Updating ${INSTALL_DIR} ..."
  git -C "${INSTALL_DIR}" pull --ff-only
else
  log "Cloning to ${INSTALL_DIR} ..."
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}/services/zk-bridge"

log "Installing dependencies ..."
pnpm install --filter @c-hr/zk-bridge
log "Building ..."
pnpm --filter @c-hr/zk-bridge build

PORT="${PORT:-7000}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
log "Starting ZK-Bridge on http://${BIND_HOST}:${PORT} ..."
log "Open the URL in a browser to finish setup."
PORT="${PORT}" BIND_HOST="${BIND_HOST}" node dist/index.js
