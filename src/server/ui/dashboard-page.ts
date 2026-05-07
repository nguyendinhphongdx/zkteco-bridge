import type { SharedConfigSlots } from '../../config/runtime';
import type { CycleLogView, DeviceView } from '../../db/repo';
import { escapeHtml, renderLayout } from './layout';

export interface DashboardData {
  apiUrlSet: boolean;
  shared: SharedConfigSlots;
  devices: DeviceView[];
  totalQueued: number;
  recentCycles: CycleLogView[];
  flash?: { kind: 'ok' | 'err'; message: string } | null;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function statusBadge(status: string | null): string {
  const classes: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-amber-100 text-amber-800',
    api_error: 'bg-rose-100 text-rose-800',
    zk_error: 'bg-rose-100 text-rose-800',
  };
  if (!status) {
    return `<span class="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">never</span>`;
  }
  const cls = classes[status] ?? 'bg-slate-100 text-slate-700';
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${cls}">${escapeHtml(status)}</span>`;
}

export function renderDashboard(data: DashboardData): string {
  const setupBanner = !data.apiUrlSet
    ? `<div class="mb-4 px-4 py-3 rounded bg-amber-50 text-amber-800 border border-amber-200">
         Configure the backend Push URL in <a class="underline" href="/config/api">API settings</a>, then add a device on
         <a class="underline" href="/devices">Devices</a>.
       </div>`
    : data.devices.length === 0
      ? `<div class="mb-4 px-4 py-3 rounded bg-amber-50 text-amber-800 border border-amber-200">
           No devices yet. Add one on the <a class="underline" href="/devices">Devices</a> page.
         </div>`
      : '';

  const enabledCount = data.devices.filter((d) => d.enabled).length;
  const okCount = data.devices.filter((d) => d.lastStatus === 'ok').length;
  const errCount = data.devices.filter(
    (d) => d.lastStatus === 'api_error' || d.lastStatus === 'zk_error',
  ).length;

  const deviceRows =
    data.devices.length === 0
      ? `<tr><td colspan="5" class="text-center text-slate-500 py-4 text-sm">No devices.</td></tr>`
      : data.devices
          .map(
            (d) => `
          <tr class="border-t border-slate-200">
            <td class="py-2 pr-2">
              <div class="font-medium">${escapeHtml(d.name)}</div>
              <div class="text-xs text-slate-500 font-mono">${escapeHtml(d.host)}:${d.port}</div>
            </td>
            <td class="py-2 pr-2">${statusBadge(d.lastStatus)}</td>
            <td class="py-2 pr-2 text-sm">${formatDate(d.lastSyncAt)}</td>
            <td class="py-2 pr-2 text-sm text-right">${d.lastEventLogId}</td>
            <td class="py-2 pr-2 text-sm text-rose-700">${escapeHtml(d.lastError ?? '')}</td>
          </tr>`,
          )
          .join('');

  const cycleRows =
    data.recentCycles.length === 0
      ? `<tr><td colspan="6" class="text-center text-slate-500 py-4 text-sm">No cycles yet.</td></tr>`
      : data.recentCycles
          .map(
            (c) => `
          <tr class="border-t border-slate-200">
            <td class="py-2 pr-2 text-sm text-slate-600">${formatDate(c.startedAt)}</td>
            <td class="py-2 pr-2 text-sm">${escapeHtml(c.deviceName)}</td>
            <td class="py-2 pr-2">${statusBadge(c.status)}</td>
            <td class="py-2 pr-2 text-sm text-right">${c.eventsPolled ?? 0}</td>
            <td class="py-2 pr-2 text-sm text-right">${c.eventsPushed ?? 0}</td>
            <td class="py-2 pr-2 text-sm text-right">${c.eventsQueued ?? 0}</td>
          </tr>`,
          )
          .join('');

  const body = `
    ${setupBanner}
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-xs text-slate-500 uppercase">Enabled devices</div>
        <div class="text-2xl font-semibold mt-1">${enabledCount}<span class="text-base text-slate-500"> / ${data.devices.length}</span></div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-xs text-slate-500 uppercase">Healthy</div>
        <div class="text-2xl font-semibold mt-1 text-emerald-700">${okCount}</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-xs text-slate-500 uppercase">In error</div>
        <div class="text-2xl font-semibold mt-1 ${errCount > 0 ? 'text-rose-700' : 'text-slate-700'}">${errCount}</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-xs text-slate-500 uppercase">Offline queue</div>
        <div class="text-2xl font-semibold mt-1">${data.totalQueued}</div>
      </div>
    </div>

    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold">Run a cycle now</h2>
        <form method="post" action="/api/cycle/run">
          <button class="bg-slate-900 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-slate-800">Poll all devices</button>
        </form>
      </div>
      <p class="text-sm text-slate-500">Triggers a poll cycle outside the schedule, for every enabled device.</p>
    </div>

    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <h2 class="font-semibold mb-3">Devices</h2>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs uppercase text-slate-500">
            <th class="pb-2 pr-2">Device</th>
            <th class="pb-2 pr-2">Status</th>
            <th class="pb-2 pr-2">Last sync</th>
            <th class="pb-2 pr-2 text-right">Cursor</th>
            <th class="pb-2 pr-2">Last error</th>
          </tr>
        </thead>
        <tbody>${deviceRows}</tbody>
      </table>
    </div>

    <div class="bg-white rounded-lg shadow p-4">
      <h2 class="font-semibold mb-3">Recent cycles</h2>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs uppercase text-slate-500">
            <th class="pb-2 pr-2">Started</th>
            <th class="pb-2 pr-2">Device</th>
            <th class="pb-2 pr-2">Status</th>
            <th class="pb-2 pr-2 text-right">Polled</th>
            <th class="pb-2 pr-2 text-right">Pushed</th>
            <th class="pb-2 pr-2 text-right">Queued</th>
          </tr>
        </thead>
        <tbody>${cycleRows}</tbody>
      </table>
    </div>`;
  return renderLayout({
    title: 'Dashboard',
    body,
    showNav: true,
    active: 'dashboard',
    flash: data.flash,
  });
}
