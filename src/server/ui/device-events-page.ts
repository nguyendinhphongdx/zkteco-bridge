import type { DeviceView } from '../../db/repo';
import { escapeHtml, formatTs, renderLayout } from './layout';

export interface DeviceEventRow {
  eventLogId: string;
  employeeCode: string;
  timestampIso: string;
  type: 'IN' | 'OUT';
  /** True if this event's userSn is > device.lastEventLogId (not yet pushed). */
  pending: boolean;
}

export function renderDeviceEventsPage(opts: {
  device: DeviceView;
  events: DeviceEventRow[];
  totalRecords: number;
  page: number;
  pageSize: number;
  cursorOnPage: boolean;
  cachedAt: Date | null;
  fetchMs: number;
  flash?: { kind: 'ok' | 'err'; message: string } | null;
}): string {
  const { device } = opts;
  const cursorRow = `
    <tr class="bg-slate-100 border-y-2 border-slate-400">
      <td colspan="5" class="py-2 px-2 text-xs font-medium text-slate-700">
        ← Cursor at eventLogId = <span class="font-mono">${device.lastEventLogId}</span>
        <span class="text-slate-500">— rows above = pending push, rows below = already pushed</span>
      </td>
    </tr>`;

  const eventRows = opts.events.map((e) => {
    const pendingBadge = e.pending
      ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">pending</span>`
      : `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">pushed</span>`;
    const typeBadge =
      e.type === 'IN'
        ? `<span class="px-1.5 py-0.5 rounded text-xs bg-sky-100 text-sky-800">IN</span>`
        : `<span class="px-1.5 py-0.5 rounded text-xs bg-violet-100 text-violet-800">OUT</span>`;
    return `
      <tr class="border-t border-slate-200">
        <td class="py-2 pr-2 font-mono text-xs">${escapeHtml(e.eventLogId)}</td>
        <td class="py-2 pr-2 font-mono text-sm">${escapeHtml(e.employeeCode)}</td>
        <td class="py-2 pr-2 text-sm">${formatTs(e.timestampIso)}</td>
        <td class="py-2 pr-2">${typeBadge}</td>
        <td class="py-2 pr-2">${pendingBadge}</td>
      </tr>`;
  });

  // Cursor divider only renders when the cursor falls within this page's
  // slice. Otherwise the header card alone communicates the cursor value.
  let rows: string;
  if (opts.events.length === 0) {
    rows = `<tr><td colspan="5" class="text-center text-slate-500 py-6 text-sm">
              Device không có event nào.
            </td></tr>`;
  } else if (!opts.cursorOnPage) {
    rows = eventRows.join('');
  } else {
    const splitIdx = opts.events.findIndex((e) => !e.pending);
    if (splitIdx <= 0) {
      rows = cursorRow + eventRows.join('');
    } else {
      rows =
        eventRows.slice(0, splitIdx).join('') +
        cursorRow +
        eventRows.slice(splitIdx).join('');
    }
  }

  const totalPages = Math.max(1, Math.ceil(opts.totalRecords / opts.pageSize));
  const prevPage = opts.page > 1 ? opts.page - 1 : null;
  const nextPage = opts.page < totalPages ? opts.page + 1 : null;
  const cachedLabel = opts.cachedAt
    ? `Cached at ${formatTs(opts.cachedAt)} (${opts.fetchMs}ms)`
    : `Fetched in ${opts.fetchMs}ms`;

  const body = `
    <div class="mb-3 flex items-center gap-3">
      <a href="/devices" class="text-sm text-slate-600 hover:text-slate-900">&larr; Devices</a>
      <span class="text-slate-300">/</span>
      <h1 class="font-semibold">Events from "${escapeHtml(device.name)}"</h1>
    </div>

    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <div class="text-xs text-slate-500 uppercase">Host</div>
          <div class="font-mono">${escapeHtml(device.host)}:${device.port}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500 uppercase">Cursor (last pushed)</div>
          <div class="font-mono">${device.lastEventLogId}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500 uppercase">Records on device</div>
          <div class="font-mono">${opts.totalRecords}</div>
        </div>
        <div>
          <div class="text-xs text-slate-500 uppercase">Last fetch</div>
          <div class="text-xs">${cachedLabel}</div>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="font-semibold">Events &mdash; page ${opts.page} / ${totalPages}</h2>
          <p class="text-xs text-slate-500">
            Sorted by eventLogId desc. Showing ${opts.events.length} of ${opts.totalRecords} record(s).
            Đường kẻ đậm là vị trí <strong>cursor</strong>: trên = chưa push (pending),
            dưới = đã push (pushed).
          </p>
        </div>
        <div class="flex gap-2">
          <a href="/devices/${device.id}/events"
             class="text-xs px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100">
            Reload
          </a>
          <form method="post" action="/devices/${device.id}/reset-cursor" class="inline"
                onsubmit="return confirm('Reset cursor for ${escapeHtml(device.name)}?\\n\\nThe next cycle will re-pull every event still on the device. The backend dedupes by (deviceId, eventLogId), so this is safe — but it can push thousands of records at once.')">
            <button class="text-xs px-3 py-1.5 border border-rose-300 text-rose-700 rounded hover:bg-rose-50">
              Reset cursor
            </button>
          </form>
        </div>
      </div>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs uppercase text-slate-500">
            <th class="pb-2 pr-2">Event ID</th>
            <th class="pb-2 pr-2">Employee</th>
            <th class="pb-2 pr-2">Timestamp</th>
            <th class="pb-2 pr-2">Type</th>
            <th class="pb-2 pr-2">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="flex gap-2 mt-3">
        ${prevPage ? `<a href="/devices/${device.id}/events?page=${prevPage}" class="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-100">Previous</a>` : ''}
        <span class="text-sm text-slate-500 px-2 py-1">Page ${opts.page} of ${totalPages}</span>
        ${nextPage ? `<a href="/devices/${device.id}/events?page=${nextPage}" class="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-100">Next</a>` : ''}
      </div>
    </div>`;
  return renderLayout({
    title: `Events — ${device.name}`,
    body,
    showNav: true,
    active: 'devices',
    flash: opts.flash,
  });
}
