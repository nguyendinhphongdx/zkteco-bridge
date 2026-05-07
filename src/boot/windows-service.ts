import { resolveRunPaths, run, SERVICE_NAME } from './common';

const TASK_NAME = `ZK-Bridge (${SERVICE_NAME})`;

/**
 * Windows: register a Scheduled Task that runs the bridge at boot. This is
 * simpler and less invasive than installing a Windows service via nssm.
 */
export async function install(): Promise<void> {
  const { entry, nodeBin, workDir } = resolveRunPaths();
  // Build the action: `node` `dist/index.js` with workdir.
  const trArg = `"${nodeBin}" "${entry}"`;
  await run('schtasks', [
    '/Create',
    '/F', // overwrite if exists
    '/TN',
    TASK_NAME,
    '/TR',
    trArg,
    '/SC',
    'ONSTART',
    '/RL',
    'HIGHEST',
    '/RU',
    'SYSTEM',
  ]);
  // Start it immediately so admin doesn't need to reboot.
  try {
    await run('schtasks', ['/Run', '/TN', TASK_NAME]);
  } catch {
    // ignore — installing alone is success
  }
  void workDir;
}

export async function uninstall(): Promise<void> {
  try {
    await run('schtasks', ['/End', '/TN', TASK_NAME]);
  } catch {
    // ignore — may not be running
  }
  try {
    await run('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
  } catch {
    // ignore — may not exist
  }
}

export async function isInstalled(): Promise<boolean> {
  try {
    await run('schtasks', ['/Query', '/TN', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

export function describe(): string {
  return `Scheduled Task "${TASK_NAME}"`;
}
