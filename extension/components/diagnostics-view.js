import { escapeHtml } from '../lib/escape.js';
// ScreenSync Extension Diagnostics Component
// Renders the payload of lib/web-diag.js (the same one web_extension_diagnostics returns):
// service-worker uptime, the real SSE client state, hub reachability, grants and approvals.
// Every pill is driven by state in the payload; nothing is hardcoded "OK".

const AUTO_REFRESH_MS = 5000;
const DEBOUNCE_MS = 750;
const REFRESH_KINDS = new Set(['sse-status', 'health', 'snapshot']);

const DASH = '—';
const show = (v) => (v === null || v === undefined || v === '' ? DASH : v);

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return DASH;
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return DASH;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// SSE pill from the client's real state (lib/sse-client.js snapshot, via web-diag).
export function ssePill(sse, now = Date.now()) {
  const s = sse || {};
  const attempt = Number.isFinite(s.attempt) && s.attempt > 0 ? ` (attempt ${s.attempt})` : '';
  switch (s.state) {
    case 'open': {
      const age = Number.isFinite(s.lastDataAgeSeconds) ? ` · data ${formatDuration(s.lastDataAgeSeconds)} ago` : '';
      return { cls: 'ok', label: `Live${age}` };
    }
    case 'connecting':
      return { cls: 'warn', label: `Connecting${attempt}` };
    case 'backoff': {
      const wait = Number.isFinite(s.nextRetryAt) ? Math.max(0, Math.ceil((s.nextRetryAt - now) / 1000)) : null;
      return { cls: 'warn', label: `Reconnecting${wait === null ? '' : ` in ${wait}s`}${attempt}` };
    }
    case 'unauthorized':
      return { cls: 'off', label: 'Unauthorized — check token' };
    case 'idle':
      return { cls: 'off', label: 'Stopped' };
    default:
      return { cls: 'off', label: 'Unknown' };
  }
}

const pill = (cls, label, title) =>
  `<span class="pill ${cls}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</span>`;

function rows(list) {
  return list.map(([label, value], i) => `
        <div class="row spread" style="padding:4px 0;${i < list.length - 1 ? ' border-bottom:1px solid var(--border)' : ''}">
          <span class="dim">${escapeHtml(label)}</span>
          ${value}
        </div>`).join('');
}

const text = (v, mono) => `<span${mono ? ' class="mono" style="font-size:11px"' : ''}>${escapeHtml(show(v))}</span>`;

// Pure: payload -> { swHtml, netHtml }. All interpolated values go through escapeHtml.
export function renderDiagnostics(payload, now = Date.now()) {
  // Normalize the sections once so every read below is a plain `data.<path>` of the payload.
  const src = payload || {};
  const data = {
    ...src,
    sw: src.sw || null,
    hub: src.hub || {},
    sse: src.sse || {},
    storage: src.storage || {},
    grants: src.grants || {},
    approvals: src.approvals || {},
    activeAlarms: Array.isArray(src.activeAlarms) ? src.activeAlarms : [],
  };

  const bytes = data.storage.bytesInUse;
  const quota = Number.isFinite(data.storage.quotaBytes) ? ` of ${formatBytes(data.storage.quotaBytes)}` : '';
  const alarmCount = data.activeAlarms.length;
  const swHtml = rows([
    ['Status:', data.sw ? pill('ok', 'Running (MV3 service worker)') : pill('off', 'Unknown')],
    ['Uptime:', text(data.sw ? formatDuration(data.sw.uptimeSeconds) : DASH)],
    ['Version:', text(`${show(data.version)} · MV${show(data.manifestVersion)}`)],
    ['Open Tabs:', text(data.openTabsCount ?? DASH)],
    ['Tab Groups:', text(data.tabGroupsCount ?? DASH)],
    ['Storage:', text(`${formatBytes(bytes)}${Number.isFinite(bytes) ? quota : ''}`)],
    ['Alarms:', text(alarmCount ? `${alarmCount} (${data.activeAlarms.join(', ')})` : '0')],
  ]);

  const sse = ssePill(data.sse, now);
  const sseTitle = [data.sse.detail, data.sse.reconnects ? `${data.sse.reconnects} reconnects` : '']
    .filter(Boolean).join(' · ');
  const latency = Number.isFinite(data.hub.latencyMs) ? data.hub.latencyMs : null;
  const reach = data.hub.reachable
    ? pill(latency !== null && latency > 400 ? 'warn' : 'ok', `Reachable${latency === null ? '' : ` · ${latency}ms`}`)
    : pill('off', 'Unreachable', data.hub.error || '');
  const pending = Number.isFinite(data.approvals.pending) ? data.approvals.pending : 0;
  const gate = data.approvals.enforced
    ? pill(pending ? 'warn' : 'ok', `On · ${pending} waiting`)
    : pill('off', 'Off');
  const grantCount = Number.isFinite(data.grants.count) ? data.grants.count : 0;
  const onceNote = data.grants.allowOnce ? ` (${data.grants.allowOnce} allow-once)` : '';
  const token = data.hub.tokenConfigured;

  const netHtml = rows([
    ['Hub URL:', text(data.hub.url, true)],
    ['Hub:', reach],
    ['Token:', pill(token ? 'ok' : 'off', token ? 'Configured' : 'Missing')],
    ['SSE Stream:', pill(sse.cls, sse.label, sseTitle)],
    ['Grants Active:', text(`${grantCount} origins${onceNote}`)],
    ['Approval Gate:', gate],
    ['Web Access:', pill(data.webAccessEnabled ? 'ok' : 'off', data.webAccessEnabled ? 'Enabled' : 'Disabled')],
  ]);

  return { swHtml, netHtml };
}

export function mountDiagnosticsView(container, send, toast, { isVisible } = {}) {
  if (!container) return null;

  container.innerHTML = `
    <div class="diag-wrap">
      <div class="row spread" style="margin-bottom:var(--sp-4)">
        <div>
          <strong>Extension Diagnostics</strong>
          <div class="dim" style="font-size:var(--text-xs)">Runtime health &amp; connection telemetry · auto-refreshes every 5s</div>
        </div>
        <div class="row" style="gap:var(--sp-2)">
          <button class="btn btn-ghost btn-sm" id="btn-copy-diag">Copy JSON</button>
          <button class="btn btn-primary btn-sm" id="btn-refresh-diag">Refresh</button>
        </div>
      </div>

      <div class="tab-tools-layout" style="margin-bottom:var(--sp-4)">
        <section class="card">
          <strong style="font-size:var(--text-xs); text-transform:uppercase; color:var(--dim)">Service Worker &amp; Runtime</strong>
          <div id="diag-sw-stats" class="mt" style="font-size:var(--text-sm)">Loading...</div>
        </section>
        <section class="card">
          <strong style="font-size:var(--text-xs); text-transform:uppercase; color:var(--dim)">Network &amp; Grants</strong>
          <div id="diag-net-stats" class="mt" style="font-size:var(--text-sm)">Loading...</div>
        </section>
      </div>

      <section class="card">
        <strong style="font-size:var(--text-xs); text-transform:uppercase; color:var(--dim)">Raw Diagnostics Payload</strong>
        <pre id="diag-raw" class="mono mt" style="background:var(--bg-surface); padding:var(--sp-3); border-radius:var(--r-sm); border:1px solid var(--border); font-size:11px; max-height:280px; overflow:auto; white-space:pre-wrap; word-break:break-word;"></pre>
      </section>
    </div>
  `;

  const swStats = container.querySelector('#diag-sw-stats');
  const netStats = container.querySelector('#diag-net-stats');
  const rawBox = container.querySelector('#diag-raw');
  const btnRefresh = container.querySelector('#btn-refresh-diag');
  const btnCopy = container.querySelector('#btn-copy-diag');

  let latestData = null;
  let inFlight = null;
  let debounceTimer = null;

  const visible = () => (typeof isVisible !== 'function' || isVisible())
    && (typeof document === 'undefined' || document.visibilityState !== 'hidden');

  // One request at a time: a refresh while one is running shares its result.
  function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await send({ type: 'get-diagnostics' });
        if (!res || res.ok === false) throw new Error((res && res.error) || 'no response from the service worker');
        const data = res.data || res;
        latestData = data;
        const html = renderDiagnostics(data);
        swStats.innerHTML = html.swHtml;
        netStats.innerHTML = html.netHtml;
        rawBox.textContent = JSON.stringify(data, null, 2);
        return { ok: true };
      } catch (e) {
        const message = (e && e.message) || String(e);
        rawBox.textContent = `Failed to fetch diagnostics: ${message}`;
        if (!latestData) {
          swStats.textContent = 'Unavailable';
          netStats.textContent = 'Unavailable';
        }
        return { ok: false, error: message };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function refreshSoon() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (visible()) refresh();
    }, DEBOUNCE_MS);
  }

  // SW status changes (sse-status / health / snapshot on the dashboard port).
  function onPortMessage(msg) {
    if (msg && REFRESH_KINDS.has(msg.kind) && visible()) refreshSoon();
  }

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.disabled = true;
    const r = await refresh();
    btnRefresh.disabled = false;
    if (toast) toast(r.ok ? 'Diagnostics refreshed' : `Diagnostics failed: ${r.error}`, r.ok ? 'ok' : 'error');
  });

  btnCopy.addEventListener('click', () => {
    if (!latestData) return;
    navigator.clipboard.writeText(JSON.stringify(latestData, null, 2)).then(
      () => { if (toast) toast('Copied diagnostics to clipboard', 'ok'); },
      () => { if (toast) toast('Copy failed', 'error'); },
    );
  });

  setInterval(() => { if (visible()) refresh(); }, AUTO_REFRESH_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (visible()) refresh(); });
  }

  refresh();

  return { refresh, onPortMessage };
}
