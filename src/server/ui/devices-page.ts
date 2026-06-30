import type { ScanCandidate } from '../../scan/lan-scan';
import type { DeviceView } from '../../db/repo';
import { escapeHtml, formatTs, renderLayout } from './layout';

function formatDate(d: Date | null | undefined): string {
  if (!d) return 'never';
  return formatTs(d);
}

function dot(color: string, label: string, title: string): string {
  return `<span class="inline-flex items-center gap-1 whitespace-nowrap" title="${escapeHtml(title)}">
    <span class="w-2 h-2 rounded-full ${color}"></span>
    <span class="text-xs text-slate-600">${escapeHtml(label)}</span>
  </span>`;
}

// Derive two independent status dots from a single lastStatus value.
// ZK dot reflects whether the device was reachable last poll.
// Backend dot reflects whether pushing to the API succeeded.
function statusDots(status: string | null): string {
  if (!status) {
    const grey = dot('bg-slate-300', '—', 'Never polled');
    return `<div class="flex flex-col gap-0.5">${grey}${grey}</div>`;
  }
  const zkDot =
    status === 'zk_error'
      ? dot('bg-rose-500', 'ZK error', 'Last poll: device unreachable')
      : dot('bg-emerald-500', 'ZK ok', 'Last poll: device responded');

  const backendDot =
    status === 'ok'
      ? dot('bg-emerald-500', 'Backend ok', 'Last poll: all events pushed')
      : status === 'partial'
        ? dot('bg-amber-500', 'Backend partial', 'Last poll: some events queued')
        : status === 'api_error'
          ? dot('bg-rose-500', 'Backend error', 'Last poll: push failed')
          : dot('bg-slate-300', 'Backend —', 'Last poll: did not reach push step');

  return `<div class="flex flex-col gap-0.5">${zkDot}${backendDot}</div>`;
}

function deviceRow(d: DeviceView): string {
  return `
    <tr class="border-t border-slate-200 align-top">
      <td class="py-2 pr-2">
        <div class="font-medium">${escapeHtml(d.name)}</div>
        <div class="text-xs text-slate-500">id #${d.id}${d.enabled ? '' : ' · <span class="text-amber-700">disabled</span>'}</div>
      </td>
      <td class="py-2 pr-2 font-mono text-sm">${escapeHtml(d.host)}:${d.port}</td>
      <td class="py-2 pr-2">${statusDots(d.lastStatus)}</td>
      <td class="py-2 pr-2 text-sm">${formatDate(d.lastSyncAt)}</td>
      <td class="py-2 pr-2 text-sm text-rose-700">${escapeHtml(d.lastError ?? '')}</td>
      <td class="py-2 pr-2 text-right whitespace-nowrap">
        <a href="/devices/${d.id}/events"
           class="inline-block text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100">Events</a>
        <a href="/logs?deviceId=${d.id}"
           class="inline-block text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100">Cycles</a>
        <button type="button" class="zkb-edit text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100"
          data-device='${escapeHtml(JSON.stringify(d))}'>Edit</button>
        <form method="post" action="/devices/${d.id}/connect" class="inline">
          <button class="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100" title="Send a ping to the C-HR backend to verify the device token">Ping backend</button>
        </form>
        <form method="post" action="/devices/${d.id}/delete" class="inline"
              onsubmit="return confirm('Delete ${escapeHtml(d.name)}?')">
          <button class="text-xs px-2 py-1 border border-rose-300 text-rose-700 rounded hover:bg-rose-50">Delete</button>
        </form>
      </td>
    </tr>`;
}

export function renderDevicesPage(opts: {
  devices: DeviceView[];
  scanResults: ScanCandidate[];
  scanRan: boolean;
  flash?: { kind: 'ok' | 'err'; message: string } | null;
  apiUrlSet: boolean;
}): string {
  const rows =
    opts.devices.length === 0
      ? `<tr><td colspan="6" class="text-center text-slate-500 py-6 text-sm">
           No devices yet. Click <strong>Add device</strong> or scan the LAN below.
         </td></tr>`
      : opts.devices.map(deviceRow).join('');

  const scanSection = opts.scanRan
    ? opts.scanResults.length === 0
      ? `<div class="text-sm text-slate-500">No devices answered on port 4370 in this subnet.</div>`
      : `<ul class="space-y-1">
          ${opts.scanResults
            .map((c) => {
              const i = c.info;
              const reachable = i?.reachable ?? false;
              // Port 4370 is the canonical ZKTeco port — port-open + probe-fail
              // most likely means the device is busy (single-connection limit)
              // rather than "not a ZKTeco". Different label for that case.
              const isCanonicalZkPort = c.port === 4370;
              // node-zklib 1.3 only exposes getInfo() for stats — no
              // serial / model / firmware fields on the wire.
              const tagBits: string[] = [];
              if (reachable) {
                if (typeof i?.userCount === 'number')
                  tagBits.push(`${i.userCount} users`);
                if (typeof i?.attendanceCount === 'number')
                  tagBits.push(`${i.attendanceCount} logs`);
                if (typeof i?.logCapacity === 'number')
                  tagBits.push(`cap ${i.logCapacity}`);
              }
              const tags = tagBits.length
                ? `<div class="text-xs text-slate-500 mt-0.5">${tagBits.join(' · ')}</div>`
                : reachable
                  ? `<div class="text-xs text-slate-400 mt-0.5">no metadata</div>`
                  : isCanonicalZkPort
                    ? `<div class="text-xs text-amber-700 mt-0.5">port mở nhưng ZK probe fail — device có thể đang busy (1 connection / lúc). Vẫn add được rồi test sau.</div>`
                    : `<div class="text-xs text-amber-700 mt-0.5">port mở nhưng ZK protocol unreachable — có thể không phải ZKTeco</div>`;
              const badge = reachable
                ? `<span class="text-[10px] uppercase font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">ZKTeco</span>`
                : isCanonicalZkPort
                  ? `<span class="text-[10px] uppercase font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded" title="port 4370 — likely ZKTeco but probe failed">ZKTeco?</span>`
                  : `<span class="text-[10px] uppercase font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">unknown</span>`;
              return `
                <li class="flex items-start justify-between gap-3 bg-slate-50 border border-slate-200 px-3 py-2 rounded">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-sm">${escapeHtml(c.host)}:${c.port}</span>
                      ${badge}
                    </div>
                    ${tags}
                  </div>
                  <button type="button" class="zkb-add-from-scan shrink-0 text-xs px-2 py-1 bg-slate-900 text-white rounded hover:bg-slate-800"
                    data-host="${escapeHtml(c.host)}"
                    data-port="${c.port}"
                    data-name="">+ Add as device</button>
                </li>`;
            })
            .join('')}
        </ul>`
    : `<div class="text-sm text-slate-500">Click <strong>Scan now</strong> to probe TCP 4370 across this subnet, then identify each candidate over ZK protocol.</div>`;

  const apiBanner = opts.apiUrlSet
    ? ''
    : `<div class="mb-4 px-4 py-3 rounded bg-amber-50 text-amber-800 border border-amber-200">
         Configure the backend Push URL in <a class="underline" href="/config/api">API settings</a> before adding devices.
       </div>`;

  const body = `
    ${apiBanner}

    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <div class="flex items-center justify-between mb-3">
        <h1 class="font-semibold">Configured devices</h1>
        <button type="button" id="zkb-add-btn" class="bg-slate-900 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-slate-800">
          + Add device
        </button>
      </div>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs uppercase text-slate-500">
            <th class="pb-2 pr-2">Name</th>
            <th class="pb-2 pr-2">Host</th>
            <th class="pb-2 pr-2" title="ZK device / Backend — result of the last poll cycle">Status</th>
            <th class="pb-2 pr-2">Last sync</th>
            <th class="pb-2 pr-2">Last error</th>
            <th class="pb-2 pr-2"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="bg-white rounded-lg shadow p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-semibold">Scan LAN</h2>
        <form method="post" action="/devices/scan">
          <button class="bg-white border border-slate-300 px-3 py-1.5 rounded text-sm font-medium hover:bg-slate-100">Scan now</button>
        </form>
      </div>
      ${scanSection}
    </div>

    <dialog id="zkb-modal" class="rounded-lg shadow-xl backdrop:bg-black/40 p-0 w-full max-w-lg">
      <form method="post" id="zkb-form" class="bg-white">
        <div class="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 class="font-semibold" id="zkb-modal-title">Add device</h3>
          <button type="button" id="zkb-close" class="text-slate-500 hover:text-slate-900 text-xl leading-none">&times;</button>
        </div>
        <div class="p-5 space-y-3">
          <input type="hidden" name="id" value="">
          <label class="block">
            <span class="text-sm font-medium">Name</span>
            <input name="name" required minlength="1" maxlength="100" placeholder="Front gate"
              class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-slate-500">
          </label>
          <div class="grid grid-cols-3 gap-3">
            <label class="block col-span-2">
              <span class="text-sm font-medium">Device IP</span>
              <input name="host" required placeholder="192.168.1.201"
                class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-500">
            </label>
            <label class="block">
              <span class="text-sm font-medium">Port</span>
              <input name="port" type="number" min="1" max="65535" value="4370" required
                class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-500">
            </label>
          </div>
          <hr class="border-slate-200">
          <label class="block">
            <span class="text-sm font-medium">Device token</span>
            <span class="text-xs text-slate-500"> — JWT issued by your backend for this device</span>
            <textarea name="deviceToken" required rows="3"
              class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 font-mono text-xs break-all outline-none focus:ring-2 focus:ring-slate-500"></textarea>
          </label>
          <label class="flex items-center gap-2">
            <input name="enabled" type="checkbox" checked value="1" class="rounded">
            <span class="text-sm">Enabled (poll on schedule)</span>
          </label>
        </div>
        <div class="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <button type="button" id="zkb-cancel" class="px-4 py-2 border border-slate-300 rounded font-medium hover:bg-slate-100">Cancel</button>
          <button class="bg-slate-900 text-white px-4 py-2 rounded font-medium hover:bg-slate-800">Save</button>
        </div>
      </form>
    </dialog>

    <script>
      (function () {
        const modal = document.getElementById('zkb-modal');
        const form = document.getElementById('zkb-form');
        const title = document.getElementById('zkb-modal-title');

        function openAdd(prefill) {
          title.textContent = 'Add device';
          form.action = '/devices';
          form.id.value = '';
          form.name.value = prefill?.name ?? '';
          form.host.value = prefill?.host ?? '';
          form.port.value = prefill?.port ?? '4370';
          form.deviceToken.value = '';
          form.enabled.checked = true;
          modal.showModal();
        }

        function openEdit(d) {
          title.textContent = 'Edit device';
          form.action = '/devices/' + d.id;
          form.id.value = d.id;
          form.name.value = d.name;
          form.host.value = d.host;
          form.port.value = d.port;
          form.deviceToken.value = d.deviceToken;
          form.enabled.checked = !!d.enabled;
          modal.showModal();
        }

        document.getElementById('zkb-add-btn').addEventListener('click', () => openAdd());
        document.getElementById('zkb-close').addEventListener('click', () => modal.close());
        document.getElementById('zkb-cancel').addEventListener('click', () => modal.close());
        document.querySelectorAll('.zkb-edit').forEach((b) => {
          b.addEventListener('click', () => {
            try { openEdit(JSON.parse(b.dataset.device)); } catch (e) { console.error(e); }
          });
        });
        document.querySelectorAll('.zkb-add-from-scan').forEach((b) => {
          b.addEventListener('click', () => openAdd({
            host: b.dataset.host,
            port: b.dataset.port,
            name: b.dataset.name,
          }));
        });
      })();
    </script>`;

  return renderLayout({
    title: 'Devices',
    body,
    showNav: true,
    active: 'devices',
    flash: opts.flash,
  });
}
