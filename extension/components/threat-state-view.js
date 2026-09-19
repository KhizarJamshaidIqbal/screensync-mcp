import { escapeHtml } from '../lib/escape.js';
// ScreenSync Threat Breaker Panel (Architecture 12.0, subsystem 3)
// Surfaces web_amygdala_threat_inoculation state: which domains are backed off,
// what tripped them, and how far the conditioned fear has decayed. The breaker is
// owned by the hub, so this reads it there (see lib/threat-state.js).
//
// This panel reports a DEFENSIVE posture. A tripped breaker means automation has
// stopped and the human is being asked to take over - it is never a prompt to
// evade or retry through a challenge.

const STATE_PILL = {
  ARMED: { cls: 'ok', label: 'Armed' },
  EXTINGUISHING: { cls: 'warn', label: 'Extinguishing' },
  TRIPPED: { cls: 'off', label: 'Tripped' },
};

export function mountThreatStateView(container, send, toast) {
  if (!container) return null;

  container.innerHTML = `
    <div class="row spread" style="margin-bottom:var(--sp-4)">
      <div>
        <strong>Threat Breaker</strong>
        <div class="dim" style="font-size:var(--text-xs)">Domains backed off after a bot challenge, and their fear decay</div>
      </div>
      <button class="btn btn-ghost btn-sm" id="btn-refresh-threats">Refresh</button>
    </div>
    <div id="threat-rows" style="font-size:var(--text-sm)">Loading...</div>
  `;

  const rows = container.querySelector('#threat-rows');
  const btnRefresh = container.querySelector('#btn-refresh-threats');

  function renderRow(t) {
    const pill = STATE_PILL[t.breakerState] || STATE_PILL.ARMED;
    const fear = Math.round((t.fearWeight || 0) * 100);
    const tripped = t.lastTrippedAt ? new Date(t.lastTrippedAt).toLocaleTimeString() : '-';
    return `
      <div style="padding:8px 0; border-bottom:1px solid var(--border)">
        <div class="row spread">
          <span class="mono" style="font-size:12px">${escapeHtml(t.domain || '')}</span>
          <span class="pill ${pill.cls}">${pill.label}</span>
        </div>
        <div class="row spread dim" style="font-size:var(--text-xs); margin-top:4px">
          <span>Tripped by: ${escapeHtml(t.lastFingerprint || 'none')}</span>
          <span>Fear ${fear}%</span>
        </div>
        <div class="row spread dim" style="font-size:var(--text-xs)">
          <span>Last trip: ${escapeHtml(tripped)}</span>
          <span>${t.consecutiveTrips || 0} consecutive · ${t.cleanEncounters || 0} clean</span>
        </div>
      </div>
    `;
  }

  async function loadThreats() {
    try {
      const res = await send({ type: 'get-threat-state' });
      // The breaker lives in the hub. If we cannot reach it we do NOT know the state, and
      // must not fall through to the "every breaker is armed" message below.
      if (!res || res.ok !== true) {
        rows.innerHTML = `<div class="dim">Breaker state unknown - the hub could not be read (${escapeHtml((res && res.error) || 'no response')}).</div>`;
        return;
      }
      const threats = res.threats || [];
      if (!threats.length) {
        rows.innerHTML = `<div class="dim">No domain has raised a challenge this session. Every breaker is armed.</div>`;
        return;
      }
      const tripped = threats.filter((t) => t.breakerState === 'TRIPPED').length;
      rows.innerHTML =
        `<div class="dim" style="margin-bottom:6px">${threats.length} domain(s) tracked · ${tripped} currently backed off</div>` +
        threats.map(renderRow).join('');
    } catch (e) {
      rows.textContent = `Failed to read threat state: ${e.message}`;
    }
  }

  btnRefresh.addEventListener('click', () => {
    loadThreats();
    if (toast) toast('Threat state refreshed');
  });

  loadThreats();
  return { refresh: loadThreats };
}
