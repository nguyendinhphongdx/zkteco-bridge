import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveRunPaths, run, SERVICE_NAME, writeFileEnsureDir } from './common';

const LABEL = `com.chr.${SERVICE_NAME}`;

function plistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function plistContent(): string {
  const { entry, nodeBin, workDir } = resolveRunPaths();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${entry}</string>
  </array>
  <key>WorkingDirectory</key><string>${workDir}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(workDir, 'data', 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(workDir, 'data', 'launchd.err.log')}</string>
</dict>
</plist>
`;
}

export async function install(): Promise<void> {
  const file = plistPath();
  writeFileEnsureDir(file, plistContent(), 0o644);
  try {
    await run('launchctl', ['unload', file]);
  } catch {
    // ignore — may not be loaded
  }
  await run('launchctl', ['load', file]);
}

export async function uninstall(): Promise<void> {
  const file = plistPath();
  try {
    await run('launchctl', ['unload', file]);
  } catch {
    // ignore
  }
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export async function isInstalled(): Promise<boolean> {
  return fs.existsSync(plistPath());
}

export function describe(): string {
  return `launchd plist at ${plistPath()}`;
}
