import * as cron from 'node-cron';

import { ConfigKeys } from '../config/runtime';
import { getConfig } from '../db/repo';

import { runCycle } from './poll';

let task: cron.ScheduledTask | null = null;
let running = false;

function intervalToCron(min: number): string {
  const n = Math.max(1, Math.min(1440, Math.floor(min)));
  return `*/${n} * * * *`;
}

async function safeRun(): Promise<void> {
  if (running) {
    console.log('[scheduler] previous cycle still in progress, skipping tick');
    return;
  }
  running = true;
  const tickAt = new Date().toISOString();
  const start = Date.now();
  console.log(`[scheduler] tick ${tickAt} — running cycle`);
  try {
    const summary = await runCycle();
    const ms = Date.now() - start;
    if (summary.apiUrlMissing) {
      console.log(`[scheduler] cycle skipped (${ms}ms) — backend Push URL not configured`);
    } else if (summary.noDevices) {
      console.log(`[scheduler] cycle skipped (${ms}ms) — no enabled devices`);
    } else {
      for (const r of summary.results) {
        console.log(
          `[scheduler] device "${r.deviceName}" ${r.status}: pulled=${r.pulled} pushed=${r.pushed} queued=${r.queued}` +
            (r.message ? ` — ${r.message}` : ''),
        );
      }
      console.log(`[scheduler] cycle finished in ${ms}ms (devices=${summary.results.length})`);
    }
  } catch (err) {
    console.error(
      `[scheduler] cycle threw after ${Date.now() - start}ms:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    running = false;
  }
}

export async function startScheduler(): Promise<void> {
  await stopScheduler();
  const intervalRaw = await getConfig(ConfigKeys.PollIntervalMin);
  const interval = intervalRaw ? Number(intervalRaw) : 5;
  const expr = intervalToCron(interval);
  console.log(`[scheduler] starting cron "${expr}" (every ${interval} min)`);
  task = cron.schedule(expr, () => {
    void safeRun();
  });
}

export async function stopScheduler(): Promise<void> {
  if (task) {
    task.stop();
    task = null;
  }
}

export async function restartScheduler(): Promise<void> {
  await startScheduler();
}

export async function runOnce(): Promise<void> {
  await safeRun();
}
