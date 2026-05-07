import { loadBootEnv } from '../config/env';
import { ConfigKeys } from '../config/runtime';
import { closeDb, openDb } from '../db/index';
import { Config, User } from '../db/models';

async function main(): Promise<void> {
  const boot = loadBootEnv();
  console.log(`[reset-user] data dir: ${boot.dataDir}`);
  await openDb({ dataDir: boot.dataDir });
  const before = await User.count();
  await User.destroy({ where: {} });
  // Drop the session secret too — any outstanding cookies become invalid.
  await Config.destroy({ where: { key: ConfigKeys.SessionSecret } });
  await closeDb();
  console.log(`[reset-user] removed ${before} user row(s). Next start will redirect to /setup.`);
}

main().catch((err) => {
  console.error('[reset-user] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
