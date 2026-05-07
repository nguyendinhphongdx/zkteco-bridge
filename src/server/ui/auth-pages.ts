import { escapeHtml, renderLayout } from './layout';

interface FormError {
  message: string;
}

export function renderSetupPage(opts: { error?: FormError } = {}): string {
  const body = `
    <div class="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-12">
      <h1 class="text-xl font-semibold mb-1">Welcome to ZK-Bridge</h1>
      <p class="text-sm text-slate-500 mb-4">First-time setup. Create the local admin account.</p>
      ${
        opts.error
          ? `<div class="mb-3 px-3 py-2 rounded bg-rose-50 text-rose-700 border border-rose-200 text-sm">${escapeHtml(opts.error.message)}</div>`
          : ''
      }
      <form method="post" action="/setup" class="space-y-3">
        <label class="block">
          <span class="text-sm font-medium">Username</span>
          <input name="username" required minlength="3" maxlength="50"
            class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:ring-2 focus:ring-slate-500 outline-none">
        </label>
        <label class="block">
          <span class="text-sm font-medium">Password</span>
          <input type="password" name="password" required minlength="8"
            class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:ring-2 focus:ring-slate-500 outline-none">
        </label>
        <label class="block">
          <span class="text-sm font-medium">Confirm password</span>
          <input type="password" name="confirm" required minlength="8"
            class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:ring-2 focus:ring-slate-500 outline-none">
        </label>
        <button class="w-full bg-slate-900 text-white py-2 rounded font-medium hover:bg-slate-800">Create account</button>
      </form>
    </div>`;
  return renderLayout({ title: 'Setup', body });
}

export function renderLoginPage(opts: { error?: FormError; username?: string } = {}): string {
  const body = `
    <div class="max-w-md mx-auto bg-white rounded-lg shadow p-6 mt-12">
      <h1 class="text-xl font-semibold mb-1">Sign in</h1>
      <p class="text-sm text-slate-500 mb-4">ZK-Bridge admin console</p>
      ${
        opts.error
          ? `<div class="mb-3 px-3 py-2 rounded bg-rose-50 text-rose-700 border border-rose-200 text-sm">${escapeHtml(opts.error.message)}</div>`
          : ''
      }
      <form method="post" action="/login" class="space-y-3">
        <label class="block">
          <span class="text-sm font-medium">Username</span>
          <input name="username" required value="${escapeHtml(opts.username ?? '')}"
            class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:ring-2 focus:ring-slate-500 outline-none">
        </label>
        <label class="block">
          <span class="text-sm font-medium">Password</span>
          <input type="password" name="password" required
            class="mt-1 block w-full border border-slate-300 rounded px-3 py-2 focus:ring-2 focus:ring-slate-500 outline-none">
        </label>
        <button class="w-full bg-slate-900 text-white py-2 rounded font-medium hover:bg-slate-800">Sign in</button>
      </form>
    </div>`;
  return renderLayout({ title: 'Sign in', body });
}
