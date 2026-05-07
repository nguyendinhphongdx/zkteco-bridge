import axios, { AxiosError } from 'axios';
import type { AttendanceEvent, PushAttendanceBody } from './types';

export interface PushClientConfig {
  /** Full URL the bridge POSTs `{ token, events[] }` to. */
  pushUrl: string;
  /** Optional full URL for connectivity checks. If absent, `pingConnection`
   *  falls back to a push with empty events. */
  pingUrl?: string;
  token: string;
  timeoutMs?: number;
}

/**
 * Default batch size for `pushEventsBatched`. Chosen so a typical 200-event
 * payload (~50KB) sits well under the common 100KB body-parser limit on
 * Node frameworks — initial syncs of thousands of events still go through.
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
  const url = cfg.pushUrl;
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
        `[api] ✗ ${url} HTTP ${status ?? '???'} (${Date.now() - start}ms): ${detail}`,
      );
      throw new Error(`Push failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
    }
    console.error(
      `[api] ✗ ${url} (${Date.now() - start}ms):`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export interface PingResult {
  deviceId?: string;
  lastSeenAt?: string;
}

/**
 * Connectivity check. POSTs `{ token }` to `pingUrl` if configured. If no
 * pingUrl, posts an empty events array to `pushUrl` and treats a 4xx
 * response that mentions `events` as proof the route + auth are reachable.
 *
 * Returns whatever shape the backend echoed (some wrap as
 * `{ success, data }`); empty object if nothing useful to report.
 */
export async function pingConnection(cfg: PushClientConfig): Promise<PingResult> {
  if (cfg.pingUrl) {
    return postPing(cfg.pingUrl, cfg);
  }
  // Fallback: try push with empty array. Backends that validate `events:
  // ArrayNotEmpty` will respond 4xx — that is enough proof the URL + token
  // are reachable.
  try {
    await pushEvents(cfg, []);
    return {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/HTTP 4\d\d/.test(msg) && /events|empty|array/i.test(msg)) return {};
    throw err;
  }
}

async function postPing(url: string, cfg: PushClientConfig): Promise<PingResult> {
  const start = Date.now();
  try {
    const res = await axios.post<PingResult | { data: PingResult }>(
      url,
      { token: cfg.token },
      { timeout: cfg.timeoutMs ?? 10_000 },
    );
    // Some backends wrap responses as { success, data, ... }; accept either.
    const body = res.data as PingResult | { data: PingResult };
    return 'data' in body && typeof body.data === 'object'
      ? (body.data as PingResult)
      : (body as PingResult);
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status;
      const data = err.response?.data;
      const detail = typeof data === 'string' ? data : JSON.stringify(data ?? err.message);
      console.error(
        `[api] ✗ PING ${url} HTTP ${status ?? '???'} (${Date.now() - start}ms): ${detail}`,
      );
      throw new Error(`Ping failed${status ? ` (HTTP ${status})` : ''}: ${detail}`);
    }
    console.error(
      `[api] ✗ PING ${url} (${Date.now() - start}ms):`,
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
