import { updateStatusPill } from '../components/status-pill.js';
import { buildConnectKit } from '../lib/connect-kit.js';

const send = (msg) => chrome.runtime.sendMessage(msg);

const pill       = document.getElementById('pill');
const thumb      = document.getElementById('thumb');
const emptyBox   = document.getElementById('pop-empty');
const frameWrap  = document.getElementById('pop-frame-wrap');
const coordsBox  = document.getElementById('pop-coords');
const devBox     = document.getElementById('device-info');
const devModel   = document.getElementById('device-model');
const devFrames  = document.getElementById('device-frames');
const meta       = document.getElementById('meta');
const ver        = document.getElementById('version');

// Version badge
ver.textContent = 'v' + chrome.runtime.getManifest().version;

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

// Initial load
async function loadInitialStatus() {
  const r = await send({ type: 'get-status' });
  if (r && r.cache) {
    updateStatusPill(pill, r.cache);
    if (r.cache.lastFrameAt) {
      meta.textContent = 'Last: ' + new Date(r.cache.lastFrameAt).toLocaleTimeString();
    } else {
      meta.textContent = 'No frames yet';
    }
  }

  if (r && r.settings && !r.settings.onboardingComplete) {
    location.href = 'onboarding.html';
  }
}
loadInitialStatus();

// Thumbnail refresh
async function refreshThumb() {
  const f = await send({ type: 'get-latest-frame' });
  if (f && f.ok && f.result && f.result.imageDataUrl) {
    thumb.src = f.result.imageDataUrl;
    thumb.hidden = false;
    if (emptyBox) emptyBox.style.display = 'none';
    if (f.result.capturedAt) {
      meta.textContent = 'Last: ' + new Date(f.result.capturedAt).toLocaleTimeString();
    }
  }
}
refreshThumb();

// Device info
async function refreshDevice() {
  const d = await send({ type: 'get-device-status' });
  if (d && d.ok && d.result && d.result.connected) {
    devBox.hidden = false;
    devModel.textContent = d.result.deviceModel || 'Android';
    devFrames.textContent = `${d.result.retainedFrames || 0} frames`;
  }
}
refreshDevice();

// Auto-refresh every 3s
setInterval(() => {
  refreshThumb();
  refreshDevice();
}, 3000);

// Interactive frame tap in popup
frameWrap.addEventListener('mousemove', (e) => {
  if (thumb.hidden) return;
  const r = thumb.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
    coordsBox.style.opacity = '0';
    return;
  }
  const x = Math.round(((e.clientX - r.left) / r.width) * thumb.naturalWidth);
  const y = Math.round(((e.clientY - r.top) / r.height) * thumb.naturalHeight);
  coordsBox.textContent = `${x}, ${y}`;
  coordsBox.style.opacity = '1';
});

frameWrap.addEventListener('mouseleave', () => {
  coordsBox.style.opacity = '0';
});

frameWrap.addEventListener('click', async (e) => {
  if (thumb.hidden) return;
  const r = thumb.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;

  const x = Math.round(((e.clientX - r.left) / r.width) * thumb.naturalWidth);
  const y = Math.round(((e.clientY - r.top) / r.height) * thumb.naturalHeight);

  // Visual tap ripple
  const ripple = document.createElement('span');
  ripple.className = 'tap-ripple';
  ripple.style.left = `${e.clientX - r.left}px`;
  ripple.style.top = `${e.clientY - r.top}px`;
  frameWrap.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

  await send({ type: 'send-control', action: 'tap', body: { x, y } });
});

// Quick action buttons
document.getElementById('qa-shot').onclick = () =>
  send({ type: 'send-control', action: 'screenshot', body: {} });

document.getElementById('qa-home').onclick = () =>
  send({ type: 'send-control', action: 'key', body: { key: 'HOME' } });

document.getElementById('qa-back').onclick = () =>
  send({ type: 'send-control', action: 'key', body: { key: 'BACK' } });

document.getElementById('qa-copy').onclick = async () => {
  const s = await send({ type: 'get-status' });
  const kit = buildConnectKit({
    hubUrl: s.settings?.hubUrl || 'http://127.0.0.1:3000',
    token: s.settings?.token || 'screensync-local-dev',
  });
  await navigator.clipboard.writeText(kit);
  const btn = document.getElementById('qa-copy');
  btn.setAttribute('data-tooltip', 'Copied ✓');
  setTimeout(() => btn.setAttribute('data-tooltip', 'Copy Connect Kit'), 2000);
};

const reloadBtn = document.getElementById('qa-reload');
if (reloadBtn) {
  reloadBtn.onclick = async () => {
    reloadBtn.setAttribute('data-tooltip', 'Reloading…');
    try {
      await send({ type: 'reload-extension' });
    } catch {
      try { chrome.runtime.reload(); } catch {}
    }
  };
}

// Navigation
const sideBtn = document.getElementById('open-side');
if (sideBtn) {
  // chrome.sidePanel.open() must be called while the user gesture is still live.
  // A runtime.sendMessage hop to the service worker loses user activation, and the
  // worker's call then rejects with "may only be called in response to a user
  // gesture" - which is why this button did nothing. Call it from the popup first.
  sideBtn.onclick = async () => {
    try {
      if (chrome.sidePanel && chrome.sidePanel.open && chrome.windows) {
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
        window.close();
        return;
      }
    } catch (err) {
      console.warn('[ss] sidePanel.open from popup failed, falling back:', err);
    }
    try {
      const r = await send({ type: 'open-side-panel' });
      if (!r || !r.ok) send({ type: 'open-dashboard' });
    } catch {
      send({ type: 'open-dashboard' });
    }
    window.close();
  };
}
document.getElementById('open').onclick = () => send({ type: 'open-dashboard' });
document.getElementById('setup').onclick = () => { location.href = 'onboarding.html'; };
