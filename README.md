# @c-hr/zk-bridge

LAN-side adapter that polls a ZKTeco attendance device over TCP and pushes
the events to a C-HR backend over HTTPS.

Runs in the customer's office (mini-PC, NAS, VM) — never alongside the C-HR
backend in the cloud, since the cloud cannot reach `192.168.x.y:4370`.

```text
[ZKTeco device]  →  [zk-bridge — this package]  →  [C-HR backend]
   LAN, TCP 4370       polls every 5 min              HTTPS push
                       offline queue + JWT auth
```

## Install

```bash
npm install -g @c-hr/zk-bridge
zk-bridge start
```

Open <http://127.0.0.1:7000>. First run shows a setup form to create the
local admin; subsequent runs go to login.

Requires **Node ≥ 20**.

## First-time setup walkthrough

1. **On the C-HR cloud admin UI** → *Settings → Attendance devices* →
   register one device per physical reader → copy the JWT token shown.
2. **On the host running zk-bridge** (mini-PC / NAS / VM):
   1. Open `http://<host-ip>:7000`.
   2. Create the local admin (username + password).
   3. *Settings → C-HR* → paste the API base URL + poll interval.
   4. *Devices → + Add device* → name + LAN IP + paste the JWT token.
      (Or use *Scan now* to discover ZKTeco devices on the subnet.)
   5. *Settings → Auto-start on boot* → toggle on. Bridge registers itself
      with systemd / Windows Scheduled Task / launchd so it survives
      reboots.

That's it. The scheduler then polls every 5 minutes and pushes attendance
to C-HR. The dashboard shows per-device health, queue depth, recent cycles.

## Commands

```bash
zk-bridge start                                  # UI + scheduler (default)
zk-bridge poll-once                              # one cycle then exit
zk-bridge reset-user                             # forgot-password recovery
zk-bridge recent-events --device "Cửa chính" -n 30
zk-bridge upgrade [tag]                          # self-update via npm
zk-bridge --help
zk-bridge --version
```

## Configuration

Most settings live in the local SQLite DB and are edited through the web
UI. Only path / bind settings come from env:

| Env | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | OS-standard (see below) | Where SQLite + admin credentials live |
| `PORT` | `7000` | UI HTTP port |
| `BIND_HOST` | `127.0.0.1` | Listen address. Set `0.0.0.0` to allow LAN access |

```bash
PORT=8080 BIND_HOST=0.0.0.0 zk-bridge start
```

### Where data lives

`zk-bridge start` prints `[zk-bridge] data dir: <path>` on boot. Resolution
order:

1. `DATA_DIR` env var (always wins).
2. `./data/` next to cwd, if it exists (dev workflow, Docker bind mount).
3. **Globally installed (`npm i -g`)** → OS-standard user data dir:
   - Linux: `~/.local/share/zk-bridge` (or `$XDG_DATA_HOME/zk-bridge`)
   - macOS: `~/Library/Application Support/zk-bridge`
   - Windows: `%APPDATA%\zk-bridge`
4. `./data/` next to cwd (dev fallback).

The SQLite file is `<data dir>/zk-bridge.db`. Back this up if you want to
preserve admin credentials + offline event queue across machine reinstalls.

## Auto-start on host

Three ways, pick one:

- **Built-in toggle** (recommended for non-tech admins): *Settings →
  Auto-start on boot* in the web UI. Registers a systemd unit / Windows
  Scheduled Task / launchd plist that runs `node <dist>/index.js` on boot
  with `Restart=on-failure`.
- **PM2**:

  ```bash
  pm2 start "$(which zk-bridge)" --name zk-bridge -- start
  pm2 startup && pm2 save
  ```

- **Docker compose** (alternative — see [Docker](#docker) section below).

The three are mutually exclusive — pick one and don't enable the others
or two processes will fight for port 7000.

## Docker

`docker-compose.yml` ships with the package. From a clone of the repo:

```bash
docker compose up -d --build
open http://<host>:7000
```

Bind-mount `./data:/app/data` keeps SQLite + credentials across rebuilds.
Default networking is bridge mode (port 7000 exposed). For accurate LAN
scan on Linux production, switch to `network_mode: host`.

## Self-upgrade

```bash
zk-bridge upgrade           # pulls latest from npm
sudo systemctl restart zk-bridge   # or pm2 restart zk-bridge / docker compose pull
```

`zk-bridge upgrade` runs `npm install -g <pkg>@latest` under the hood.
Only works when installed globally — for source checkouts use `git pull && pnpm build`.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `ETIMEDOUT 192.168.x.y:3001` on Connect | Bridge can't reach the C-HR API URL from this host. Verify `curl <api-url>/health` works. |
| `HTTP 401 Invalid token` | JWT was regenerated on C-HR side or device deleted. Re-copy token from C-HR admin. |
| `Socket closed unexpectedly` | Device only allows 1 active connection — another tool / cycle is holding it. Wait for next cycle (or restart device). |
| `port open but ZK probe fail` in scan | Same — device is busy. The candidate is still likely a ZKTeco; try Add → Connect after a minute. |
| Dashboard shows "never run" | C-HR API URL not set, or no devices configured. Check *Settings → C-HR* + *Devices*. |
| Events arrive late | Reduce *poll interval* in *Settings → C-HR* (min 1 min). |

Bridge logs every console line with an ISO timestamp prefix:

```text
[2026-05-07T08:23:50.747Z] [poll] "Cửa chính" pulled 22915 from ZK in 5291ms
```

## How it works

- **Poll cycle** (every N minutes from cron-like scheduler):
  1. List enabled devices in local SQLite.
  2. For each device: open ZK socket, fetch attendance log, filter
     events newer than `lastEventLogId` cursor.
  3. Drain offline queue first, then push fresh events to C-HR in batches
     of 200 (under default body-parser limit).
  4. Advance cursor, write a `cycle_log` row.
- **Offline tolerance**: when C-HR is unreachable, fresh events go into
  `event_queue` table; cursor advances anyway. The next online cycle
  drains the queue.
- **Idempotency**: C-HR dedupes by `(deviceId, eventLogId)` — replays are
  safe.
- **Auth**: each device has a JWT signed by C-HR. The bridge sends just
  `{ token, events[] }`; C-HR resolves device from the JWT subject. Token
  rotation = bump `version` field on the device row → old JWT rejected.

## Develop from source

```bash
git clone https://github.com/<org>/c-hr.git
cd c-hr/services/zk-bridge
pnpm install
pnpm build
pnpm start
```

The package is self-contained — `pnpm install` here writes a local
lockfile + node_modules without touching the parent monorepo. To install
your local copy as the global CLI:

```bash
npm install -g .
zk-bridge start
```

## Publish (maintainer)

```bash
pnpm build
npm version <patch|minor|major>
npm publish --access public        # required for scoped names
```

`package.json` ships only the compiled `dist/` + this README (see `files`
field). Set `"private": false` before the first publish.

## License

(internal — not yet decided)
