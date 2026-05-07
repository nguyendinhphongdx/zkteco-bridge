export interface LayoutOptions {
  title: string;
  body: string;
  active?: 'dashboard' | 'devices' | 'config-api' | 'config-system' | 'logs' | null;
  showNav?: boolean;
  flash?: { kind: 'ok' | 'err'; message: string } | null;
}

export function escapeHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function navLink(href: string, label: string, active: boolean): string {
  const classes = active
    ? 'px-3 py-2 rounded bg-slate-900 text-white text-sm font-medium'
    : 'px-3 py-2 rounded text-slate-700 hover:bg-slate-200 text-sm font-medium';
  return `<a href="${href}" class="${classes}">${escapeHtml(label)}</a>`;
}

export function renderLayout(opts: LayoutOptions): string {
  const nav = opts.showNav
    ? `
      <nav class="bg-white border-b border-slate-200">
        <div class="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <span class="font-semibold text-slate-900 mr-4">ZK-Bridge</span>
          ${navLink('/dashboard', 'Dashboard', opts.active === 'dashboard')}
          ${navLink('/devices', 'Devices', opts.active === 'devices')}
          ${navLink('/config/api', 'API', opts.active === 'config-api')}
          ${navLink('/config/system', 'System', opts.active === 'config-system')}
          ${navLink('/logs', 'Logs', opts.active === 'logs')}
          <span class="flex-1"></span>
          <form method="post" action="/logout">
            <button class="text-sm text-slate-500 hover:text-slate-900">Logout</button>
          </form>
        </div>
      </nav>`
    : '';

  const flash = opts.flash
    ? `<div class="mb-4 px-4 py-3 rounded ${
        opts.flash.kind === 'ok'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-rose-50 text-rose-800 border border-rose-200'
      }">${escapeHtml(opts.flash.message)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — ZK-Bridge</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen">
${nav}
<main class="max-w-5xl mx-auto px-4 py-6">
${flash}
${opts.body}
</main>
</body>
</html>`;
}
