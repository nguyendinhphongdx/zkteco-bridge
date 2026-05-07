import * as fs from 'node:fs';
import * as path from 'node:path';

import { Sequelize } from 'sequelize';

import { bootstrapModels, defineModels } from './models';

let sequelize: Sequelize | null = null;

export interface DbConfig {
  dataDir: string;
}

export async function openDb(cfg: DbConfig): Promise<Sequelize> {
  if (sequelize) return sequelize;

  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const file = path.join(cfg.dataDir, 'zk-bridge.db');

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: file,
    logging: false,
  });

  defineModels(sequelize);
  await bootstrapModels();

  return sequelize;
}

export function getSequelize(): Sequelize {
  if (!sequelize) throw new Error('DB not opened. Call openDb() first.');
  return sequelize;
}

export async function closeDb(): Promise<void> {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
  }
}
