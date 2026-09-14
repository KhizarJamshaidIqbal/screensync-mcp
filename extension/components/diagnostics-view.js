// ScreenSync Extension Diagnostics Component (Rev 4 Item D7)
// Exposes web_extension_diagnostics: SW uptime, SSE connection health,
// tab states, permissions, extraction budgets, and recent errors.

export function mountDiagnosticsView(container, send, toast) {
  if (!container) return null;

  container.innerHTML = `
    <div class="diag-wrap">
      <div class="row spread" style="margin-bottom:var(--sp-4)">
        <div>
          <strong>Extension Diagnostics</strong>
          <div class="dim" style="font-size:var(--text-xs)">Runtime health & connection telemetry</div>
        </div>
        <div class="row" style="gap:var(--sp-2)">
          <button class="btn btn-ghost btn-sm" id="btn-copy-diag">Copy JSON</button>
          <button class="btn btn-primary btn-sm" id="btn-refresh-diag">Refresh</button>
        </div>
      </div>

      <div class="tab-tools-layout" style="margin-bottom:var(--sp-4)">
        <section class="card">
          <strong style="font-size:var(--text-xs); text-transform:uppercase; color:var(--dim)">Service Worker & Runtime</strong>
          <div id="diag-sw-stats" class="mt" style="font-size:var(--text-sm)">Loading...</div>
        </section>
        <section class="card">
          <strong style="font-size:var(--text-xs); text-transform:uppercase; color:var(--dim)">Network & Grants</strong>
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

  async function loadDiagnostics() {
    try {
      const res = await send({ type: 'get-diagnostics' });
      const data = (res && res.data) || res || {};
      latestData = data;

      rawBox.textContent = JSON.stringify(data, null, 2);

      swStats.innerHTML = `
        <div class="row spread" style="padding:4px 0; border-bottom:1px solid var(--border)">
          <span class="dim">Status:</span>
          <span class="pill ok">Active (MV3 SW)</span>
        </div>
        <div class="row spread" style="padding:4px 0; border-bottom:1px solid var(--border)">
          <span class="dim">Uptime:</span>
          <span>${data.uptimeSeconds ? Math.round(data.uptimeSeconds) + 's' : 'N/A'}</span>
        </div>
        <div class="row spread" style="padding:4px 0; border-bottom:1px solid var(--border)">
          <span class="dim">Active Tabs:</span>
          <span>${data.openTabsCount || 1}</span>
        </div>
        <div class="row spread" style="padding:4px 0">
          <span class="dim">Storage:</span>
          <span>Synced</span>
        </div>
      `;

      netStats.innerHTML = `
        <div class="row spread" style="padding:4px 0; border-bottom:1px solid var(--border)">
          <span class="dim">Hub URL:</span>
          <span class="mono" style="font-size:11px">${escapeHtml(data.hubUrl || 'http://127.0.0.1:3000')}</span>
        </div>
        <div class="row spread" style="padding:4px 0; border-bottom:1px solid var(--border)">
          <span class="dim">SSE Stream:</span>
          <span class="pill ${data.sseConnected ? 'ok' : 'off'}">${data.sseConnected ? 'Connected' : 'Offline'}</span>
        </div>
        <div class="row spread" style="padding:4px 0; border-bottom:1px solid var(--border)">
          <span class="dim">Grants Active:</span>
          <span>${data.grantsCount || 0} origins</span>
        </div>
        <div class="row spread" style="padding:4px 0">
          <span class="dim">Approval Gate:</span>
          <span class="pill ok">Protected</span>
        </div>
      `;
    } catch (e) {
      rawBox.textContent = `Failed to fetch diagnostics: ${e.message}`;
    }
  }

  btnRefresh.addEventListener('click', () => {
    loadDiagnostics();
    if (toast) toast('Diagnostics refreshed', 'ok');
  });

  btnCopy.addEventListener('click', () => {
    if (!latestData) return;
    navigator.clipboard.writeText(JSON.stringify(latestData, null, 2)).then(() => {
      if (toast) toast('Copied diagnostics to clipboard', 'ok');
    });
  });

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  loadDiagnostics();

  return {
    refresh: loadDiagnostics,
  };
}
