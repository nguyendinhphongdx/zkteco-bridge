import { loadBootEnv } from '../config/env';
import { closeDb, openDb } from '../db/index';
import { Device } from '../db/models';
import { translateZkRecord } from '../poll/translate';
import type { ZkAttendanceRecord } from '../poll/types';
import { fetchAttendances } from '../poll/zk-client';

interface CliArgs {
  device?: string;
  limit: number;
  raw: boolean;
}

const DEFAULT_LIMIT = 20;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: DEFAULT_LIMIT, raw: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--device':
      case '-d':
        args.device = v;
        i++;
        break;
      case '--limit':
      case '-n':
        args.limit = Math.max(1, parseInt(v ?? '', 10) || DEFAULT_LIMIT);
        i++;
        break;
      case '--raw':
        args.raw = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      default:
        if (k.startsWith('-')) {
          console.error(`Unknown option: ${k}`);
          printHelp();
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage: recent-events [options]

Fetch the most recent attendance records straight from a ZK device — useful
for sanity-checking that a device is reachable, returning data, and that
employee codes line up with what's in C-HR.

Options:
  -d, --device <id|name>   Which device to query. Optional when only one
                           device is configured.
  -n, --limit <N>          Last N records (default: ${DEFAULT_LIMIT}).
  --raw                    Print raw ZK fields (userSn, state) instead of
                           the translated IN/OUT mapping the bridge pushes.
  -h, --help               Show this help.

Examples:
  pnpm --filter @c-hr/zk-bridge recent-events
  pnpm --filter @c-hr/zk-bridge recent-events --device "Cửa chính"
  pnpm --filter @c-hr/zk-bridge recent-events -n 50 --raw`);
}

async function selectDevice(filter?: string): Promise<Device> {
  const devices = await Device.findAll({ order: [['id', 'ASC']] });
  if (devices.length === 0) {
    throw new Error('No devices configured. Add one through the UI first.');
  }
  if (!filter) {
    if (devices.length === 1) return devices[0];
    const list = devices.map((d) => `#${d.id} "${d.name}"`).join(', ');
    throw new Error(`Multiple devices configured (${list}). Pass --device <id|name>.`);
  }
  const numeric = Number(filter);
  if (Number.isFinite(numeric)) {
    const byId = devices.find((d) => d.id === numeric);
    if (byId) return byId;
  }
  const byName = devices.find((d) => d.name === filter);
  if (byName) return byName;
  throw new Error(
    `Device "${filter}" not found. Available: ${devices.map((d) => `#${d.id} ${d.name}`).join(', ')}`,
  );
}

function formatTime(t: string | Date): string {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printRaw(rows: ZkAttendanceRecord[]): void {
  console.log('');
  console.log(
    `  ${pad('userSn', 11)}  ${pad('employeeCode', 14)}  ${pad('recordTime', 20)}  state`,
  );
  console.log(
    `  ${'-'.repeat(11)}  ${'-'.repeat(14)}  ${'-'.repeat(20)}  -----`,
  );
  for (const r of rows) {
    console.log(
      `  ${pad(String(r.userSn), 11)}  ${pad(r.deviceUserId ?? '', 14)}  ${pad(formatTime(r.recordTime), 20)}  ${r.state}`,
    );
  }
}

function printTranslated(rows: ZkAttendanceRecord[]): void {
  console.log('');
  console.log(
    `  ${pad('eventLogId', 11)}  ${pad('employeeCode', 14)}  ${pad('timestamp', 20)}  type`,
  );
  console.log(
    `  ${'-'.repeat(11)}  ${'-'.repeat(14)}  ${'-'.repeat(20)}  ----`,
  );
  for (const r of rows) {
    const e = translateZkRecord(r);
    console.log(
      `  ${pad(e.eventLogId, 11)}  ${pad(e.employeeCode ?? '', 14)}  ${pad(formatTime(e.timestamp), 20)}  ${e.type}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const boot = loadBootEnv();
  await openDb({ dataDir: boot.dataDir });
  try {
    const device = await selectDevice(args.device);
    console.log(
      `[recent-events] device #${device.id} "${device.name}" @ ${device.host}:${device.port}`,
    );
    console.log('[recent-events] fetching attendances…');
    const fetched = await fetchAttendances(device.host, device.port);
    if (fetched.err) {
      console.warn(`[recent-events] WARN partial read — ${fetched.err}`);
    }
    const all = fetched.data;
    // ZK firmwares append on `userSn`, so a numeric desc sort gives newest
    // first; tie-break on recordTime when sn isn't strictly monotonic.
    const sorted = [...all].sort((a, b) => {
      const dn = Number(b.userSn) - Number(a.userSn);
      if (dn !== 0) return dn;
      return new Date(b.recordTime).getTime() - new Date(a.recordTime).getTime();
    });
    const recent = sorted.slice(0, args.limit);
    if (recent.length === 0) {
      console.log('[recent-events] device returned 0 records.');
      return;
    }
    if (args.raw) printRaw(recent);
    else printTranslated(recent);
    console.log('');
    console.log(
      `[recent-events] showed ${recent.length} of ${all.length} record(s) on device.`,
    );
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error('[recent-events] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
