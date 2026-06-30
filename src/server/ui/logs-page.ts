import type { CycleLogView, DeviceView } from '../../db/repo';
import { escapeHtml, formatTs, renderLayout } from './layout';

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return formatTs(d);
}

function statusBadge(status: string): string {
  const classes: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-amber-100 text-amber-800',
    api_error: 'bg-rose-100 text-rose-800',
    zk_error: 'bg-rose-100 text-rose-800',
  };
  const cls = classes[status] ?? 'bg-slate-100 text-slate-700';
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${cls}">${escapeHtml(status)}</span>`;
}

export function renderLogsPage(opts: {
  cycles: CycleLogView[];
  devices: DeviceView[];
  page: number;
  pageSize: number;
  filterDeviceId: number | null;
}): string {
  const rows =
    opts.cycles.length === 0
      ? `<tr><td colspan="7" class="text-center text-slate-500 py-4 text-sm">No cycles yet.</td></tr>`
      : opts.cycles
          .map(
            (c) => `
            <tr class="border-t border-slate-200 align-top">
              <td class="py-2 pr-2 text-sm">${c.id}</td>
              <td class="py-2 pr-2 text-sm">${formatDate(c.startedAt)}</td>
              <td class="py-2 pr-2 text-sm">${escapeHtml(c.deviceName)}</td>
              <td class="py-2 pr-2">${statusBadge(c.status)}</td>
              <td class="py-2 pr-2 text-sm text-right">${c.eventsPolled ?? 0}</td>
              <td class="py-2 pr-2 text-sm text-right">${c.eventsPushed ?? 0}</td>
              <td class="py-2 text-sm text-rose-700">${escapeHtml(c.errorMessage ?? '')}</td>
            </tr>`,
          )
          .join('');

  const filterOptions = [
    `<option value="">All devices</option>`,
    ...opts.devices.map(
      (d) =>
        `<option value="${d.id}" ${opts.filterDeviceId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`,
    ),
  ].join('');

  const baseQs = opts.filterDeviceId ? `&deviceId=${opts.filterDeviceId}` : '';
  const prevPage = opts.page > 1 ? opts.page - 1 : null;
  const nextPage = opts.cycles.length === opts.pageSize ? opts.page + 1 : null;

  const body = `
    <div class="bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between mb-3">
        <h1 class="font-semibold">Cycle logs</h1>
        <form method="get" action="/logs" class="flex gap-2">
          <select name="deviceId" class="border border-slate-300 rounded px-2 py-1 text-sm" onchange="this.form.submit()">
            ${filterOptions}
          </select>
        </form>
      </div>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs uppercase text-slate-500">
            <th class="pb-2 pr-2">#</th>
            <th class="pb-2 pr-2">Started</th>
            <th class="pb-2 pr-2">Device</th>
            <th class="pb-2 pr-2">Status</th>
            <th class="pb-2 pr-2 text-right">Polled</th>
            <th class="pb-2 pr-2 text-right">Pushed</th>
            <th class="pb-2">Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="flex gap-2 mt-3">
        ${prevPage ? `<a href="/logs?page=${prevPage}${baseQs}" class="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-100">Previous</a>` : ''}
        <span class="text-sm text-slate-500 px-2 py-1">Page ${opts.page}</span>
        ${nextPage ? `<a href="/logs?page=${nextPage}${baseQs}" class="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-100">Next</a>` : ''}
      </div>
    </div>`;
  return renderLayout({ title: 'Logs', body, showNav: true, active: 'logs' });
}
