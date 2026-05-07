import { serve } from '@hono/node-server';

import { loadBootEnv } from './config/env';
import { seedConfigFromEnvIfEmpty } from './config/runtime';
import { closeDb, openDb } from './db/index';
import { runOnce, startScheduler, stopScheduler } from './poll/scheduler';
import { createServer } from './server/server';

// Prefix every console line with an ISO timestamp so log files / `pm2 logs`
// / `docker compose logs` stay aligned with cycle timing. We monkey-patch
// rather than refactoring every call site (~100s of console.log spread
// across poll, scheduler, ZK client, server, ...).
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
const _origWarn = console.warn.bind(console);
const ts = (): string => `[${new Date().toISOString()}]`;
console.log = (...args: unknown[]): void => _origLog(ts(), ...args);
console.error = (...args: unknown[]): void => _origErr(ts(), ...args);
console.warn = (...args: unknown[]): void => _origWarn(ts(), ...args);

// Defensive top-level handlers. Bridge is a long-running daemon — a stray
// promise rejection from the ZK protocol layer (e.g. a stale `waitForPacket`
// timer firing after socket close) must NOT crash the process. We log it and
// keep the scheduler running; the next cycle will reconnect and try again.
process.on('unhandledRejection', (reason) => {
  console.error(
    '[zk-bridge] unhandled rejection — kept process alive:',
    reason instanceof Error ? reason.stack ?? reason.message : reason,
  );
});
process.on('uncaughtException', (err) => {
  console.error('[zk-bridge] uncaught exception — kept process alive:', err.stack ?? err.message);
});

async function main(): Promise<void> {
  const boot = loadBootEnv();
  console.log(`[zk-bridge] data dir: ${boot.dataDir}`);
  await openDb({ dataDir: boot.dataDir });
  await seedConfigFromEnvIfEmpty();

  const args = process.argv.slice(2);
  if (args.includes('--once')) {
    await runOnce();
    await closeDb();
    return;
  }

  const app = createServer();
  const httpServer = serve({
    fetch: app.fetch,
    port: boot.port,
    hostname: boot.bindHost,
  });
  console.log(`[zk-bridge] UI listening on http://${boot.bindHost}:${boot.port}`);

  await startScheduler();
  console.log(`[zk-bridge] running. Press Ctrl+C to stop.`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[zk-bridge] ${signal} received, shutting down ...`);
    await stopScheduler();
    httpServer.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[zk-bridge] FATAL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
