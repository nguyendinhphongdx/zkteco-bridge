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

const command = process.argv[2];

function help(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: zk-bridge <command> [options]

Commands:
  start                    Start bridge (UI + scheduler) — default if no command given
  poll-once                Run a single poll cycle then exit (no UI server)
  reset-user               Reset the local admin user (forgot password recovery)
  recent-events            Print recent events from a device
  upgrade [tag]            Self-upgrade via npm (default tag: latest)

  help, --help, -h         Show this help
  version, --version, -v   Show package version

Environment:
  DATA_DIR=./data          Where SQLite + admin credentials live
  PORT=7000                UI HTTP port
  BIND_HOST=127.0.0.1      Bind address. Set 0.0.0.0 to allow LAN access

Examples:
  zk-bridge start
  PORT=8080 zk-bridge start
  zk-bridge poll-once
  zk-bridge reset-user
  zk-bridge upgrade
  zk-bridge upgrade next
  zk-bridge recent-events --device "Cửa chính" -n 30
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
      'Restart the running bridge process to pick up the new code:\n' +
      '  systemd:        sudo systemctl restart zk-bridge\n' +
      '  Windows Task:   schtasks /End /TN "ZK-Bridge (zk-bridge)" && schtasks /Run /TN "ZK-Bridge (zk-bridge)"\n' +
      '  launchd:        launchctl kickstart -k gui/$UID/com.chr.zk-bridge\n' +
      '  pm2:            pm2 restart zk-bridge\n' +
      '  docker compose: docker compose pull && docker compose up -d\n' +
      '  manual:         Ctrl+C the foreground process, then `zk-bridge start` again',
  );
}

async function main(): Promise<void> {
  switch (command) {
    case undefined:
    case 'start':
      // Strip the subcommand so the underlying entry sees a clean argv.
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

    case 'upgrade':
    case 'update':
      // Optional next arg = npm dist-tag (e.g. `next`). Default `latest`.
      await upgrade(process.argv[3] ?? 'latest');
      return;

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
