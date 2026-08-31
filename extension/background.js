console.info('[ss] sw boot');
self.addEventListener('error', (e) => console.error('[ss] sw error:', e.message));
self.addEventListener('unhandledrejection', (e) => console.error('[ss] sw rejection:', String(e.reason)));

import { getSettings, saveSettings } from './lib/storage.js';
import { api, probeHub, hubFetch } from './lib/api.js';
import { SseClient } from './lib/sse-client.js';
import { handleWebRequest, registerWebBridge } from './lib/web-tools.js';
import {
  GUIDE_URL, FALLBACK_GUIDE, HEALTH_ALARM, HEALTH_PERIOD_S, EVENT_LOG_CAP,
} from './lib/constants.js';

const cache = {
  healthOk: null,
  latencyMs: null,
  lastFrameAt: null,
  sseStatus: 'stopped',
  sseDetail: null,
  events: [],
};

const ports = new Set();

function broadcast(msg) {
  for (const p of ports) {
    try { p.postMessage(msg); } catch { /* port closed */ }
  }
}

function snapshot() {
  return { kind: 'snapshot', cache, settings: null };
}

const sse = new SseClient({
  onEvent: (ev) => {
    // Web bridge: the hub relays an agent's web_* tool call to us. Execute it
    // against the user's browser and POST the result back — don't chart it
    // as a normal feed event.
    if (ev && ev.type === 'web_request') {
      handleWebRequest(ev);
      return;
    }
    // Live web_watch frames are high-volume; relay them to the dashboard live
    // view only, never into the bounded feed cache.
    if (ev && ev.type === 'web_frame') return;
    cache.events.unshift(ev);
    if (cache.events.length > EVENT_LOG_CAP) cache.events.length = EVENT_LOG_CAP;
    if (ev.type === 'frame' && ev.at) cache.lastFrameAt = ev.at;
    broadcast({ kind: 'sse', event: ev });
  },
  onStatus: (s, detail) => {
    cache.sseStatus = s;
    cache.sseDetail = detail || null;
    broadcast({ kind: 'sse-status', status: s, detail });
  },
});

async function ensureSse() {
  const s = await getSettings();
  if (!s.onboardingComplete) return;
  if (sse.connected || cache.sseStatus === 'connecting') return;
  sse.start(s.hubUrl, s.token);
}

async function pollHealth() {
  const s = await getSettings();
  try {
    const h = await probeHub(s.hubUrl);
    cache.healthOk = true;
    cache.latencyMs = h.latencyMs;
    cache.lastFrameAt = h.latestFrameAt ?? cache.lastFrameAt;
  } catch {
    cache.healthOk = false;
    cache.latencyMs = null;
  }
  broadcast({ kind: 'health', cache });
}

chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== HEALTH_ALARM) return;
  await pollHealth();
  await ensureSse(); // revive SSE if the SW was terminated
  await registerWebBridge(); // keeps web-bridge presence fresh on the hub
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  if (!s.onboardingComplete) {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/onboarding.html') });
  }
});

chrome.runtime.onStartup.addListener(() => {
  pollHealth();
  ensureSse();
  registerWebBridge();
});

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  getSettings().then((settings) => {
    try { port.postMessage({ kind: 'snapshot', cache, settings }); } catch { /* closed */ }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'get-status': {
          const settings = await getSettings();
          sendResponse({ ok: true, cache, settings });
          break;
        }
        case 'probe': {
          sendResponse({ ok: true, result: await probeHub(msg.url) });
          break;
        }
        case 'get-latest-frame':
          sendResponse({ ok: true, result: await api.latestFrame() });
          break;
        case 'get-catalog':
          sendResponse({ ok: true, result: await api.catalog() });
          break;
        case 'get-inspection':
          sendResponse({ ok: true, result: await api.inspection() });
          break;
        case 'get-patch':
          sendResponse({ ok: true, result: await api.patch() });
          break;
        case 'get-device-status':
          sendResponse({ ok: true, result: await api.deviceStatus() });
          break;
        case 'send-control':
          sendResponse({ ok: true, result: await api.control(msg.action, msg.body || {}) });
          break;
        case 'update-settings': {
          const settings = await saveSettings(msg.patch);
          sse.stop();
          await ensureSse();
          pollHealth();
          registerWebBridge();
          broadcast({ kind: 'settings', settings });
          sendResponse({ ok: true, settings });
          break;
        }
        case 'get-web-status': {
          // Hub-side presence (is the hub seeing our heartbeat) + local toggle.
          const settings = await getSettings();
          let bridge = { online: false, error: 'hub unreachable' };
          try {
            const r = await hubFetch('/api/web/status');
            bridge = r.status || r;
          } catch (e) { bridge = { online: false, error: e.message }; }
          sendResponse({ ok: true, webAccessEnabled: !!settings.webAccessEnabled, bridge });
          break;
        }
        case 'set-web-access': {
          const settings = await saveSettings({ webAccessEnabled: !!msg.enabled });
          await registerWebBridge();
          broadcast({ kind: 'settings', settings });
          sendResponse({ ok: true, webAccessEnabled: settings.webAccessEnabled });
          break;
        }
        case 'web-test': {
          // Runs the exact route an agent's web_* call takes, so the user
          // can prove the loop before trusting it.
          try {
            const result = await hubFetch('/api/web/tool', { method: 'POST', body: { tool: 'web_status', args: {} } });
            sendResponse({ ok: true, result });
          } catch (e) {
            sendResponse({ ok: true, result: { ok: false, error: e.message } });
          }
          break;
        }
        case 'get-guide': {
          const s = await getSettings();
          if (s.setupGuideCache) {
            sendResponse({ ok: true, guide: s.setupGuideCache, cached: true });
            break;
          }
          try {
            const res = await fetch(GUIDE_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`guide ${res.status}`);
            const guide = await res.json();
            saveSettings({ setupGuideCache: guide, setupGuideFetchedAt: new Date().toISOString() });
            sendResponse({ ok: true, guide, cached: false });
          } catch {
            sendResponse({ ok: true, guide: FALLBACK_GUIDE, cached: true, fallback: true });
          }
          break;
        }
        case 'open-dashboard':
          chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: `unknown message ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message, status: e.status });
    }
  })();
  return true; // async response
});

// Boot.
pollHealth();
ensureSse();
registerWebBridge();
