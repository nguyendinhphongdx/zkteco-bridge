import type { SharedConfigSlots } from '../../config/runtime';
import { escapeHtml, renderLayout } from './layout';

export function renderChrConfigPage(opts: {
  config: SharedConfigSlots;
  flash?: { kind: 'ok' | 'err'; message: string } | null;
}): string {
  const { config } = opts;
  const body = `
    <div class="bg-white rounded-lg shadow p-6 max-w-2xl">
      <h1 class="text-lg font-semibold mb-1">C-HR backend</h1>
      <p class="text-sm text-slate-500 mb-4">
        Shared API URL for all devices. Per-device IDs and tokens live on the
        <a class="underline" href="/devices">Devices</a> page.
      </p>
      <form method="post" action="/config/chr" class="space-y-3">
        <label class="block">
          <span class="text-sm font-medium">API base URL</span>
          <input name="chrApiUrl" required value="${escapeHtml(config.chrApiUrl ?? '')}"
            placeholder="https://api.your-c-hr.example.com/api/v1"
            class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-slate-500">
        </label>
        <label class="block">
          <span class="text-sm font-medium">Poll interval (minutes)</span>
          <input name="pollIntervalMin" type="number" min="1" max="1440" required
            value="${escapeHtml(String(config.pollIntervalMin ?? 5))}"
            class="mt-1 block w-32 border border-slate-300 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-slate-500">
        </label>
        <div class="pt-2">
          <button class="bg-slate-900 text-white px-4 py-2 rounded font-medium hover:bg-slate-800">Save</button>
        </div>
      </form>
    </div>`;
  return renderLayout({
    title: 'C-HR config',
    body,
    showNav: true,
    active: 'config-chr',
    flash: opts.flash,
  });
}

export function renderSystemConfigPage(opts: {
  autostartEnabled: boolean;
  flash?: { kind: 'ok' | 'err'; message: string } | null;
}): string {
  const body = `
    <div class="space-y-4 max-w-2xl">
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="font-semibold mb-2">Auto-start on boot</h2>
        <p class="text-sm text-slate-500 mb-3">
          Register ZK-Bridge as a service so it starts automatically when this machine reboots.
          Requires admin privileges on the host.
        </p>
        <form method="post" action="/config/system/autostart" class="flex items-center gap-3">
          <span class="text-sm">Currently: <strong>${opts.autostartEnabled ? 'enabled' : 'disabled'}</strong></span>
          <button name="action" value="${opts.autostartEnabled ? 'disable' : 'enable'}"
            class="bg-slate-900 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-slate-800">
            ${opts.autostartEnabled ? 'Disable' : 'Enable'}
          </button>
        </form>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="font-semibold mb-2">Run a cycle now</h2>
        <p class="text-sm text-slate-500 mb-3">Polls every enabled device once and pushes events. Useful for verification.</p>
        <form method="post" action="/api/cycle/run">
          <button class="bg-slate-900 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-slate-800">Run now</button>
        </form>
      </div>
    </div>`;
  return renderLayout({
    title: 'System',
    body,
    showNav: true,
    active: 'config-system',
    flash: opts.flash,
  });
}
