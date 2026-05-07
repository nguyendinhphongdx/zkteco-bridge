#!/usr/bin/env bash
# C-HR ZK-Bridge — Linux installer.
#
# Run on the LAN machine that can reach the ZKTeco device. Requires sudo for
# the systemd auto-start install (offered later via the UI; not done here).
#
#   curl -sSL https://<release-host>/install-linux.sh | bash
#
# Or after manual checkout:
#   ./installer/install-linux.sh
#
# Idempotent: re-running rebuilds + restarts only if a previous install exists.

set -euo pipefail

REPO_URL="${ZKB_REPO_URL:-https://github.com/your-org/c-hr.git}"
INSTALL_DIR="${ZKB_INSTALL_DIR:-$HOME/c-hr}"
NODE_REQ_MAJOR=20

log() { printf "\033[1;34m[zkb-install]\033[0m %s\n" "$*"; }
fail() { printf "\033[1;31m[zkb-install]\033[0m %s\n" "$*" >&2; exit 1; }

# 1. Node check.
if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed. Install Node.js >= ${NODE_REQ_MAJOR} first (https://nodejs.org/)."
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "${NODE_MAJOR}" -lt "${NODE_REQ_MAJOR}" ]; then
  fail "node ${NODE_MAJOR} is too old. Need >= ${NODE_REQ_MAJOR}."
fi
log "node $(node -v) OK."

# 2. pnpm.
if ! command -v pnpm >/dev/null 2>&1; then
  log "Installing pnpm via corepack ..."
  corepack enable
  corepack prepare pnpm@latest --activate
fi

# 3. Source.
if [ -d "${INSTALL_DIR}/.git" ]; then
  log "Updating ${INSTALL_DIR} ..."
  git -C "${INSTALL_DIR}" pull --ff-only
else
  log "Cloning to ${INSTALL_DIR} ..."
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}/services/zk-bridge"

# 4. Deps + build.
log "Installing dependencies ..."
pnpm install --filter @c-hr/zk-bridge
log "Building ..."
pnpm --filter @c-hr/zk-bridge build

# 5. First start (foreground). Customer admin then opens the UI to register
#    auto-start through /config/system. Use Ctrl+C to stop.
PORT="${PORT:-7000}"
BIND_HOST="${BIND_HOST:-127.0.0.1}"
log "Starting ZK-Bridge on http://${BIND_HOST}:${PORT} ..."
log "Open the URL in a browser to finish setup."
PORT="${PORT}" BIND_HOST="${BIND_HOST}" node dist/index.js
