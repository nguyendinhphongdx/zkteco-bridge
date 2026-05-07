import * as crypto from 'node:crypto';

import { ConfigKeys } from '../config/runtime';
import { getConfig, setConfig } from '../db/repo';

export const SESSION_COOKIE = 'zkb_sess';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function getSessionSecret(): Promise<string> {
  let secret = await getConfig(ConfigKeys.SessionSecret);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await setConfig(ConfigKeys.SessionSecret, secret);
  }
  return secret;
}

function hmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function packSession(userId: number, secret: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${hmac(payload, secret)}`;
}

export interface SessionData {
  userId: number;
  expiresAt: number;
}

export function unpackSession(cookie: string, secret: string): SessionData | null {
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, mac] = parts;
  const payload = `${uid}.${exp}`;
  const expected = hmac(payload, secret);
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))
  ) {
    return null;
  }
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return { userId: Number(uid), expiresAt };
}
