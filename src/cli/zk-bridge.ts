#!/usr/bin/env node

/**
 * `zk-bridge` CLI entry — published as the `bin` of this package so admins
 * who install the package globally can run `zk-bridge <command>` instead of
 * remembering `node /opt/whatever/dist/index.js`.
 *
 * Each subcommand is a thin dynamic import of an existing entry whose
 * top-level `main()` self-executes, so this dispatcher stays tiny.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';

import {
  formatUptime,
  startDaemon,
  statusDaemon,
  stopDaemon,
  tailLog,
} from './daemon';

const command = process.argv[2];

function help(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: zk-bridge <command> [options]

Commands:
  start                    Start bridge in the background (writes PID + log)
  stop                     Stop the running daemon
  restart                  Stop + start
  status                   Show daemon state (PID, uptime, log path)
  logs [-f] [-n N]         Print last N log lines (default 50). -f to follow.
  run                      Run in the foreground (debug / systemd / Docker)
  poll-once                Run a single poll cycle then exit (no UI server)
  reset-user               Reset the local admin user (forgot password recovery)
  recent-events            Print recent events from a device
  upgrade [tag]            Self-upgrade via npm (default tag: latest)

  help, --help, -h         Show this help
  version, --version, -v   Show package version

Environment:
  DATA_DIR                 Where SQLite + admin credentials + log live
                           (default: OS user data dir)
  PORT=7000                UI HTTP port
  BIND_HOST=127.0.0.1      Bind address. Set 0.0.0.0 to allow LAN access

Examples:
  zk-bridge start                    # daemonize
  zk-bridge status                   # is it running?
  zk-bridge logs -f                  # follow logs
  zk-bridge stop                     # stop the daemon
  PORT=8080 zk-bridge run            # foreground on a custom port
  zk-bridge recent-events --device "Front gate" -n 30
`);
}

function version(): void {
  // package.json sits two dirs up from dist/cli/.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../package.json');
  // eslint-disable-next-line no-console
  console.log(pkg.version ?? 'unknown');
}

/**
 * Self-upgrade by spawning `npm install -g <pkg>@<tag>`. Only meaningful
 * when running from a global install — for a checkout, the user should
 * `git pull && pnpm build` instead.
 */
async function upgrade(tag = 'latest'): Promise<void> {
  const isGlobalInstall = __dirname.includes(`${path.sep}node_modules${path.sep}`);
  if (!isGlobalInstall) {
    // eslint-disable-next-line no-console
    console.error(
      '`zk-bridge upgrade` only works when installed globally via npm.\n' +
        'You appear to be running from a source checkout — use `git pull && pnpm build` instead.',
    );
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../package.json');
  const name = String(pkg.name ?? '');
  if (!name) {
    // eslint-disable-next-line no-console
    console.error('Could not read package name from package.json.');
    process.exit(1);
  }

  const target = `${name}@${tag}`;
  // eslint-disable-next-line no-console
  console.log(`[zk-bridge] upgrading to ${target} ...`);

  const child = spawn('npm', ['install', '-g', target], {
    stdio: 'inherit',
    // npm on Windows is a `.cmd` shim — needs shell to resolve.
    shell: process.platform === 'win32',
  });

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install exited with code ${code}`));
    });
  });

  // eslint-disable-next-line no-console
  console.log(
    `[zk-bridge] ✓ upgraded ${target}.\n` +
      'Restart the daemon to pick up the new code:\n' +
      '  zk-bridge restart',
  );
}

function parseLogsArgs(): { follow: boolean; lines: number } {
  const argv = process.argv.slice(3);
  const follow = argv.includes('-f') || argv.includes('--follow');
  const nIdx = argv.findIndex((a) => a === '-n' || a === '--lines');
  const lines = nIdx >= 0 ? Number(argv[nIdx + 1]) : 50;
  return { follow, lines: Number.isFinite(lines) && lines > 0 ? lines : 50 };
}

function cmdStart(): void {
  try {
    const r = startDaemon();
    // eslint-disable-next-line no-console
    console.log(
      `[zk-bridge] started (PID ${r.pid})\n` +
        `  Logs:  ${r.logPath}\n` +
        `  Stop:  zk-bridge stop\n` +
        `  Tail:  zk-bridge logs -f`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[zk-bridge] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function cmdStop(): void {
  const r = stopDaemon();
  if (!r) {
    // eslint-disable-next-line no-console
    console.log('[zk-bridge] not running.');
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[zk-bridge] stopped (PID ${r.pid}).`);
}

async function cmdRestart(): Promise<void> {
  cmdStop();
  await new Promise((r) => setTimeout(r, 600));
  cmdStart();
}

function cmdStatus(): void {
  const s = statusDaemon();
  if (!s.running) {
    // eslint-disable-next-line no-console
    console.log(
      `[zk-bridge] not running.\n` +
        `  Data dir: ${s.dataDir}\n` +
        `  Logs:     ${s.logPath} (last run, if any)`,
    );
    return;
  }
  const up = s.uptimeMs !== undefined ? formatUptime(s.uptimeMs) : 'unknown';
  // eslint-disable-next-line no-console
  console.log(
    `[zk-bridge] running.\n` +
      `  PID:      ${s.pid}\n` +
      `  Uptime:   ${up}\n` +
      `  Data dir: ${s.dataDir}\n` +
      `  Logs:     ${s.logPath}`,
  );
}

async function main(): Promise<void> {
  switch (command) {
    // ── daemon control ───────────────────────────────────────────────────
    case undefined:
    case 'start':
      cmdStart();
      return;

    case 'stop':
      cmdStop();
      return;

    case 'restart':
      await cmdRestart();
      return;

    case 'status':
      cmdStatus();
      return;

    case 'logs': {
      const { follow, lines } = parseLogsArgs();
      tailLog(follow, lines);
      return;
    }

    // ── foreground / one-shot ────────────────────────────────────────────
    case 'run':
      // Foreground mode — what daemons / Docker / systemd should call.
      process.argv.splice(2, 1);
      await import('../index');
      return;

    case 'poll-once':
      process.argv.splice(2, 1, '--once');
      await import('../index');
      return;

    case 'reset-user':
      process.argv.splice(2, 1);
      await import('./reset-user');
      return;

    case 'recent-events':
      process.argv.splice(2, 1);
      await import('./recent-events');
      return;

    // ── self-update ──────────────────────────────────────────────────────
    case 'upgrade':
    case 'update':
      await upgrade(process.argv[3] ?? 'latest');
      return;

    // ── meta ─────────────────────────────────────────────────────────────
    case 'help':
    case '--help':
    case '-h':
      help();
      return;

    case 'version':
    case '--version':
    case '-v':
      version();
      return;

    default:
      // eslint-disable-next-line no-console
      console.error(`Unknown command: ${command}\n`);
      help();
      process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[zk-bridge] FATAL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
