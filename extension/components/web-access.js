import { escapeHtml } from '../lib/escape.js';
import { mountApprovalQueue } from './approval-queue.js';
export function mountWebAccess(el, send) {
  el.innerHTML = `
    <div class="web-card">
      <div class="web-header">
        <strong>Web Access for AI Agents</strong>
        <label class="switch" title="Allow the AI agent to see and act on your browser tabs">
          <input type="checkbox" id="web-toggle">
          <span class="slider"></span>
        </label>
      </div>
      <div class="dim" style="font-size:var(--text-xs);line-height:1.5">
        When enabled, your AI agent can see the active tab (web_screenshot), read the page
        (web_hierarchy) and act on it (web_click / web_type / web_navigate / web_scroll)
        through the ScreenSync hub — subject to per-origin grants and the destructive approval gate.
      </div>
      <div class="web-status-card">
        <div class="row spread">
          <span class="pill off" id="web-pill">checking…</span>
          <button class="btn btn-ghost btn-sm" id="web-test">Test loop</button>
        </div>
        <div class="web-tab-info" id="web-tab" style="display:none"></div>
      </div>
      <div class="err" id="web-err" style="font-size:var(--text-xs)" hidden></div>

      <!-- Pending approvals: a person decides anything destructive (see components/approval-queue.js) -->
      <div id="approvals-section" style="margin-top:16px"></div>

      <!-- Origin Grants Management -->
      <div style="margin-top:20px">
        <div class="row spread" style="margin-bottom:8px">
          <strong>Per-Origin Access Grants</strong>
          <span class="dim" style="font-size:var(--text-xs)">Read · Act · Cookies</span>
        </div>
        <div class="row" style="gap:6px;margin-bottom:8px">
          <input type="text" id="new-origin-input" placeholder="https://example.com" class="input-sm" style="flex:1">
          <button class="btn btn-primary btn-sm" id="btn-add-grant">Add Grant</button>
        </div>
        <div id="grants-list" style="font-size:var(--text-xs);display:flex;flex-direction:column;gap:4px"></div>
      </div>

      <!-- Audit Log & Budget -->
      <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:14px">
        <div class="row spread" style="margin-bottom:8px">
          <strong>Audit Trail & Budget</strong>
          <button class="btn btn-ghost btn-sm" id="btn-export-audit">Export Audit Log</button>
        </div>
        <div id="audit-summary" class="dim" style="font-size:var(--text-xs);margin-bottom:8px"></div>
        <div id="audit-entries" style="font-size:var(--text-xs);max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
      </div>
    </div>`;

  const toggle = el.querySelector('#web-toggle');
  const pill = el.querySelector('#web-pill');
  const tabRow = el.querySelector('#web-tab');
  const errRow = el.querySelector('#web-err');
  const testBtn = el.querySelector('#web-test');
  const approvals = mountApprovalQueue(el.querySelector('#approvals-section'), send);
  const newOriginInput = el.querySelector('#new-origin-input');
  const addGrantBtn = el.querySelector('#btn-add-grant');
  const grantsList = el.querySelector('#grants-list');
  const exportAuditBtn = el.querySelector('#btn-export-audit');
  const auditSummary = el.querySelector('#audit-summary');
  const auditEntries = el.querySelector('#audit-entries');

  let busy = false;

  async function refresh() {
    const r = await send({ type: 'get-web-status' });
    if (!r.ok) return;
    toggle.checked = !!r.webAccessEnabled;
    // This browser's own entry on the hub (web-status-self.js), not the hub's routing target.
    const b = r.self || { online: !!(r.bridge && r.bridge.online), activeTab: r.bridge && r.bridge.activeTab };
    if (b.online && r.webAccessEnabled) {
      pill.className = 'pill ok';
      pill.textContent = 'Bridge live · agents can use my browser';
    } else if (b.online) {
      pill.className = 'pill warn';
      pill.textContent = 'Bridge live · access is OFF';
    } else {
      pill.className = 'pill off';
      pill.textContent = 'Waiting for hub heartbeat…';
    }
    if (b.activeTab && b.activeTab.url) {
      tabRow.style.display = 'flex';
      tabRow.textContent = '';
      const title = document.createElement('span');
      title.textContent = (b.activeTab.title ? b.activeTab.title + ' — ' : '') + b.activeTab.url;
      title.style.fontSize = 'var(--text-xs)';
      tabRow.appendChild(title);
    } else {
      tabRow.style.display = 'none';
    }
    errRow.hidden = true;

    await approvals.refresh();

    // Refresh grants
    const grantsRes = await send({ type: 'get-grants' });
    const grants = (grantsRes && grantsRes.grants) || {};
    grantsList.innerHTML = '';
    const grantKeys = Object.keys(grants);
    if (grantKeys.length === 0) {
      grantsList.innerHTML = '<span class="dim">No origin grants configured. Localhost and tests are permitted by default.</span>';
    } else {
      grantKeys.forEach((orig) => {
        const g = grants[orig];
        const row = document.createElement('div');
        row.className = 'row spread card';
        row.style.padding = '6px 10px';
        row.innerHTML = `
          <div>
            <code>${escapeHtml(orig)}</code>
            <span class="dim" style="margin-left:6px">${g.read ? '✓ Read' : '✗ Read'} · ${g.act ? '✓ Act' : '✗ Act'} · ${g.cookies ? '✓ Cookies' : '✗ Cookies'}${g.allowOnceUntil ? ` · allowed once until ${escapeHtml(new Date(g.allowOnceUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}` : ''}</span>
          </div>
          <button class="btn btn-sm btn-ghost" data-revoke="${escapeHtml(orig)}">Revoke</button>`;
        grantsList.appendChild(row);
      });
    }

    // Refresh audit
    const auditRes = await send({ type: 'get-audit-log', args: { limit: 8 } });
    if (auditRes && auditRes.ok && auditRes.data) {
      const { entries, totalCount } = auditRes.data;
      auditSummary.textContent = `Showing last ${entries ? entries.length : 0} of ${totalCount || 0} recorded tool operations.`;
      auditEntries.innerHTML = '';
      (entries || []).forEach((e) => {
        const item = document.createElement('div');
        item.className = 'row spread';
        item.style.padding = '3px 0';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.innerHTML = `
          <span><code>${escapeHtml(e.tool)}</code> ${e.ok ? '<span style="color:var(--low)">✓</span>' : '<span style="color:var(--crit)">✗</span>'}</span>
          <span class="dim">${e.durationMs || 0}ms · ${new Date(e.timestamp || Date.now()).toLocaleTimeString()}</span>`;
        auditEntries.appendChild(item);
      });
    }
  }

  toggle.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    try {
      await send({ type: 'set-web-access', enabled: toggle.checked });
      await refresh();
    } finally { busy = false; }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    errRow.hidden = true;
    try {
      const r = await send({ type: 'web-test' });
      const res = r.result || {};
      if (r.ok && res.ok && (r.self ? r.self.online : res.data && res.data.online)) {
        testBtn.textContent = 'Loop OK ✓';
        await refresh();
      } else if (r.ok && res.ok) {
        testBtn.textContent = 'Test loop';
        errRow.textContent = 'Hub reachable but the bridge heartbeat is missing — reload this dashboard once.';
        errRow.hidden = false;
      } else {
        testBtn.textContent = 'Test loop';
        errRow.textContent = res.error || r.error || 'Web loop failed.';
        errRow.hidden = false;
      }
    } finally {
      testBtn.disabled = false;
      setTimeout(() => (testBtn.textContent = 'Test loop'), 1500);
    }
  });

  addGrantBtn.addEventListener('click', async () => {
    const val = (newOriginInput.value || '').trim();
    if (!val) return;
    addGrantBtn.disabled = true;
    try {
      await send({ type: 'set-grant', origin: val, grant: { read: true, act: true, cookies: false } });
      newOriginInput.value = '';
      await refresh();
    } finally { addGrantBtn.disabled = false; }
  });

  grantsList.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-revoke]');
    if (!btn) return;
    const orig = btn.getAttribute('data-revoke');
    await send({ type: 'revoke-grant', origin: orig });
    await refresh();
  });

  exportAuditBtn.addEventListener('click', async () => {
    exportAuditBtn.disabled = true;
    try {
      const r = await send({ type: 'export-audit-log' });
      if (r && r.ok && r.data) {
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screensync-audit-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally { exportAuditBtn.disabled = false; }
  });

  refresh();
  setInterval(() => { if (!busy) refresh(); }, 30000);
}
