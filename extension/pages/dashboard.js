import { updateStatusPill, updateSseChip } from '../components/status-pill.js';
import { mountFrameViewer } from '../components/frame-viewer.js';
import { mountFeed } from '../components/activity-feed.js';
import { mountControlPad } from '../components/control-pad.js';
import { mountCatalog } from '../components/catalog-browser.js';
import { mountWebAccess } from '../components/web-access.js';
import { renderViewers } from '../components/inspection-viewer.js';
import { mountAgentConsole } from '../components/agent-console.js';
import { mountDiagnosticsView } from '../components/diagnostics-view.js';
import { mountThreatStateView } from '../components/threat-state-view.js';

const send = (msg) => chrome.runtime.sendMessage(msg);

// Auto-reload trigger for programmatic hot-reload
if (location.search.includes('autoreload=1')) {
  try {
    history.replaceState(null, '', location.pathname + '#live');
    setTimeout(() => {
      try { chrome.runtime.reload(); } catch {}
    }, 150);
  } catch {}
}

// First-run defaults: seed settings ONLY when none exist yet — never clobber
// a user-configured hub URL / token / web-access toggle on every open.
(async () => {
  try {
    const existing = await chrome.storage.local.get(null);
    if (!existing || Object.keys(existing).length === 0) {
      await send({
        type: 'update-settings',
        patch: { hubUrl: 'http://127.0.0.1:3000', onboardingComplete: true }
      });
    }
  } catch {}
})();

// ── Elements ──
const pill = document.getElementById('status-pill');
const sseChip = document.getElementById('sse-chip');
const deviceChip = document.getElementById('device-chip');
const toastContainer = document.getElementById('toasts');

// ── Toast system ──
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

// ── Tab switching ──
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

function switchTab(tabId) {
  for (const btn of tabBtns) btn.classList.toggle('active', btn.dataset.tab === tabId);
  for (const panel of tabPanels) panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  history.replaceState(null, '', '#' + tabId);
}

for (const btn of tabBtns) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

// Restore tab from hash
const initialTab = location.hash.replace('#', '') || 'live';
const ALL_TABS = ['live', 'activity', 'tools', 'web', 'agent', 'diagnostics', 'settings'];
if (ALL_TABS.includes(initialTab)) {
  switchTab(initialTab);
}

// Keyboard: 1-7 switch tabs
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const d = parseInt(e.key);
  if (d >= 1 && d <= ALL_TABS.length) switchTab(ALL_TABS[d - 1]);
});

// ── Mount components ──
const frame = mountFrameViewer(document.getElementById('frame'), send);
const feedCompact = mountFeed(document.getElementById('feed'));
const feedFull = mountFeed(document.getElementById('feed-full'));
mountControlPad(document.getElementById('control'), send, toast);
mountCatalog(document.getElementById('catalog'), send);
mountWebAccess(document.getElementById('web-access'), send);
renderViewers(document.getElementById('viewers-top'), send);
mountAgentConsole(document.getElementById('agent-console'), send, toast);
mountDiagnosticsView(document.getElementById('diagnostics-panel'), send, toast);
mountThreatStateView(document.getElementById('threat-state-panel'), send, toast);

// ── Header buttons ──
const reloadBtn = document.getElementById('btn-reload');
if (reloadBtn) {
  reloadBtn.onclick = async () => {
    toast('Reloading extension from disk...', 'ok');
    try {
      await send({ type: 'reload-extension' });
    } catch {
      try { chrome.runtime.reload(); } catch {}
    }
  };
}

document.getElementById('btn-pair').onclick = async () => {
  const s = await send({ type: 'get-status' });
  chrome.tabs.create({ url: s.settings.hubUrl.replace(/\/$/, '') + '/pair' });
};
document.getElementById('btn-setup').onclick = () => {
  location.href = 'onboarding.html';
};

// ── Status updates via port ──
function applySnapshot(cache) {
  updateStatusPill(pill, cache);
  updateSseChip(sseChip, cache);
  feedCompact.setAll(cache.events || []);
  feedFull.setAll(cache.events || []);
}

let port = null;
function connectPort() {
  try {
    port = chrome.runtime.connect({ name: 'dashboard' });
    port.onMessage.addListener(handlePortMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectPort, 1000);
    });
  } catch {
    setTimeout(connectPort, 2000);
  }
}

function handlePortMessage(msg) {
  if (!msg) return;
  switch (msg.kind) {
    case 'snapshot':
      if (msg.cache) applySnapshot(msg.cache);
      break;
    case 'sse':
      if (msg.event) {
        feedCompact.push(msg.event);
        feedFull.push(msg.event);
        if (msg.event.type === 'frame') frame.refresh();
        if (msg.event.type === 'inspection' || msg.event.type === 'patch') {
          renderViewers(document.getElementById('viewers-top'), send);
        }
      }
      break;
    case 'sse-status':
    case 'health':
      send({ type: 'get-status' }).then((r) => {
        if (r && r.cache) {
          updateStatusPill(pill, r.cache);
          updateSseChip(sseChip, r.cache);
        }
      }).catch(() => {});
      break;
  }
}

connectPort();

// ── Device chip ──
async function refreshDevice() {
  const r = await send({ type: 'get-device-status' });
  if (r.ok && r.result) {
    deviceChip.hidden = false;
    deviceChip.className = 'pill ' + (r.result.connected ? 'ok' : 'off');
    deviceChip.textContent = r.result.deviceModel
      ? `📱 ${r.result.deviceModel} · ${r.result.retainedFrames} frames`
      : 'no device';
  }
}

// ── Settings panel ──
async function renderSettings() {
  const body = document.getElementById('settings-body');
  const s = await send({ type: 'get-status' });
  body.innerHTML = '';

  const field = (label, value) => {
    const row = document.createElement('div');
    row.className = 'mt';
    const lbl = document.createElement('div');
    lbl.style.fontSize = 'var(--text-xs)';
    lbl.style.fontWeight = '600';
    lbl.style.color = 'var(--dim)';
    lbl.style.textTransform = 'uppercase';
    lbl.style.letterSpacing = '.04em';
    lbl.style.marginBottom = 'var(--sp-1)';
    lbl.textContent = label;
    const val = document.createElement('div');
    val.className = 'mono';
    val.textContent = value;
    row.append(lbl, val);
    body.appendChild(row);
  };

  field('Hub URL', s.settings.hubUrl || 'Not set');
  field('Token', s.settings.token ? '••••••••' : 'Not set');
  field('Onboarding', s.settings.onboardingComplete ? 'Complete' : 'Pending');
  field('Web Access', s.settings.webAccessEnabled ? 'Enabled' : 'Disabled');

  // Approval chime: the in-page approval dialog can ring a short chime (the OS notification sounds regardless).
  const chimeRow = document.createElement('label');
  chimeRow.className = 'row spread mt';
  chimeRow.style.gap = 'var(--sp-3)';
  const chimeText = document.createElement('span');
  chimeText.textContent = 'Chime on the page when an agent action waits for your approval';
  const chimeSwitch = document.createElement('span');
  chimeSwitch.className = 'switch';
  const chimeBox = document.createElement('input');
  chimeBox.type = 'checkbox';
  chimeBox.checked = s.settings.approvalChime !== false;
  const chimeSlider = document.createElement('span');
  chimeSlider.className = 'slider';
  chimeSwitch.append(chimeBox, chimeSlider);
  chimeRow.append(chimeText, chimeSwitch);
  chimeBox.onchange = async () => {
    await send({ type: 'update-settings', patch: { approvalChime: chimeBox.checked } });
    toast(chimeBox.checked ? 'Approval chime on' : 'Approval chime off', 'ok');
  };
  body.appendChild(chimeRow);

  const btns = document.createElement('div');
  btns.className = 'row mt-lg';

  const testBtn = document.createElement('button');
  testBtn.className = 'btn btn-ghost btn-sm';
  testBtn.textContent = 'Test Connection';
  testBtn.onclick = async () => {
    try {
      const r = await send({ type: 'probe', url: s.settings.hubUrl });
      toast(r.ok ? `Hub OK (${r.result.latencyMs}ms)` : 'Hub unreachable', r.ok ? 'ok' : 'error');
    } catch (e) { toast(e.message, 'error'); }
  };

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn-danger btn-sm';
  resetBtn.textContent = 'Reset & Re-setup';
  resetBtn.onclick = async () => {
    await send({ type: 'update-settings', patch: { onboardingComplete: false } });
    location.href = 'onboarding.html';
  };

  btns.append(testBtn, resetBtn);
  body.appendChild(btns);
}

// ── Boot ──
frame.refresh();
refreshDevice();
renderSettings();
setInterval(refreshDevice, 30000);
