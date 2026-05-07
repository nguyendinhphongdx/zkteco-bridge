import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadBootEnv } from '../config/env';

const PID_FILE = 'zk-bridge.pid';
const LOG_FILE = 'zk-bridge.log';

interface Paths {
  dataDir: string;
  pid: string;
  log: string;
}

function paths(): Paths {
  const { dataDir } = loadBootEnv();
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    pid: path.join(dataDir, PID_FILE),
    log: path.join(dataDir, LOG_FILE),
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  const p = paths();
  if (!fs.existsSync(p.pid)) return null;
  const n = parseInt(fs.readFileSync(p.pid, 'utf8').trim(), 10);
  if (!Number.isFinite(n) || !isAlive(n)) {
    try {
      fs.unlinkSync(p.pid);
    } catch {
      // best-effort
    }
    return null;
  }
  return n;
}

export interface StartResult {
  pid: number;
  logPath: string;
  dataDir: string;
}

/**
 * Spawn the bridge as a detached background child writing to a log file.
 * Parent exits immediately — Ctrl+C in the launching shell does NOT kill
 * the daemon (it's in a separate process group).
 */
export function startDaemon(): StartResult {
  const existing = readPid();
  if (existing) {
    throw new Error(
      `Already running (PID ${existing}). Use 'zk-bridge stop' or 'zk-bridge restart' first.`,
    );
  }
  const p = paths();
  const fd = fs.openSync(p.log, 'a');
  const node = process.execPath;
  // dist/index.js — same entry `zk-bridge run` invokes, but spawned detached.
  const entry = path.resolve(__dirname, '..', 'index.js');
  const child = spawn(node, [entry], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: process.env,
  });
  child.unref();
  if (!child.pid) throw new Error('Failed to spawn child process.');
  fs.writeFileSync(p.pid, String(child.pid));
  fs.closeSync(fd);
  return { pid: child.pid, logPath: p.log, dataDir: p.dataDir };
}

export interface StopResult {
  pid: number;
}

export function stopDaemon(): StopResult | null {
  const pid = readPid();
  if (!pid) return null;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already dead — fall through to PID cleanup
  }
  // Wait a moment for graceful shutdown, then verify.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isAlive(pid)) {
    // busy-wait short; the kill is async
    sleepSync(100);
  }
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  const p = paths();
  try {
    fs.unlinkSync(p.pid);
  } catch {
    // ignore
  }
  return { pid };
}

export interface StatusInfo {
  running: boolean;
  pid?: number;
  logPath: string;
  dataDir: string;
  /** Approx uptime (ms) — derived from PID file mtime. */
  uptimeMs?: number;
}

export function statusDaemon(): StatusInfo {
  const p = paths();
  const pid = readPid();
  if (!pid) {
    return { running: false, logPath: p.log, dataDir: p.dataDir };
  }
  let uptimeMs: number | undefined;
  try {
    const stat = fs.statSync(p.pid);
    uptimeMs = Date.now() - stat.mtimeMs;
  } catch {
    // ignore
  }
  return { running: true, pid, logPath: p.log, dataDir: p.dataDir, uptimeMs };
}

/**
 * Print last N lines of the log file, optionally follow new appends.
 * Cross-platform tail — doesn't shell out.
 */
export function tailLog(follow: boolean, lines: number): void {
  const p = paths();
  if (!fs.existsSync(p.log)) {
    console.log('(no log yet — daemon has not started.)');
    return;
  }
  const initial = readLastLines(p.log, lines);
  process.stdout.write(initial);

  if (!follow) return;

  let pos = fs.statSync(p.log).size;
  const watcher = fs.watch(p.log, () => {
    let stat;
    try {
      stat = fs.statSync(p.log);
    } catch {
      return;
    }
    if (stat.size > pos) {
      const fd = fs.openSync(p.log, 'r');
      const buf = Buffer.alloc(stat.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      process.stdout.write(buf.toString('utf8'));
      pos = stat.size;
    } else if (stat.size < pos) {
      pos = 0;
    }
  });
  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });
  // Keep the event loop alive.
  setInterval(() => undefined, 1 << 30);
}

function readLastLines(file: string, lines: number): string {
  const content = fs.readFileSync(file, 'utf8');
  const arr = content.split('\n');
  // Trim trailing empty line caused by final newline.
  if (arr[arr.length - 1] === '') arr.pop();
  const slice = arr.slice(-lines);
  return slice.join('\n') + (slice.length > 0 ? '\n' : '');
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function sleepSync(ms: number): void {
  // Atomics.wait on a SharedArrayBuffer would be precise but heavy; this
  // ~100ms granularity is fine for stop's grace-period polling.
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin
  }
}
