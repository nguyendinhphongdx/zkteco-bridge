export interface LayoutOptions {
  title: string;
  body: string;
  active?:
    | 'dashboard'
    | 'devices'
    | 'config-api'
    | 'config-system'
    | 'logs'
    | 'guide'
    | null;
  showNav?: boolean;
  flash?: { kind: 'ok' | 'err'; message: string } | null;
}

export const GITHUB_URL = 'https://github.com/nguyendinhphongdx/zkteco-bridge';
export const NPM_URL = 'https://www.npmjs.com/package/@hanoilab/zk-bridge';

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

const GITHUB_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.27-.01-1-.02-1.97-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18A11.02 11.02 0 0 1 12 6.8c.97 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
</svg>`;

const NPM_ICON = `
<svg viewBox="0 0 256 256" fill="currentColor" class="w-4 h-4">
  <path d="M0 256V0h256v256H0Zm222.32-33.682V33.682H33.682v188.636h94.32v-156h62.954v156h31.364Z"/>
</svg>`;

const STAR_ICON = `
<svg viewBox="0 0 24 24" fill="currentColor" class="w-3.5 h-3.5">
  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
</svg>`;

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
          ${navLink('/guide', 'Guide', opts.active === 'guide')}
          <span class="flex-1"></span>
          <a href="${GITHUB_URL}" target="_blank" rel="noopener"
             title="Star us on GitHub — it helps a lot ⭐"
             class="inline-flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium text-slate-700 hover:bg-amber-50 hover:text-amber-700 border border-transparent hover:border-amber-200 transition">
            ${GITHUB_ICON}
            ${STAR_ICON}
            <span>Star</span>
          </a>
          <a href="${NPM_URL}" target="_blank" rel="noopener"
             title="View on npm"
             class="inline-flex items-center px-2 py-1.5 rounded text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
            ${NPM_ICON}
          </a>
          <form method="post" action="/logout">
            <button class="text-sm text-slate-500 hover:text-slate-900 px-2 py-1.5">Logout</button>
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
