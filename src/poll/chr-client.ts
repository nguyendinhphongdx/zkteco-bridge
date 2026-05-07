import axios, { AxiosError } from 'axios';
import type { AttendanceEvent, PushAttendanceBody } from './types';

export interface PushClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

/**
 * Default batch size for `pushEventsBatched`. Chosen so a typical 200-event
 * payload (~50KB) sits well under the NestJS default body-parser limit
 * (100KB) — initial syncs of thousands of events still go through.
 */
export const DEFAULT_BATCH_SIZE = 200;

export interface BatchedPushResult {
  /** How many events at the head of the array were pushed successfully. */
  success: number;
  /** First batch error encountered. Undefined if all batches succeeded. */
  error?: Error;
}

export async function pushEvents(
  cfg: PushClientConfig,
  events: AttendanceEvent[],
): Promise<void> {
  const body: PushAttendanceBody = {
    token: cfg.token,
    events,
  };
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/attendance-devices/push`;
  const start = Date.now();
  try {
    await axios.post(url, body, { timeout: cfg.timeoutMs ?? 30_000 });
    // Success is silent — caller (poll cycle) logs the aggregate count.
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const data = err.response?.data;
      const detail = typeof data === 'string' ? data : JSON.stringify(data ?? err.message);
      console.error(
        `[chr-client] ✗ ${url} HTTP ${status ?? '???'} (${Date.now() - start}ms): ${detail}`,
      );
      throw new Error(
        `C-HR push failed${status ? ` (HTTP ${status})` : ''}: ${detail}`,
      );
    }
    console.error(
      `[chr-client] ✗ ${url} (${Date.now() - start}ms):`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export interface PingResult {
  deviceId: string;
  lastSeenAt: string;
}

/**
 * Connectivity check — POST `/attendance-devices/ping` with just the JWT.
 * Server verifies the token and bumps `lastSeenAt`. Returns the resolved
 * deviceId so the bridge can confirm token validity.
 */
export async function pingConnection(cfg: PushClientConfig): Promise<PingResult> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/attendance-devices/ping`;
  const start = Date.now();
  try {
    const res = await axios.post<{ data: PingResult } | PingResult>(
      url,
      { token: cfg.token },
      { timeout: cfg.timeoutMs ?? 10_000 },
    );
    // BE wraps responses in { success, data, ... }; accept either shape.
    const body = res.data as PingResult | { data: PingResult };
    return 'data' in body && typeof body.data === 'object' ? body.data : (body as PingResult);
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const data = err.response?.data;
      const detail = typeof data === 'string' ? data : JSON.stringify(data ?? err.message);
      console.error(
        `[chr-client] ✗ PING ${url} HTTP ${status ?? '???'} (${Date.now() - start}ms): ${detail}`,
      );
      throw new Error(
        `Ping failed${status ? ` (HTTP ${status})` : ''}: ${detail}`,
      );
    }
    console.error(
      `[chr-client] ✗ PING ${url} (${Date.now() - start}ms):`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

/**
 * Push `events` in fixed-size batches. Stops at the first batch failure and
 * returns how many leading events were pushed — caller decides whether to
 * enqueue the rest, advance cursor partially, etc.
 */
export async function pushEventsBatched(
  cfg: PushClientConfig,
  events: AttendanceEvent[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<BatchedPushResult> {
  let success = 0;
  for (let i = 0; i < events.length; i += batchSize) {
    const chunk = events.slice(i, i + batchSize);
    try {
      await pushEvents(cfg, chunk);
      success += chunk.length;
    } catch (err) {
      return {
        success,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
  return { success };
}
