import { isSharedComplete, readSharedConfig } from '../config/runtime';
import {
  countQueuedEvents,
  deleteQueuedEvents,
  enqueueEvents,
  finishCycle,
  listEnabledDevices,
  listQueuedEvents,
  markQueuedFailure,
  rotateCycleLogs,
  startCycle,
  updateDeviceCursor,
  type DeviceView,
} from '../db/repo';

import { pushEventsBatched } from './api-client';
import { translateZkRecord } from './translate';
import type { AttendanceEvent } from './types';
import { fetchAttendances } from './zk-client';

// Cap số record gửi mỗi cycle. Bridge không filter cursor — pull bao
// nhiêu lib trả, take last N (newest), push hết. Backend dedup qua unique
// (deviceId, eventLogId) → push trùng = no-op an toàn. Self-healing khi
// cursor lệch / device reset / partial read.
const LIMIT_RECENT_RECORDS = 2000;

export interface DeviceCycleResult {
  deviceId: number;
  deviceName: string;
  status: 'ok' | 'zk_error' | 'api_error' | 'partial';
  pulled: number;
  pushed: number;
  queued: number;
  message?: string;
}

export interface CycleSummary {
  ranAt: Date;
  apiUrlMissing: boolean;
  noDevices: boolean;
  results: DeviceCycleResult[];
}

export async function runCycle(): Promise<CycleSummary> {
  const summary: CycleSummary = {
    ranAt: new Date(),
    apiUrlMissing: false,
    noDevices: false,
    results: [],
  };

  const shared = await readSharedConfig();
  if (!isSharedComplete(shared)) {
    summary.apiUrlMissing = true;
    return summary;
  }

  const devices = await listEnabledDevices();
  if (devices.length === 0) {
    summary.noDevices = true;
    return summary;
  }

  for (const device of devices) {
    const result = await runDeviceCycle(shared.pushUrl, shared.pingUrl, device);
    summary.results.push(result);
  }
  await rotateCycleLogs();
  return summary;
}

async function runDeviceCycle(
  pushUrl: string,
  pingUrl: string | undefined,
  device: DeviceView,
): Promise<DeviceCycleResult> {
  console.log(
    `[poll] device "${device.name}" (id=${device.id}) — cursor=${device.lastEventLogId}, host=${device.host}:${device.port}`,
  );
  const cycleId = await startCycle(device.id, device.name);
  let pulled = 0;
  let pushed = 0;
  let queuedNow = 0;

  // 1. Drain offline queue first (chunked — large drains can exceed BE body limit).
  const queued = await listQueuedEvents(device.id, 500);
  if (queued.length > 0) {
    console.log(`[poll] device "${device.name}" — draining ${queued.length} queued event(s)`);
    const events = queued.map((q) => JSON.parse(q.payloadJson) as AttendanceEvent);
    const drainResult = await pushEventsBatched(
      { pushUrl, pingUrl, token: device.deviceToken },
      events,
    );
    const successIds = queued.slice(0, drainResult.success).map((q) => q.id);
    const failedIds = queued.slice(drainResult.success).map((q) => q.id);
    await deleteQueuedEvents(successIds);
    pushed += drainResult.success;

    if (drainResult.error) {
      const msg = drainResult.error.message;
      await markQueuedFailure(failedIds, msg);
      await finishCycle(cycleId, {
        eventsPolled: 0,
        eventsPushed: pushed,
        eventsQueued: failedIds.length,
        status: 'api_error',
        errorMessage: msg,
      });
      await updateDeviceCursor(device.id, { lastStatus: 'api_error', lastError: msg });
      return {
        deviceId: device.id,
        deviceName: device.name,
        status: 'api_error',
        pulled: 0,
        pushed,
        queued: failedIds.length,
        message: msg,
      };
    }
  }

  // 2. Poll device for new records.
  const zkStart = Date.now();
  let records;
  try {
    const fetched = await fetchAttendances(device.host, device.port);
    records = fetched.data;
    const zkMs = Date.now() - zkStart;
    if (fetched.err) {
      console.warn(
        `[poll] "${device.name}" partial read after ${zkMs}ms — ${fetched.err} (got ${records.length}); cursor stays put, retry next cycle.`,
      );
    } else {
      console.log(
        `[poll] "${device.name}" pulled ${records.length} from ZK in ${zkMs}ms`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishCycle(cycleId, {
      eventsPolled: 0,
      eventsPushed: pushed,
      eventsQueued: 0,
      status: 'zk_error',
      errorMessage: msg,
    });
    await updateDeviceCursor(device.id, { lastStatus: 'zk_error', lastError: msg });
    return {
      deviceId: device.id,
      deviceName: device.name,
      status: 'zk_error',
      pulled: 0,
      pushed,
      queued: 0,
      message: msg,
    };
  }

  pulled = records.length;
  const usable = records.filter((r) => r.deviceUserId && r.deviceUserId !== '0');
  // Cap newest LIMIT_RECENT (lib returns oldest-first, slice(-N) = newest),
  // then keep only events past the cursor. Server still dedups via unique
  // (deviceId, eventLogId) as a safety net for the rare double-send.
  const recent = usable.slice(-LIMIT_RECENT_RECORDS);
  const fresh = recent
    .filter((r) => Number(r.userSn) > device.lastEventLogId)
    .map(translateZkRecord);
  console.log(
    `[poll] "${device.name}" — ${usable.length} usable, ${recent.length} recent, ${fresh.length} fresh after cursor=${device.lastEventLogId}`,
  );

  if (fresh.length === 0) {
    await finishCycle(cycleId, {
      eventsPolled: pulled,
      eventsPushed: pushed,
      eventsQueued: 0,
      status: 'ok',
    });
    await updateDeviceCursor(device.id, {
      lastStatus: 'ok',
      lastError: null,
      bumpSyncAt: true,
    });
    return {
      deviceId: device.id,
      deviceName: device.name,
      status: 'ok',
      pulled,
      pushed,
      queued: 0,
    };
  }

  // 3. Push fresh events (chunked). On partial failure, enqueue the tail and
  //    still advance cursor — backend dedupes by (deviceId, eventLogId) so a
  //    rare double-send is safe; the queue will retry on the next cycle.
  const pushResult = await pushEventsBatched(
    { pushUrl, pingUrl, token: device.deviceToken },
    fresh,
  );
  pushed += pushResult.success;
  const maxSn = Math.max(...fresh.map((e) => Number(e.eventLogId)));

  if (!pushResult.error) {
    await finishCycle(cycleId, {
      eventsPolled: pulled,
      eventsPushed: pushed,
      eventsQueued: 0,
      status: 'ok',
    });
    await updateDeviceCursor(device.id, {
      lastEventLogId: maxSn,
      lastStatus: 'ok',
      lastError: null,
      bumpSyncAt: true,
    });
    return {
      deviceId: device.id,
      deviceName: device.name,
      status: 'ok',
      pulled,
      pushed,
      queued: 0,
    };
  }

  // Partial / full push failure → enqueue the tail.
  {
    const msg = pushResult.error.message;
    const failed = fresh.slice(pushResult.success);
    await enqueueEvents(
      device.id,
      failed.map((e) => JSON.stringify(e)),
    );
    queuedNow = failed.length;
    const status = pushed > 0 ? 'partial' : 'api_error';
    await finishCycle(cycleId, {
      eventsPolled: pulled,
      eventsPushed: pushed,
      eventsQueued: queuedNow,
      status,
      errorMessage: msg,
    });
    await updateDeviceCursor(device.id, {
      lastEventLogId: maxSn,
      lastStatus: status,
      lastError: msg,
    });
    return {
      deviceId: device.id,
      deviceName: device.name,
      status,
      pulled,
      pushed,
      queued: queuedNow,
      message: msg,
    };
  }
}

export async function totalQueuedAcrossDevices(): Promise<number> {
  return countQueuedEvents();
}
