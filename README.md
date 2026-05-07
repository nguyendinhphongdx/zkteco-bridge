<p align="center">
  <img src="https://img.shields.io/badge/ZK--Bridge-Attendance-007ACC?style=for-the-badge&logo=fingerprint&logoColor=white" alt="ZK-Bridge" />
</p>

<h1 align="center">ZK-Bridge</h1>

<p align="center">
  <strong>LAN-side bridge for ZKTeco attendance devices.</strong><br/>
  Polls a ZKTeco fingerprint reader over TCP, pushes events to any HTTP backend.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hanoilab/zk-bridge">npm</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#backend-contract">Backend Contract</a> &bull;
  <a href="#self-hosting">Self-Hosting</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hanoilab/zk-bridge"><img src="https://img.shields.io/npm/v/@hanoilab/zk-bridge?style=flat-square&color=cb3837&label=npm" alt="npm" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/sqlite-bundled-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="sqlite" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
</p>

---

## What is this?

ZKTeco fingerprint readers don't speak HTTP — they only accept TCP connections from inside the LAN, and the C-HR / HRIS backend lives in the cloud. ZK-Bridge sits in the office, polls the device on a schedule, and pushes attendance events to any HTTP API you point it at.

```
ZKTeco device                ZK-Bridge                  Your backend
┌─────────────────┐       ┌──────────────┐           ┌──────────────┐
│ Fingerprint /   │ ◄─TCP─┤  CLI + UI    │ ◄──HTTPS──┤  /push       │
│ face reader     │ 4370  │  SQLite      │           │  /ping       │
│ 192.168.x.y     │       │  Local LAN   │           │  Cloud / VPS │
└─────────────────┘       └──────────────┘           └──────────────┘
                          Outbound only — no port
                          forwarding or VPN needed
```

No vendor lock-in: any backend that exposes a JSON `POST` endpoint with a JWT auth header works. Bridge handles the LAN side.

## Quick Start

### 1. Install globally

```bash
npm i -g @hanoilab/zk-bridge
```

### 2. Run it

```bash
zk-bridge start
```

```text
[zk-bridge] started (PID 12345)
  Logs:  ~/.local/share/zk-bridge/zk-bridge.log
  Stop:  zk-bridge stop
  Tail:  zk-bridge logs -f
```

`start` detaches — closing the terminal won't stop the bridge. Useful one-liners:

```bash
zk-bridge status                 # is it running?
zk-bridge logs -f                # follow the log
zk-bridge stop                   # stop it
```

### 3. Open the admin UI

Visit **<http://localhost:7000>**, set the backend Push URL, paste the per-device JWT — bridge pushes attendance on the next cycle.

## Features

### Web Admin UI
- Single-user login (bcrypt + signed-cookie session, 7-day TTL)
- Configure backend Push / Ping URL + poll interval
- Add devices manually or via LAN scan
- Per-device events with cursor position + push status badge
- Cycle history with status, timing, error message, filter by device

### LAN Discovery
- Auto-scan `/24` subnet for ZKTeco devices on TCP 4370
- Identify each candidate over the ZK protocol (model, serial)
- One-click "Add as device" pre-fills name + host

### Multi-Device
- One bridge polls many devices on a single schedule
- Per-device cursor, queue, audit log, error state
- Enable / disable individually without removing config

### Offline Tolerance
- Queues events to local SQLite when the backend is unreachable
- Drains the queue on the next online cycle
- Cursor advances even on partial failure — no data loss, no double-send

### Idempotent Push
- Backend dedupes by `(deviceId, eventLogId)` — replay is a no-op
- Batches events at 200/request to stay under common body-parser limits
- JWT version counter for revocation (regenerate on the backend → old JWTs rejected immediately)

### Auto-Start on Boot
- One-click toggle in the System page registers a:
  - **systemd** unit (Linux)
  - **Scheduled Task** (Windows)
  - **launchd** plist (macOS)
- `Restart=on-failure` so a crashed cycle never takes the bridge down

### Cross-platform
- Linux, macOS, Windows
- Node 20+ — no native build needed (sqlite3 ships prebuilds)

## CLI

```bash
zk-bridge start                  # Start as background daemon (writes PID + log)
zk-bridge stop                   # Stop the daemon
zk-bridge restart                # Stop + start
zk-bridge status                 # PID, uptime, log path
zk-bridge logs -f                # Follow the log
zk-bridge logs -n 200            # Last 200 lines
zk-bridge run                    # Run in the foreground (debug / systemd / Docker)
zk-bridge poll-once              # Run a single cycle then exit
zk-bridge reset-user             # Forgot-password recovery
zk-bridge recent-events          # Print last N events from a device
zk-bridge upgrade [tag]          # Self-update via npm
zk-bridge --help
zk-bridge --version
```

`start` detaches from the launching shell — `Ctrl+C` in that terminal does NOT kill the daemon. Use `zk-bridge stop`. Logs go to `<DATA_DIR>/zk-bridge.log`.

Environment overrides (otherwise default):

```bash
PORT=8080 BIND_HOST=0.0.0.0 zk-bridge start
DATA_DIR=/var/lib/zk-bridge zk-bridge start
```

## How It Works

Every cycle (default 5 min):

1. List enabled devices in local SQLite.
2. For each: open ZK socket, fetch attendance log, take the last N events.
3. Drain the offline queue, then push new events to the backend in batches of 200.
4. Advance the cursor, write a `cycle_log` row.

State that lives locally:

```
~/.local/share/zk-bridge/zk-bridge.db   (Linux default)
%APPDATA%\zk-bridge\zk-bridge.db        (Windows)
~/Library/Application Support/zk-bridge/zk-bridge.db  (macOS)

  ├── users          (single admin row)
  ├── config         (push URL, ping URL, poll interval, session secret)
  ├── devices        (host, port, JWT, cursor, last status)
  ├── event_queue    (offline-pending events)
  └── cycle_log      (per-device cycle history, rotated to last 1000)
```

## Backend Contract

Two HTTP endpoints. Configure their full URLs in the UI — the bridge appends nothing.

### Push (required)

```http
POST <push-url>
Content-Type: application/json

{
  "token": "<JWT signed by backend>",
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

The backend should:

- Verify the JWT (signature + expiry / version).
- Resolve the device row from the JWT payload.
- Dedupe by `(deviceId, eventLogId)` — replays are safe.
- Persist or normalize the events as needed.

Response shape isn't enforced — bridge only checks the HTTP status (2xx = success, anything else = retry / queue).

### Ping (optional)

```http
POST <ping-url>
Content-Type: application/json

{ "token": "<JWT>" }
```

Used by the **Connect** button to verify the JWT + URL without sending events. If you don't expose a separate ping endpoint, leave the field blank — the bridge falls back to a push with an empty `events` array (your backend should respond 4xx for that case, which the bridge interprets as "auth + URL OK").

### Reference implementation

See [c-hr backend](https://github.com/nguyendinhphongdx/c-hr) — `apps/backend/src/apps/attendance/attendance-device/` is a NestJS module that implements the contract end-to-end, including JWT version revocation and orphan-event reconcile.

## Self-Hosting

```bash
git clone https://github.com/nguyendinhphongdx/zkteco-bridge.git
cd zkteco-bridge
pnpm install
pnpm build
pnpm start
```

Or install your local checkout as the global CLI:

```bash
npm install -g .
zk-bridge start
```

### Auto-start (production)

Three options — pick **one**, otherwise two processes will fight for port 7000:

- **Built-in toggle** (recommended) — *System → Auto-start on boot* registers a systemd / Windows Task / launchd entry pointing at the global CLI binary.
- **PM2** —

  ```bash
  pm2 start "$(which zk-bridge)" --name zk-bridge -- start
  pm2 startup && pm2 save
  ```

- **Docker** — see [`docker-compose.yml`](docker-compose.yml). Bind-mount `./data:/app/data` to persist SQLite across rebuilds.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7000` | Admin UI HTTP port |
| `BIND_HOST` | `127.0.0.1` | Listen address. Set `0.0.0.0` to allow LAN access |
| `DATA_DIR` | OS-standard user data dir | Override SQLite + admin login location |
| `PUSH_URL` | _(none)_ | First-run seed only — bridge stores it in SQLite then ignores env |
| `PING_URL` | _(none)_ | First-run seed only |
| `POLL_INTERVAL_MIN` | `5` | First-run seed only — minutes between cycles |

`DATA_DIR` resolution order on every start:

1. `DATA_DIR` env var (always wins)
2. `./data/` next to cwd, if it exists (Docker bind mount, dev workflow)
3. **Globally installed:** OS-standard user data dir
4. `./data/` next to cwd (dev fallback)

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|-------------------|
| `ETIMEDOUT <ip>:<port>` on Connect | Bridge can't reach the backend Push URL. `curl <url>` from the bridge host should work. |
| `HTTP 401 Invalid token` | JWT was regenerated on the backend, or the device row was deleted. Re-paste the token. |
| `Socket closed unexpectedly` | The ZK device only allows 1 active connection — another tool / cycle is holding it. Wait for the next cycle. |
| `port open but ZK probe fail` in scan | Same — device is busy. Try **Add** → **Connect** after a minute. |
| Dashboard shows "never run" | Push URL not set, or no devices configured. Check *API settings* + *Devices*. |
| Events arrive late | Lower the *poll interval* in *API settings* (min 1 min). |

Every console line is prefixed with an ISO timestamp so logs from `pm2 logs` / `journalctl -u zk-bridge` / `docker compose logs` line up:

```text
[2026-05-07T08:23:50.747Z] [poll] "Front gate" pulled 2915 from ZK in 5291ms
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Node.js 20+](https://nodejs.org/) |
| Local DB | [SQLite](https://www.sqlite.org/) via [sqlite3](https://github.com/TryGhost/node-sqlite3) + [Sequelize](https://sequelize.org/) |
| HTTP server | [Hono](https://hono.dev/) + [@hono/node-server](https://github.com/honojs/node-server) |
| ZK protocol | Custom client (`src/zklib`) — TCP raw, chunked streaming for large logs |
| Auth | [bcryptjs](https://github.com/dcodeIO/bcrypt.js) (admin) + JWT (per-device) |
| HTTP client | [axios](https://axios-http.com/) |
| Scheduler | [node-cron](https://github.com/node-cron/node-cron) |
| Build | [TypeScript](https://www.typescriptlang.org/) |

## License

MIT &copy; [HanoiLab](mailto:opencode@hanoilab.vn)

---
