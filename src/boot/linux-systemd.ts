import * as fs from 'node:fs';

import { resolveRunPaths, run, SERVICE_NAME, writeFileEnsureDir } from './common';

const UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;

function unitFile(): string {
  const { entry, nodeBin, workDir } = resolveRunPaths();
  const user = process.env.USER || 'root';
  return `[Unit]
Description=C-HR ZK-Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodeBin} ${entry}
WorkingDirectory=${workDir}
Restart=on-failure
RestartSec=5
User=${user}

[Install]
WantedBy=multi-user.target
`;
}

export async function install(): Promise<void> {
  writeFileEnsureDir(UNIT_PATH, unitFile(), 0o644);
  await run('systemctl', ['daemon-reload']);
  await run('systemctl', ['enable', '--now', `${SERVICE_NAME}.service`]);
}

export async function uninstall(): Promise<void> {
  try {
    await run('systemctl', ['disable', '--now', `${SERVICE_NAME}.service`]);
  } catch {
    // ignore — may not be enabled
  }
  if (fs.existsSync(UNIT_PATH)) fs.unlinkSync(UNIT_PATH);
  await run('systemctl', ['daemon-reload']);
}

export async function isInstalled(): Promise<boolean> {
  return fs.existsSync(UNIT_PATH);
}

export function describe(): string {
  return `systemd unit at ${UNIT_PATH}`;
}
