import bcrypt from 'bcryptjs';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { getAutostartProvider } from '../boot/index';
import { ConfigKeys, isSharedComplete, readSharedConfig } from '../config/runtime';
import {
  createDevice,
  deleteDevice as deleteDeviceRow,
  getConfig,
  getDevice,
  listCycleLogs,
  listDevices,
  resetDeviceCursor,
  setConfig,
  setConfigMany,
  updateDevice,
  type DeviceInput,
} from '../db/repo';
import { User } from '../db/models';
import { pingConnection } from '../poll/api-client';
import { translateZkRecord } from '../poll/translate';
import { fetchAttendances } from '../poll/zk-client';
import { restartScheduler, runOnce } from '../poll/scheduler';
import { totalQueuedAcrossDevices } from '../poll/poll';
import { scanSubnetFor, type ScanCandidate } from '../scan/lan-scan';

import {
  getSessionSecret,
  packSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  unpackSession,
} from './session';
import { renderLoginPage, renderSetupPage } from './ui/auth-pages';
import { renderApiConfigPage, renderSystemConfigPage } from './ui/config-pages';
import { renderDashboard } from './ui/dashboard-page';
import { renderDeviceEventsPage, type DeviceEventRow } from './ui/device-events-page';
import { renderDevicesPage } from './ui/devices-page';
import { renderLogsPage } from './ui/logs-page';

interface SessionVars {
  Variables: { userId: number };
}

const PUBLIC_PATHS = new Set(['/setup', '/login']);

async function userCount(): Promise<number> {
  return User.count();
}

async function setSessionCookie(c: Context, userId: number): Promise<void> {
  const secret = await getSessionSecret();
  const value = packSession(userId, secret);
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function parseDeviceForm(form: Record<string, unknown>): DeviceInput | string {
  const name = String(form.name ?? '').trim();
  const host = String(form.host ?? '').trim();
  const port = Number(form.port);
  const deviceToken = String(form.deviceToken ?? '').trim();
  const enabled = form.enabled === '1' || form.enabled === 'on' || form.enabled === true;

  if (!name) return 'Name is required.';
  if (!host) return 'Device IP is required.';
  if (!Number.isFinite(port) || port < 1 || port > 65535) return 'Invalid port.';
  if (!deviceToken) return 'Device token is required.';

  return { name, host, port, deviceToken, enabled };
}

let lastScanResults: ScanCandidate[] = [];
let lastScanRan = false;

const EVENTS_PAGE_SIZE = 50;

export function createServer(): Hono<SessionVars> {
  const app = new Hono<SessionVars>();

  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (PUBLIC_PATHS.has(path) || path.startsWith('/_static')) {
      return next();
    }
    const count = await userCount();
    if (count === 0) {
      return c.redirect('/setup');
    }
    const cookie = getCookie(c, SESSION_COOKIE);
    if (!cookie) return c.redirect('/login');
    const secret = await getSessionSecret();
    const sess = unpackSession(cookie, secret);
    if (!sess) {
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.redirect('/login');
    }
    c.set('userId', sess.userId);
    return next();
  });

  app.get('/', (c) => c.redirect('/dashboard'));

  // ---------- /setup ----------
  app.get('/setup', async (c) => {
    if ((await userCount()) > 0) return c.redirect('/login');
    return c.html(renderSetupPage());
  });

  app.post('/setup', async (c) => {
    if ((await userCount()) > 0) return c.redirect('/login');
    const form = await c.req.parseBody();
    const username = String(form.username ?? '').trim();
    const password = String(form.password ?? '');
    const confirm = String(form.confirm ?? '');
    if (username.length < 3) {
      return c.html(
        renderSetupPage({ error: { message: 'Username must be at least 3 characters.' } }),
      );
    }
    if (password.length < 8) {
      return c.html(
        renderSetupPage({ error: { message: 'Password must be at least 8 characters.' } }),
      );
    }
    if (password !== confirm) {
      return c.html(renderSetupPage({ error: { message: 'Passwords do not match.' } }));
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash });
    await setSessionCookie(c, user.id);
    return c.redirect('/dashboard');
  });

  // ---------- /login ----------
  app.get('/login', async (c) => {
    if ((await userCount()) === 0) return c.redirect('/setup');
    return c.html(renderLoginPage());
  });

  app.post('/login', async (c) => {
    const form = await c.req.parseBody();
    const username = String(form.username ?? '').trim();
    const password = String(form.password ?? '');
    const user = await User.findOne({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return c.html(
        renderLoginPage({ error: { message: 'Invalid username or password.' }, username }),
      );
    }
    await setSessionCookie(c, user.id);
    return c.redirect('/dashboard');
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/login');
  });

  // ---------- /dashboard ----------
  app.get('/dashboard', async (c) => {
    const shared = await readSharedConfig();
    const devices = await listDevices();
    const totalQueued = await totalQueuedAcrossDevices();
    const recentCycles = await listCycleLogs({ limit: 20 });
    return c.html(
      renderDashboard({
        apiUrlSet: Boolean(shared.pushUrl),
        shared,
        devices,
        totalQueued,
        recentCycles,
      }),
    );
  });

  // ---------- /devices ----------
  app.get('/devices', async (c) => {
    const shared = await readSharedConfig();
    const devices = await listDevices();
    return c.html(
      renderDevicesPage({
        devices,
        scanResults: lastScanResults,
        scanRan: lastScanRan,
        apiUrlSet: Boolean(shared.pushUrl),
      }),
    );
  });

  app.post('/devices', async (c) => {
    const form = await c.req.parseBody();
    const parsed = parseDeviceForm(form as Record<string, unknown>);
    if (typeof parsed === 'string') {
      const devices = await listDevices();
      const shared = await readSharedConfig();
      return c.html(
        renderDevicesPage({
          devices,
          scanResults: lastScanResults,
          scanRan: lastScanRan,
          apiUrlSet: Boolean(shared.pushUrl),
          flash: { kind: 'err', message: parsed },
        }),
      );
    }
    await createDevice(parsed);
    return c.redirect('/devices');
  });

  app.post('/devices/scan', async (c) => {
    try {
      lastScanResults = await scanSubnetFor(4370, 500);
      lastScanRan = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastScanResults = [];
      lastScanRan = true;
      const devices = await listDevices();
      const shared = await readSharedConfig();
      return c.html(
        renderDevicesPage({
          devices,
          scanResults: [],
          scanRan: true,
          apiUrlSet: Boolean(shared.pushUrl),
          flash: { kind: 'err', message: `Scan failed: ${msg}` },
        }),
      );
    }
    return c.redirect('/devices');
  });

  app.post('/devices/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.redirect('/devices');
    const form = await c.req.parseBody();
    const parsed = parseDeviceForm(form as Record<string, unknown>);
    if (typeof parsed === 'string') {
      const devices = await listDevices();
      const shared = await readSharedConfig();
      return c.html(
        renderDevicesPage({
          devices,
          scanResults: lastScanResults,
          scanRan: lastScanRan,
          apiUrlSet: Boolean(shared.pushUrl),
          flash: { kind: 'err', message: parsed },
        }),
      );
    }
    await updateDevice(id, parsed);
    return c.redirect('/devices');
  });

  app.post('/devices/:id/delete', async (c) => {
    const id = Number(c.req.param('id'));
    if (Number.isFinite(id)) await deleteDeviceRow(id);
    return c.redirect('/devices');
  });

  app.post('/devices/:id/reset-cursor', async (c) => {
    const id = Number(c.req.param('id'));
    if (Number.isFinite(id)) await resetDeviceCursor(id);
    return c.redirect(`/devices/${id}/events`);
  });

  app.get('/devices/:id/events', async (c) => {
    const id = Number(c.req.param('id'));
    const device = Number.isFinite(id) ? await getDevice(id) : null;
    if (!device) return c.redirect('/devices');

    const pageRaw = Number(c.req.query('page') ?? '1');
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

    // No cache — fetch fresh on every request. ZK device pulls take
    // seconds for large logs but the trade-off (always-current data, no
    // stale-cache mismatch with fresh fetch errors) is worth it.
    let flash: { kind: 'ok' | 'err'; message: string } | null = null;
    let events: Array<{
      eventLogId: string;
      employeeCode: string;
      timestampIso: string;
      type: 'IN' | 'OUT';
      userSn: number;
    }> = [];
    let fetchMs = 0;

    const fetchStart = Date.now();
    try {
      const fetched = await fetchAttendances(device.host, device.port);
      events = fetched.data
        .filter((r) => r.deviceUserId && r.deviceUserId !== '0')
        .map((r) => {
          const e = translateZkRecord(r);
          return {
            eventLogId: e.eventLogId,
            employeeCode: e.employeeCode,
            timestampIso: e.timestamp,
            type: (e.type ?? 'IN') as 'IN' | 'OUT',
            userSn: Number(r.userSn),
          };
        })
        // Sort by userSn desc; tiebreak on timestamp desc so colliding
        // userSn (rare ZK firmware bug) stay deterministic across refresh.
        .sort((a, b) => {
          if (b.userSn !== a.userSn) return b.userSn - a.userSn;
          return new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime();
        });
      fetchMs = Date.now() - fetchStart;

      if (fetched.err) {
        flash = {
          kind: 'err',
          message: `Stream bị cắt giữa chừng — pull được ${fetched.data.length} record. ZK lib báo: ${fetched.err}. Reload lại.`,
        };
      }
    } catch (err) {
      fetchMs = Date.now() - fetchStart;
      flash = {
        kind: 'err',
        message: `Không lấy được events từ device: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const totalRecords = events.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / EVENTS_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * EVENTS_PAGE_SIZE;
    const sliceRaw = events.slice(offset, offset + EVENTS_PAGE_SIZE);
    const slice: DeviceEventRow[] = sliceRaw.map((e) => ({
      eventLogId: e.eventLogId,
      employeeCode: e.employeeCode,
      timestampIso: e.timestampIso,
      type: e.type,
      pending: e.userSn > device.lastEventLogId,
    }));
    const cursor = device.lastEventLogId;
    const cursorOnPage =
      sliceRaw.length > 0 &&
      sliceRaw[0].userSn >= cursor &&
      sliceRaw[sliceRaw.length - 1].userSn <= cursor;

    return c.html(
      renderDeviceEventsPage({
        device,
        events: slice,
        totalRecords,
        page: safePage,
        pageSize: EVENTS_PAGE_SIZE,
        cursorOnPage,
        cachedAt: null,
        fetchMs,
        flash,
      }),
    );
  });

  app.post('/devices/:id/connect', async (c) => {
    const id = Number(c.req.param('id'));
    const device = Number.isFinite(id) ? await getDevice(id) : null;
    const shared = await readSharedConfig();
    let flash: { kind: 'ok' | 'err'; message: string };
    if (!device || !shared.pushUrl) {
      flash = { kind: 'err', message: 'Device not found, or Push URL is not configured.' };
    } else {
      try {
        const result = await pingConnection({
          pushUrl: shared.pushUrl,
          pingUrl: shared.pingUrl,
          token: device.deviceToken,
        });
        flash = {
          kind: 'ok',
          message: `${device.name}: connected. Backend lastSeenAt updated (deviceId=${result.deviceId}).`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        flash = { kind: 'err', message: `${device.name}: ${msg}` };
      }
    }
    const devices = await listDevices();
    return c.html(
      renderDevicesPage({
        devices,
        scanResults: lastScanResults,
        scanRan: lastScanRan,
        apiUrlSet: Boolean(shared.pushUrl),
        flash,
      }),
    );
  });

  // ---------- /config/api ----------
  app.get('/config/api', async (c) => {
    const config = await readSharedConfig();
    return c.html(renderApiConfigPage({ config }));
  });

  app.post('/config/api', async (c) => {
    const form = await c.req.parseBody();
    const interval = Number(form.pollIntervalMin);
    const pushUrl = String(form.pushUrl ?? '').trim();
    const pingUrl = String(form.pingUrl ?? '').trim();
    if (!pushUrl) {
      const config = await readSharedConfig();
      return c.html(
        renderApiConfigPage({
          config,
          flash: { kind: 'err', message: 'Push URL is required.' },
        }),
      );
    }
    if (!Number.isFinite(interval) || interval < 1 || interval > 1440) {
      const config = await readSharedConfig();
      return c.html(
        renderApiConfigPage({
          config,
          flash: { kind: 'err', message: 'Poll interval must be between 1 and 1440 minutes.' },
        }),
      );
    }
    await setConfigMany({
      [ConfigKeys.PushUrl]: pushUrl,
      [ConfigKeys.PingUrl]: pingUrl,
      [ConfigKeys.PollIntervalMin]: String(interval),
    });
    await restartScheduler();
    const config = await readSharedConfig();
    return c.html(
      renderApiConfigPage({
        config,
        flash: { kind: 'ok', message: 'Saved. Scheduler restarted with the new interval.' },
      }),
    );
  });

  // Legacy redirect for bookmarks pointing at /config/chr.
  app.get('/config/chr', (c) => c.redirect('/config/api'));

  // ---------- /config/system ----------
  app.get('/config/system', async (c) => {
    const enabled = (await getConfig(ConfigKeys.AutostartEnabled)) === '1';
    return c.html(renderSystemConfigPage({ autostartEnabled: enabled }));
  });

  app.post('/config/system/autostart', async (c) => {
    const form = await c.req.parseBody();
    const action = String(form.action ?? '');
    const provider = getAutostartProvider();
    let flash: { kind: 'ok' | 'err'; message: string };
    try {
      if (action === 'enable') {
        await provider.install();
        await setConfig(ConfigKeys.AutostartEnabled, '1');
        flash = { kind: 'ok', message: `Auto-start enabled (${provider.describe()}).` };
      } else if (action === 'disable') {
        await provider.uninstall();
        await setConfig(ConfigKeys.AutostartEnabled, '0');
        flash = { kind: 'ok', message: 'Auto-start disabled.' };
      } else {
        flash = { kind: 'err', message: 'Unknown action.' };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      flash = {
        kind: 'err',
        message: `Auto-start ${action} failed: ${msg}. You may need admin/sudo privileges.`,
      };
    }
    const enabled = (await getConfig(ConfigKeys.AutostartEnabled)) === '1';
    return c.html(renderSystemConfigPage({ autostartEnabled: enabled, flash }));
  });

  // ---------- /api/cycle/run ----------
  app.post('/api/cycle/run', (c) => {
    void runOnce();
    return c.redirect('/dashboard');
  });

  // ---------- /logs ----------
  app.get('/logs', async (c) => {
    const pageRaw = Number(c.req.query('page') ?? '1');
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
    const filterRaw = c.req.query('deviceId');
    const filterDeviceId = filterRaw && filterRaw !== '' ? Number(filterRaw) : null;
    const pageSize = 50;
    const cycles = await listCycleLogs({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      deviceId: filterDeviceId ?? undefined,
    });
    const devices = await listDevices();
    return c.html(
      renderLogsPage({
        cycles,
        devices,
        page,
        pageSize,
        filterDeviceId,
      }),
    );
  });

  return app;
}
