# ZK-Bridge - Windows installer.
#
#   iwr -useb https://<your-release-host>/install-windows.ps1 | iex
#
# Installs (or upgrades) @hanoilab/zk-bridge globally, then starts the
# bridge in the foreground. Toggle auto-start in the web UI to register
# a Scheduled Task that runs at boot.

$ErrorActionPreference = 'Stop'

$NodeReqMajor = 20
$Pkg = '@hanoilab/zk-bridge'

function Log($msg) { Write-Host "[zkb-install] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[zkb-install] $msg" -ForegroundColor Red; exit 1 }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js is not installed. Install Node >= $NodeReqMajor from https://nodejs.org/"
}
$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $NodeReqMajor) { Fail "Node $nodeMajor is too old. Need >= $NodeReqMajor." }
Log "node $(& node -v) OK."

Log "Installing $Pkg from npm ..."
npm install -g $Pkg

$port = if ($env:PORT) { $env:PORT } else { '7000' }
$bind = if ($env:BIND_HOST) { $env:BIND_HOST } else { '127.0.0.1' }
$env:PORT = $port
$env:BIND_HOST = $bind
Log "Starting bridge as a background daemon ..."
zk-bridge start
Log "Open http://${bind}:${port} in a browser to finish setup."
Log "Useful commands: zk-bridge status / zk-bridge logs -f / zk-bridge stop"
