import { getAllConfig, setConfigMany } from '../db/repo';

export const ConfigKeys = {
  /** Full URL where the bridge POSTs `{ token, events[] }`. */
  PushUrl: 'api.push_url',
  /** Optional full URL for connectivity checks (`{ token }` body). If empty,
   *  the Connect button posts an empty events array to PushUrl instead. */
  PingUrl: 'api.ping_url',
  PollIntervalMin: 'poll.interval_min',
  SessionSecret: 'session.secret',
  AutostartEnabled: 'system.autostart_enabled',
} as const;

export interface SharedConfig {
  pushUrl: string;
  pingUrl?: string;
  pollIntervalMin: number;
}

export interface SharedConfigSlots {
  pushUrl?: string;
  pingUrl?: string;
  pollIntervalMin?: number;
}

export async function readSharedConfig(): Promise<SharedConfigSlots> {
  const all = await getAllConfig();
  return {
    pushUrl: all[ConfigKeys.PushUrl],
    pingUrl: all[ConfigKeys.PingUrl],
    pollIntervalMin: all[ConfigKeys.PollIntervalMin]
      ? Number(all[ConfigKeys.PollIntervalMin])
      : undefined,
  };
}

export function isSharedComplete(slots: SharedConfigSlots): slots is SharedConfig {
  return Boolean(slots.pushUrl && slots.pollIntervalMin);
}

/**
 * On first start, seed shared config from env if DB is empty. Per-device
 * settings (host, port, token) are not env-seeded — admins register devices
 * through the UI.
 */
export async function seedConfigFromEnvIfEmpty(): Promise<void> {
  const all = await getAllConfig();
  if (Object.keys(all).length > 0) return;
  const env = process.env;
  const seed: Record<string, string> = {};
  if (env.PUSH_URL) seed[ConfigKeys.PushUrl] = env.PUSH_URL;
  if (env.PING_URL) seed[ConfigKeys.PingUrl] = env.PING_URL;
  if (env.POLL_INTERVAL_MIN) seed[ConfigKeys.PollIntervalMin] = env.POLL_INTERVAL_MIN;
  if (!seed[ConfigKeys.PollIntervalMin]) seed[ConfigKeys.PollIntervalMin] = '5';
  if (Object.keys(seed).length > 0) {
    await setConfigMany(seed);
  }
}
