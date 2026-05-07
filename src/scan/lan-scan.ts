import * as net from 'node:net';
import * as os from 'node:os';

import { probeZkDevice, type ZkDeviceInfo } from '../poll/zk-client';

export interface ScanCandidate {
  host: string;
  port: number;
  info: ZkDeviceInfo | null;
}

/**
 * Two-phase LAN scan:
 *   1. Fast TCP probe (~500ms each, /24 in <2s with 64 parallel sockets) finds
 *      hosts with the port open.
 *   2. For each open host, run a real ZK protocol probe to fetch device name,
 *      serial, firmware, etc. — distinguishes a true ZKTeco from any other
 *      service on the same port.
 */
export async function scanSubnetFor(
  port = 4370,
  tcpTimeoutMs = 500,
  tcpConcurrency = 64,
  zkTimeoutMs = 8_000,
): Promise<ScanCandidate[]> {
  const subnets = listIPv4Subnets();
  const candidates = subnets.flatMap(expand24);
  const open: string[] = [];

  let cursor = 0;
  async function tcpWorker(): Promise<void> {
    while (cursor < candidates.length) {
      const idx = cursor++;
      const host = candidates[idx];
      if (await probeTcp(host, port, tcpTimeoutMs)) open.push(host);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(tcpConcurrency, candidates.length) }, tcpWorker),
  );
  open.sort(compareIp);

  // ZK protocol probe — must be sequential. ZKTeco firmware only accepts a
  // single active connection per device, and parallel probes against the
  // same host (or even adjacent ones on a small LAN) frequently time out.
  const results: ScanCandidate[] = [];
  for (const host of open) {
    try {
      const info = await probeZkDevice(host, port, zkTimeoutMs);
      results.push({ host, port, info });
    } catch (err) {
      results.push({
        host,
        port,
        info: { reachable: false, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  results.sort((a, b) => compareIp(a.host, b.host));
  return results;
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try {
      sock.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

interface Subnet {
  prefix: string;
  selfIp: string;
}

function listIPv4Subnets(): Subnet[] {
  const out: Subnet[] = [];
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    if (!list) continue;
    for (const a of list) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.netmask !== '255.255.255.0') continue;
      const parts = a.address.split('.');
      if (parts.length !== 4) continue;
      out.push({ prefix: `${parts[0]}.${parts[1]}.${parts[2]}.`, selfIp: a.address });
    }
  }
  return out;
}

function expand24(s: Subnet): string[] {
  const result: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${s.prefix}${i}`;
    if (ip !== s.selfIp) result.push(ip);
  }
  return result;
}

function compareIp(a: string, b: string): number {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    if (ap[i] !== bp[i]) return ap[i] - bp[i];
  }
  return 0;
}
