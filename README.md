# @hanoilab/zk-bridge

LAN-side bridge for ZKTeco attendance devices. Polls a device over TCP and pushes events to your backend over HTTPS.

## Quick Start

```bash
# Install globally
npm i -g @hanoilab/zk-bridge

# Start the bridge
zk-bridge start
```

That's it. You'll see:

```text
[zk-bridge] data dir: ~/.local/share/zk-bridge
[zk-bridge] UI listening on http://127.0.0.1:7000
[scheduler] starting cron "*/5 * * * *" (every 5 min)
```

Open the admin UI, paste your backend's Push URL + a per-device JWT, and the bridge starts pushing on the next cycle.

## Features

- **Web admin UI** — Single-user login, device list, scan LAN, view events
- **LAN scan** — Auto-discover ZKTeco devices on your subnet (TCP 4370)
- **Multi-device** — One bridge polls many devices on a schedule
- **Offline tolerant** — Queues events when the backend is unreachable, drains on next cycle
- **Idempotent push** — Backend dedupes by `(deviceId, eventLogId)`; safe to retry
- **Auto-start on boot** — One-click systemd / Windows Task / launchd registration
- **Cross-platform** — Linux, macOS, Windows
- **Secure** — bcrypt admin login, signed-cookie sessions, JWT per-device tokens

## CLI Commands

```bash
zk-bridge start                  # Start bridge (UI + scheduler) — default
zk-bridge poll-once              # One cycle then exit
zk-bridge reset-user             # Forgot-password recovery
zk-bridge recent-events          # Print last N events from a device
zk-bridge upgrade [tag]          # Self-update via npm
zk-bridge --help
zk-bridge --version
```

## Admin Panel

After `zk-bridge start`, open `http://localhost:7000` to:

- Set the backend Push URL + Ping URL + poll interval
- Add devices (manual or via LAN scan)
- View per-device events with cursor position, push status
- Inspect cycle history, reset cursor, regenerate tokens
- Toggle auto-start on boot

## How It Works

```text
ZK device              zk-bridge              Your backend
+----------+         +-----------+         +------------+
|  ZKTeco  | <-----> |  bridge   | <-----> |  HTTP API  |
| TCP 4370 |   ZK    | (this CLI)|  HTTPS  | /push      |
+----------+         +-----------+         +------------+
                        SQLite
                     (config + queue)
```

Every cycle (default 5 min):

1. List enabled devices in local SQLite.
2. For each: open ZK socket, fetch attendance log, take the last N events.
3. Drain the offline queue, then push new events to the backend in batches of 200.
4. Advance the cursor, write a `cycle_log` row.

Backend dedupes by `(deviceId, eventLogId)` — replays are safe.

## Backend Contract

The bridge POSTs to **two URLs** you configure:

**Push URL** (required)

```http
POST <push-url>
Content-Type: application/json

{
  "token": "<JWT>",
  "events": [
    {
      "eventLogId": "12345",
      "employeeCode": "EMP-0001",
      "timestamp": "2026-05-07T08:23:45.000Z",
      "type": "IN"
    }
  ]
}
```

**Ping URL** (optional — used by the *Connect* button)

```http
POST <ping-url>
Content-Type: application/json

{ "token": "<JWT>" }
```

If you don't expose a separate ping endpoint, leave the field empty — the bridge falls back to a push with an empty events array.

The backend is responsible for: verifying the JWT, resolving devices, deduping by `(deviceId, eventLogId)`, and storing or normalizing events.

## Requirements

- Node.js 20+
- macOS, Linux, or Windows
- Network reach: bridge host must see the ZK device on LAN AND the backend over HTTP(S)

## Configuration

Settings live in a local SQLite DB and are edited through the web UI. Only paths and bind come from env:

| Env | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | OS-standard (see below) | Where SQLite + admin login live |
| `PORT` | `7000` | UI HTTP port |
| `BIND_HOST` | `127.0.0.1` | Listen address. Set `0.0.0.0` for LAN access |

**Data dir resolution:**

- `DATA_DIR` env (always wins)
- `./data/` next to cwd, if it exists (Docker bind mount, dev workflow)
- Globally installed: OS-standard user data dir
  - Linux: `~/.local/share/zk-bridge`
  - macOS: `~/Library/Application Support/zk-bridge`
  - Windows: `%APPDATA%\zk-bridge`

Boot prints the chosen path:

```text
[2026-05-07T08:23:45.123Z] [zk-bridge] data dir: ~/.local/share/zk-bridge
```

## Auto-start on Host

Three options — pick one:

- **Built-in toggle** (recommended): *System → Auto-start on boot* in the web UI registers a systemd unit / Windows Scheduled Task / launchd plist with `Restart=on-failure`.
- **PM2**:

  ```bash
  pm2 start "$(which zk-bridge)" --name zk-bridge -- start
  pm2 startup && pm2 save
  ```

- **Docker** — see [`docker-compose.yml`](docker-compose.yml). Bind-mount `./data:/app/data` to persist state.

Don't enable two methods at once — they'll fight for port 7000.

## Self-upgrade

```bash
zk-bridge upgrade
sudo systemctl restart zk-bridge   # or pm2 restart zk-bridge / docker compose pull
```

`zk-bridge upgrade` runs `npm install -g <pkg>@latest` under the hood. Restart the host service afterwards so the running process picks up new code.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `ETIMEDOUT <ip>:<port>` on Connect | Bridge can't reach the backend Push URL from this host. `curl <url>` from the host should work. |
| `HTTP 401 Invalid token` | JWT was regenerated on the backend or device deleted. Re-paste the token. |
| `Socket closed unexpectedly` | The ZK device only allows 1 active connection — another tool / cycle is holding it. Wait for the next cycle. |
| `port open but ZK probe fail` in scan | Same — device is busy. Try Add → Connect after a minute. |
| Dashboard shows "never run" | Push URL not set, or no devices configured. Check *API settings* + *Devices*. |
| Events arrive late | Lower the poll interval in *API settings* (min 1 min). |

Every console line is prefixed with an ISO timestamp:

```text
[2026-05-07T08:23:50.747Z] [poll] "Front gate" pulled 2915 from ZK in 5291ms
```

## Develop from source

```bash
git clone https://github.com/nguyendinhphongdx/c-hr.git
cd c-hr/services/zk-bridge
pnpm install
pnpm build
pnpm start
```

The package is standalone — it has its own `pnpm-workspace.yaml` and `pnpm-lock.yaml`, separate from any parent monorepo. Install your local copy as the global CLI:

```bash
npm install -g .
zk-bridge start
```

## License

MIT
