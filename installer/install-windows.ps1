# C-HR ZK-Bridge - Windows installer.
#
# Run from PowerShell (admin only required if you also want auto-start).
#
#   iwr -useb https://<release-host>/install-windows.ps1 | iex
#
# Or after manual checkout:
#   .\installer\install-windows.ps1

$ErrorActionPreference = 'Stop'

$RepoUrl = if ($env:ZKB_REPO_URL) { $env:ZKB_REPO_URL } else { 'https://github.com/your-org/c-hr.git' }
$InstallDir = if ($env:ZKB_INSTALL_DIR) { $env:ZKB_INSTALL_DIR } else { Join-Path $HOME 'c-hr' }
$NodeReqMajor = 20

function Log($msg) { Write-Host "[zkb-install] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[zkb-install] $msg" -ForegroundColor Red; exit 1 }

# 1. Node check.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js is not installed. Install Node >= $NodeReqMajor from https://nodejs.org/" }
$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $NodeReqMajor) { Fail "Node $nodeMajor is too old. Need >= $NodeReqMajor." }
Log "node $(& node -v) OK."

# 2. pnpm via corepack.
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Log 'Installing pnpm via corepack ...'
  corepack enable
  corepack prepare pnpm@latest --activate
}

# 3. Source.
if (Test-Path (Join-Path $InstallDir '.git')) {
  Log "Updating $InstallDir ..."
  git -C $InstallDir pull --ff-only
} else {
  Log "Cloning to $InstallDir ..."
  git clone $RepoUrl $InstallDir
}

Set-Location (Join-Path $InstallDir 'services\zk-bridge')

# 4. Deps + build.
Log 'Installing dependencies ...'
pnpm install --filter '@c-hr/zk-bridge'
Log 'Building ...'
pnpm --filter '@c-hr/zk-bridge' build

# 5. First start.
$port = if ($env:PORT) { $env:PORT } else { '7000' }
$bind = if ($env:BIND_HOST) { $env:BIND_HOST } else { '127.0.0.1' }
$env:PORT = $port
$env:BIND_HOST = $bind
Log "Starting ZK-Bridge on http://${bind}:${port} ..."
Log 'Open the URL in a browser to finish setup. Ctrl+C to stop.'
node dist\index.js
