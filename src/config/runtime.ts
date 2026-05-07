import { getAllConfig, setConfigMany } from '../db/repo';

export const ConfigKeys = {
  ChrApiUrl: 'chr.api_url',
  PollIntervalMin: 'poll.interval_min',
  SessionSecret: 'session.secret',
  AutostartEnabled: 'system.autostart_enabled',
} as const;

export interface SharedConfig {
  chrApiUrl: string;
  pollIntervalMin: number;
}

export interface SharedConfigSlots {
  chrApiUrl?: string;
  pollIntervalMin?: number;
}

export async function readSharedConfig(): Promise<SharedConfigSlots> {
  const all = await getAllConfig();
  return {
    chrApiUrl: all[ConfigKeys.ChrApiUrl],
    pollIntervalMin: all[ConfigKeys.PollIntervalMin]
      ? Number(all[ConfigKeys.PollIntervalMin])
      : undefined,
  };
}

export function isSharedComplete(slots: SharedConfigSlots): slots is SharedConfig {
  return Boolean(slots.chrApiUrl && slots.pollIntervalMin);
}

/**
 * On first start, seed shared config from env if DB is empty. Per-device
 * settings (host, port, deviceId, token) are no longer env-seeded — admins
 * register devices through the UI.
 */
export async function seedConfigFromEnvIfEmpty(): Promise<void> {
  const all = await getAllConfig();
  if (Object.keys(all).length > 0) return;
  const env = process.env;
  const seed: Record<string, string> = {};
  if (env.CHR_API_URL) seed[ConfigKeys.ChrApiUrl] = env.CHR_API_URL;
  if (env.POLL_INTERVAL_MIN) seed[ConfigKeys.PollIntervalMin] = env.POLL_INTERVAL_MIN;
  if (!seed[ConfigKeys.PollIntervalMin]) seed[ConfigKeys.PollIntervalMin] = '5';
  if (Object.keys(seed).length > 0) {
    await setConfigMany(seed);
  }
}
