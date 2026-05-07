import { Op, QueryTypes } from 'sequelize';

import { getSequelize } from './index';
import {
  Config,
  CycleLog,
  Device,
  EventQueue,
  type CycleStatus,
  type DeviceLastStatus,
} from './models';

// ---------- config (key/value) ----------

export async function getConfig(key: string): Promise<string | undefined> {
  const row = await Config.findByPk(key);
  return row?.value;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await Config.upsert({ key, value });
}

export async function setConfigMany(entries: Record<string, string>): Promise<void> {
  await getSequelize().transaction(async (tx) => {
    for (const [key, value] of Object.entries(entries)) {
      await Config.upsert({ key, value }, { transaction: tx });
    }
  });
}

export async function getAllConfig(): Promise<Record<string, string>> {
  const rows = await Config.findAll();
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ---------- devices ----------

export interface DeviceView {
  id: number;
  name: string;
  host: string;
  port: number;
  deviceToken: string;
  lastEventLogId: number;
  lastSyncAt: Date | null;
  lastStatus: DeviceLastStatus;
  lastError: string | null;
  enabled: boolean;
}

function toView(d: Device): DeviceView {
  return {
    id: d.id,
    name: d.name,
    host: d.host,
    port: d.port,
    deviceToken: d.deviceToken,
    lastEventLogId: d.lastEventLogId,
    lastSyncAt: d.lastSyncAt ?? null,
    lastStatus: d.lastStatus,
    lastError: d.lastError ?? null,
    enabled: d.enabled,
  };
}

export async function listDevices(): Promise<DeviceView[]> {
  const rows = await Device.findAll({ order: [['id', 'ASC']] });
  return rows.map(toView);
}

export async function listEnabledDevices(): Promise<DeviceView[]> {
  const rows = await Device.findAll({ where: { enabled: true }, order: [['id', 'ASC']] });
  return rows.map(toView);
}

export async function getDevice(id: number): Promise<DeviceView | null> {
  const row = await Device.findByPk(id);
  return row ? toView(row) : null;
}

export interface DeviceInput {
  name: string;
  host: string;
  port: number;
  deviceToken: string;
  enabled: boolean;
}

export async function createDevice(input: DeviceInput): Promise<DeviceView> {
  const row = await Device.create({ ...input, updatedAt: new Date() });
  return toView(row);
}

export async function updateDevice(id: number, input: Partial<DeviceInput>): Promise<void> {
  await Device.update({ ...input, updatedAt: new Date() }, { where: { id } });
}

export async function deleteDevice(id: number): Promise<void> {
  await getSequelize().transaction(async (tx) => {
    await EventQueue.destroy({ where: { deviceId: id }, transaction: tx });
    await CycleLog.destroy({ where: { deviceId: id }, transaction: tx });
    await Device.destroy({ where: { id }, transaction: tx });
  });
}

export async function updateDeviceCursor(
  id: number,
  patch: {
    lastEventLogId?: number;
    lastStatus?: DeviceLastStatus;
    lastError?: string | null;
    bumpSyncAt?: boolean;
  },
): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.lastEventLogId !== undefined) update.lastEventLogId = patch.lastEventLogId;
  if (patch.lastStatus !== undefined) update.lastStatus = patch.lastStatus;
  if (patch.lastError !== undefined) update.lastError = patch.lastError;
  if (patch.bumpSyncAt) update.lastSyncAt = new Date();
  await Device.update(update, { where: { id } });
}

export async function resetDeviceCursor(id: number): Promise<void> {
  await Device.update(
    { lastEventLogId: 0, lastSyncAt: null, updatedAt: new Date() },
    { where: { id } },
  );
}

// ---------- event_queue (per device) ----------

export interface QueuedEvent {
  id: number;
  deviceId: number;
  payloadJson: string;
  enqueuedAt: Date;
  attempts: number;
  lastError: string | null;
}

export async function enqueueEvents(deviceId: number, payloads: string[]): Promise<void> {
  if (payloads.length === 0) return;
  await EventQueue.bulkCreate(payloads.map((p) => ({ deviceId, payloadJson: p })));
}

export async function listQueuedEvents(deviceId: number, limit = 500): Promise<QueuedEvent[]> {
  const rows = await EventQueue.findAll({
    where: { deviceId },
    order: [['id', 'ASC']],
    limit,
  });
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.deviceId,
    payloadJson: r.payloadJson,
    enqueuedAt: r.enqueuedAt,
    attempts: r.attempts,
    lastError: r.lastError,
  }));
}

export async function deleteQueuedEvents(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await EventQueue.destroy({ where: { id: { [Op.in]: ids } } });
}

export async function markQueuedFailure(ids: number[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await EventQueue.update(
    { attempts: getSequelize().literal('attempts + 1') as unknown as number, lastError: error },
    { where: { id: { [Op.in]: ids } } },
  );
}

export async function countQueuedEvents(deviceId?: number): Promise<number> {
  return EventQueue.count(deviceId === undefined ? {} : { where: { deviceId } });
}

// ---------- cycle_log ----------

export interface CycleLogView {
  id: number;
  deviceId: number;
  deviceName: string;
  startedAt: Date;
  finishedAt: Date | null;
  eventsPolled: number | null;
  eventsPushed: number | null;
  eventsQueued: number | null;
  status: CycleStatus;
  errorMessage: string | null;
}

export async function startCycle(deviceId: number, deviceName: string): Promise<number> {
  const row = await CycleLog.create({
    deviceId,
    deviceName,
    startedAt: new Date(),
    status: 'ok',
  });
  return row.id;
}

export async function finishCycle(
  id: number,
  data: {
    eventsPolled: number;
    eventsPushed: number;
    eventsQueued: number;
    status: CycleStatus;
    errorMessage?: string | null;
  },
): Promise<void> {
  await CycleLog.update(
    {
      finishedAt: new Date(),
      eventsPolled: data.eventsPolled,
      eventsPushed: data.eventsPushed,
      eventsQueued: data.eventsQueued,
      status: data.status,
      errorMessage: data.errorMessage ?? null,
    },
    { where: { id } },
  );
}

export async function listCycleLogs(
  opts: { limit?: number; offset?: number; deviceId?: number } = {},
): Promise<CycleLogView[]> {
  const { limit = 100, offset = 0, deviceId } = opts;
  const rows = await CycleLog.findAll({
    where: deviceId === undefined ? {} : { deviceId },
    order: [['id', 'DESC']],
    limit,
    offset,
  });
  return rows.map((r) => ({
    id: r.id,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    eventsPolled: r.eventsPolled,
    eventsPushed: r.eventsPushed,
    eventsQueued: r.eventsQueued,
    status: r.status,
    errorMessage: r.errorMessage,
  }));
}

export async function rotateCycleLogs(maxRows = 1000): Promise<void> {
  await getSequelize().query(
    `DELETE FROM cycle_log
     WHERE id <= COALESCE((SELECT id FROM cycle_log ORDER BY id DESC LIMIT 1 OFFSET :n), 0)`,
    { replacements: { n: maxRows }, type: QueryTypes.DELETE },
  );
}
