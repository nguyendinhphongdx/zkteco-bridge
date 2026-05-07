import { GITHUB_URL, NPM_URL, renderLayout } from './layout';

export function renderGuidePage(): string {
  const body = `
    <div class="space-y-6">

      <header class="bg-white rounded-lg shadow p-6">
        <div class="flex items-start gap-4 flex-wrap">
          <div class="flex-1 min-w-0">
            <h1 class="text-2xl font-semibold">ZK-Bridge guide</h1>
            <p class="text-sm text-slate-500 mt-1">
              Everything this bridge can do, in one page. Click any section below to jump.
            </p>
          </div>
          <a href="${GITHUB_URL}" target="_blank" rel="noopener"
             class="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 text-sm font-medium">
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
            </svg>
            Star on GitHub
          </a>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs">
          <a class="text-slate-600 hover:text-slate-900 underline" href="${GITHUB_URL}" target="_blank" rel="noopener">GitHub repo</a>
          <span class="text-slate-300">·</span>
          <a class="text-slate-600 hover:text-slate-900 underline" href="${NPM_URL}" target="_blank" rel="noopener">npm package</a>
          <span class="text-slate-300">·</span>
          <a class="text-slate-600 hover:text-slate-900 underline" href="${GITHUB_URL}/issues" target="_blank" rel="noopener">Report a bug</a>
        </div>
      </header>

      <nav class="bg-white rounded-lg shadow p-4">
        <h2 class="font-semibold mb-2 text-sm uppercase text-slate-500 tracking-wide">Contents</h2>
        <ul class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm">
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#flow">1. End-to-end flow</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#api">2. API config</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#devices">3. Devices</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#scan">4. LAN scan</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#events">5. Per-device events</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#cycles">6. Cycle logs</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#system">7. System tools</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#cli">8. CLI commands</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#contract">9. Backend contract</a></li>
          <li><a class="text-slate-700 hover:text-slate-900 underline" href="#troubleshoot">10. Troubleshooting</a></li>
        </ul>
      </nav>

      <section id="flow" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">1. End-to-end flow</h2>
        <p class="text-sm text-slate-600 mb-3">
          ZK-Bridge sits between a ZKTeco fingerprint reader on your office LAN and an HTTP backend
          (HRIS / C-HR / your own API). It polls the device on a schedule, translates events into a
          generic JSON shape, and pushes them via HTTPS — no port forwarding or VPN needed.
        </p>
<pre class="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-xs overflow-x-auto">
ZKTeco device          ZK-Bridge (this UI)         Your backend
┌────────────┐      ┌──────────────────┐       ┌───────────────┐
│ TCP 4370   │ ◄──► │  Poll · SQLite   │ ◄───► │  Push / Ping  │
│ on the LAN │      │  Scheduler · UI  │       │  endpoints    │
└────────────┘      └──────────────────┘       └───────────────┘
</pre>
        <p class="text-sm text-slate-600 mt-3">
          Every cycle (default 5 min): list enabled devices → for each: open ZK socket → fetch log
          → translate → push to backend in batches of 200. Backend dedupes by
          <code class="bg-slate-100 px-1 rounded">(deviceId, eventLogId)</code> so retries are safe.
        </p>
      </section>

      <section id="api" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">2. API config — <a class="text-sm text-blue-600 hover:underline" href="/config/api">/config/api</a></h2>
        <p class="text-sm text-slate-600 mb-3">
          Where the bridge sends data. Two URLs, full paths (no concatenation):
        </p>
        <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li><strong>Push URL</strong> (required) — bridge POSTs <code class="bg-slate-100 px-1 rounded">{ token, events[] }</code>.</li>
          <li><strong>Ping URL</strong> (optional) — used by the <strong>Connect</strong> button to verify token + reachability without pushing events. If empty, falls back to a push with an empty events array.</li>
          <li><strong>Poll interval</strong> — minutes between cycles (1–1440).</li>
        </ul>
        <p class="text-sm text-slate-600 mt-3">
          Save will restart the scheduler with the new interval immediately.
        </p>
      </section>

      <section id="devices" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">3. Devices — <a class="text-sm text-blue-600 hover:underline" href="/devices">/devices</a></h2>
        <p class="text-sm text-slate-600 mb-3">
          Each row = one ZKTeco reader. Per-device fields: <strong>Name</strong>,
          <strong>Host:Port</strong> (default 4370), <strong>Device token</strong> (JWT issued by your
          backend), <strong>Enabled</strong>. Status dot shows the last cycle outcome — green ok,
          amber partial, red zk_error / api_error, grey never run.
        </p>
        <p class="text-sm text-slate-600 mb-2"><strong>Row actions</strong> (right-most column):</p>
        <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li><strong>Events</strong> — live attendance from this device (see §5).</li>
          <li><strong>Cycles</strong> — cycle log filtered to this device (see §6).</li>
          <li><strong>Edit</strong> — opens the modal pre-filled.</li>
          <li><strong>Connect</strong> — pings the backend with this device's token and bumps <code class="bg-slate-100 px-1 rounded">lastSeenAt</code> there (sanity check before relying on the cycle).</li>
          <li><strong>Delete</strong> — removes the row + its queued events + cycle log entries.</li>
        </ul>
      </section>

      <section id="scan" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">4. LAN scan — <a class="text-sm text-blue-600 hover:underline" href="/devices">Devices → Scan now</a></h2>
        <p class="text-sm text-slate-600 mb-3">
          Probes every host in the bridge's <code class="bg-slate-100 px-1 rounded">/24</code> subnet on
          TCP 4370. Each candidate gets an extra ZK protocol probe to fetch device metadata (model,
          serial, user count) — distinguishes a real ZKTeco from any other service on the same port.
        </p>
        <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li><span class="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-emerald-100 text-emerald-800">ZKTeco</span> badge — TCP open + ZK protocol replied → confirmed.</li>
          <li><span class="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-amber-100 text-amber-800">ZKTeco?</span> — port 4370 open but ZK probe failed (device likely busy with another connection). Still likely a ZKTeco.</li>
          <li><span class="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold bg-amber-100 text-amber-800">unknown</span> — port open but probe failed AND it's not the canonical ZK port.</li>
        </ul>
        <p class="text-sm text-slate-600 mt-3">
          Click <strong>+ Add as device</strong> next to a result — opens the Add modal with name +
          host pre-filled. Paste the JWT, save.
        </p>
      </section>

      <section id="events" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">5. Per-device events — Devices → <strong>Events</strong></h2>
        <p class="text-sm text-slate-600 mb-3">
          Live read of the attendance log straight from the device — no cache. Sorted by
          <code class="bg-slate-100 px-1 rounded">eventLogId</code> descending; a thick divider marks
          the cursor: rows above are <strong>pending</strong> (not yet pushed), rows below are
          <strong>pushed</strong>.
        </p>
        <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li><strong>Refresh from device</strong> — re-fetch (typical 5–30s for thousands of records).</li>
          <li><strong>Reset cursor</strong> — sets <code class="bg-slate-100 px-1 rounded">last_event_log_id = 0</code>; next cycle re-pulls every event still on the device. Backend dedupes — safe but may push thousands at once.</li>
          <li>Pagination: 50 rows per page, deep-link friendly via <code class="bg-slate-100 px-1 rounded">?page=N</code>.</li>
        </ul>
      </section>

      <section id="cycles" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">6. Cycle logs — <a class="text-sm text-blue-600 hover:underline" href="/logs">/logs</a></h2>
        <p class="text-sm text-slate-600 mb-3">
          Per-cycle audit: 1 row = 1 device cycle attempt. Status badges:
        </p>
        <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li><span class="px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800">ok</span> — all events pushed, cursor advanced.</li>
          <li><span class="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800">partial</span> — some pushed, the rest queued offline (will retry).</li>
          <li><span class="px-1.5 py-0.5 rounded text-xs bg-rose-100 text-rose-800">zk_error</span> — couldn't reach the device.</li>
          <li><span class="px-1.5 py-0.5 rounded text-xs bg-rose-100 text-rose-800">api_error</span> — couldn't push to the backend; events sit in the queue.</li>
        </ul>
        <p class="text-sm text-slate-600 mt-3">
          Filter by device via the dropdown (or hit <strong>Cycles</strong> on a device row). The log
          rotates automatically — last 1000 entries are kept.
        </p>
      </section>

      <section id="system" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">7. System tools — <a class="text-sm text-blue-600 hover:underline" href="/config/system">/config/system</a></h2>
        <ul class="list-disc pl-5 space-y-1 text-sm text-slate-700">
          <li><strong>Auto-start on boot</strong> — toggle to register a systemd unit / Windows Scheduled Task / launchd plist with <code class="bg-slate-100 px-1 rounded">Restart=on-failure</code>. Bridge survives host reboots without manual start.</li>
          <li><strong>Run a cycle now</strong> — fires a poll cycle immediately, useful for verification after config changes.</li>
        </ul>
      </section>

      <section id="cli" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">8. CLI commands</h2>
        <p class="text-sm text-slate-600 mb-3">
          The package ships a <code class="bg-slate-100 px-1 rounded">zk-bridge</code> binary. Daemon
          mode is the default — closing the launching terminal does <em>not</em> stop the bridge.
        </p>
<pre class="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-xs overflow-x-auto">
zk-bridge start             # detach as background daemon
zk-bridge stop              # SIGTERM the daemon
zk-bridge restart           # stop + start
zk-bridge status            # PID, uptime, log path
zk-bridge logs -f           # follow the log file
zk-bridge logs -n 200       # last 200 lines
zk-bridge run               # foreground mode (systemd / Docker / PM2)
zk-bridge poll-once         # one cycle then exit
zk-bridge reset-user        # forgot-password recovery
zk-bridge recent-events     # peek at last N events from a device
zk-bridge upgrade [tag]     # self-update via npm
</pre>
        <p class="text-sm text-slate-600 mt-3">
          Logs land at <code class="bg-slate-100 px-1 rounded">&lt;DATA_DIR&gt;/zk-bridge.log</code>;
          PID file at <code class="bg-slate-100 px-1 rounded">&lt;DATA_DIR&gt;/zk-bridge.pid</code>.
          Every line is prefixed with an ISO timestamp.
        </p>
      </section>

      <section id="contract" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">9. Backend contract</h2>
        <p class="text-sm text-slate-600 mb-3">
          Any backend exposing two HTTP endpoints can receive events from this bridge. JSON over HTTPS,
          token-auth in the body (no special headers required).
        </p>
        <p class="text-sm font-medium mb-1">Push (required):</p>
<pre class="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-xs overflow-x-auto mb-3">
POST &lt;push-url&gt;
Content-Type: application/json

{
  "token": "&lt;JWT issued by your backend&gt;",
  "events": [
    {
      "eventLogId": "12345",
      "employeeCode": "EMP-0001",
      "timestamp": "2026-05-07T08:23:45.000Z",
      "type": "IN"
    }
  ]
}
</pre>
        <p class="text-sm font-medium mb-1">Ping (optional):</p>
<pre class="bg-slate-50 border border-slate-200 rounded p-3 font-mono text-xs overflow-x-auto">
POST &lt;ping-url&gt;
Content-Type: application/json

{ "token": "&lt;JWT&gt;" }
</pre>
        <p class="text-sm text-slate-600 mt-3">
          Backend should: verify the JWT, dedupe by <code class="bg-slate-100 px-1 rounded">(deviceId, eventLogId)</code>,
          persist events. Bridge only checks HTTP status (2xx = success, anything else = retry / queue).
        </p>
      </section>

      <section id="troubleshoot" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-lg font-semibold mb-2">10. Troubleshooting</h2>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase text-slate-500 border-b">
              <th class="pb-2 pr-3">Symptom</th>
              <th class="pb-2">Likely cause / fix</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200">
            <tr class="align-top">
              <td class="py-2 pr-3 font-mono text-xs">ETIMEDOUT &lt;ip&gt;:&lt;port&gt;</td>
              <td class="py-2">Bridge can't reach the backend. <code class="bg-slate-100 px-1 rounded">curl &lt;url&gt;</code> from this host should work.</td>
            </tr>
            <tr class="align-top">
              <td class="py-2 pr-3 font-mono text-xs">HTTP 401 Invalid token</td>
              <td class="py-2">JWT was regenerated on the backend, or the device row was deleted. Re-paste the token.</td>
            </tr>
            <tr class="align-top">
              <td class="py-2 pr-3 font-mono text-xs">Socket closed unexpectedly</td>
              <td class="py-2">ZK device only allows 1 active connection — another tool / cycle is holding it. Wait for the next cycle.</td>
            </tr>
            <tr class="align-top">
              <td class="py-2 pr-3 font-mono text-xs">port open but ZK probe fail</td>
              <td class="py-2">Same — device busy. Add → Connect after a minute.</td>
            </tr>
            <tr class="align-top">
              <td class="py-2 pr-3">Dashboard "never run"</td>
              <td class="py-2">Push URL not set, or no devices configured. Check API + Devices.</td>
            </tr>
            <tr class="align-top">
              <td class="py-2 pr-3">Events arrive late</td>
              <td class="py-2">Lower the poll interval in API settings (min 1 min).</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
        <p class="text-sm text-amber-900">
          ZK-Bridge is open-source. If it saves you time, please
          <a href="${GITHUB_URL}" target="_blank" rel="noopener" class="font-semibold underline">⭐ star us on GitHub</a>
          — it's the simplest way to support the project.
        </p>
      </footer>

    </div>`;
  return renderLayout({ title: 'Guide', body, showNav: true, active: 'guide' });
}
