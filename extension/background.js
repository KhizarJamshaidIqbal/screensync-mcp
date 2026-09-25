import { getSettings, saveSettings } from './lib/storage.js';
import { api, probeHub, hubFetch, isLoopbackHub } from './lib/api.js';
import { SseClient } from './lib/sse-client.js';
import { createSseSupervisor } from './lib/sse-supervisor.js';
import { provideSwState } from './lib/sw-state.js';
import { getInstanceId } from './lib/profile-identity.js';
import { handleWebRequest, registerWebBridge } from './lib/web-bridge.js';
import { selfBridgeStatus } from './lib/web-status-self.js';
import { startAmbientCollector } from './lib/web-ambient.js';
import { getGrantsForDisplay, saveOriginGrant, revokeOriginGrant, getPendingApprovals, resolveApproval } from './lib/consent.js';
import { getAuditLog, exportAuditLog } from './lib/audit.js';
import { getTakeoverStatus, resumeTakeover } from './lib/takeover.js';
import { listJobs, cancelJob } from './lib/jobs.js';
import { execExtensionDiagnostics } from './lib/web-diag.js';
import { fetchThreatState } from './lib/threat-state.js';
import { setupContextMenus, installMenusAndCommands } from './lib/sw-menus.js';
import { ownerMessagesOnly, ownerPortsOnly, lockStorageToOwnerContexts } from './lib/owner-pages.js';
import {
  GUIDE_URL, FALLBACK_GUIDE, HEALTH_ALARM, EVENT_LOG_CAP, DEFAULT_TOKEN,
} from './lib/constants.js';

console.info('[ss] sw boot');
self.addEventListener('error', (e) => console.error('[ss] sw error:', e.message));
self.addEventListener('unhandledrejection', (e) => console.error('[ss] sw rejection:', String(e.reason)));

lockStorageToOwnerContexts();
startAmbientCollector();

const cache = {
  healthOk: null,
  latencyMs: null,
  lastFrameAt: null,
  sseStatus: 'stopped',
  sseDetail: null,
  sse: null, // SseClient.snapshot(): state/open/lastDataAt/backoff... (sseStatus stays for the status pill)
  healthCheckedAt: null,
  events: [],
};

const ports = new Set();

function broadcast(msg) {
  for (const p of ports) {
    try { p.postMessage(msg); } catch { /* port closed */ }
  }
}

const sse = new SseClient({
  onEvent: (ev) => {
    if (ev && ev.type === 'dev_hot_reload') {
      console.info('[ss] Dev hot reload received from hub. Reloading runtime...');
      try { chrome.runtime.reload(); } catch {}
      return;
    }
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
    cache.sse = sse.snapshot();
    broadcast({ kind: 'sse-status', status: s, detail });
  },
});

// When to (re)connect lives in the supervisor: ensure() is safe to call from every wake-up source below.
const sup = createSseSupervisor(sse, { getInstanceId });
provideSwState('sse', () => sup.snapshot());
provideSwState('health', () => ({ ok: cache.healthOk, latencyMs: cache.latencyMs, checkedAt: cache.healthCheckedAt }));

// The cache with a fresh SSE snapshot (lastDataAt moves on every keepalive without a status change).
function liveCache() {
  cache.sse = sse.snapshot();
  return cache;
}

async function pollHealth() {
  const s = await getSettings();
  try {
    const h = await probeHub(s.hubUrl);
    cache.healthOk = true;
    cache.latencyMs = h.latencyMs;
    cache.lastFrameAt = h.latestFrameAt ?? cache.lastFrameAt;
    sup.hubReachable(); // the hub is back: end a long SSE backoff sleep now
    if (isLoopbackHub(s.hubUrl) && (!s.onboardingComplete || !s.token)) {
      await saveSettings({
        token: s.token || DEFAULT_TOKEN,
        onboardingComplete: true,
      });
      await sup.ensure('auto-onboard');
      await registerWebBridge();
    }
  } catch {
    cache.healthOk = false;
    cache.latencyMs = null;
  }
  cache.healthCheckedAt = Date.now();
  broadcast({ kind: 'health', cache: liveCache() });
}

async function ensureOffscreenDoc() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) return false;
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return true;
    await chrome.offscreen.createDocument({
      url: 'pages/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Keep background service worker active and perform canvas diffing',
    });
    return true;
  } catch (e) {
    if (String(e).includes('Only a single offscreen')) return true;
    return false;
  }
}

chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== HEALTH_ALARM) return;
  await pollHealth();
  await sup.ensure('alarm'); // revive SSE if the SW was terminated
  await registerWebBridge(); // keeps web-bridge presence fresh on the hub
  await ensureOffscreenDoc();
});

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(async () => {
    await sup.ensure('tab-activated');
    await registerWebBridge();
    await ensureOffscreenDoc();
  });
}
if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
    if (changeInfo.status === 'complete') {
      await sup.ensure('page-loaded');
      await registerWebBridge();
      await ensureOffscreenDoc();
    }
  });
}

ensureOffscreenDoc().catch(() => {});

installMenusAndCommands({ broadcast });

chrome.runtime.onInstalled.addListener(async () => {
  setupContextMenus();
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
  await boot();
  const s = await getSettings();
  if (!s.onboardingComplete) {
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/onboarding.html') });
  }
});

let isBooting = false;
async function boot() {
  if (isBooting) return;
  isBooting = true;
  try {
    await pollHealth();
    await sup.ensure('boot');
    await registerWebBridge();
    await ensureOffscreenDoc();
  } catch (e) {
    console.warn('[ss] boot error:', e.message);
  } finally {
    isBooting = false;
  }
}

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  boot();
});

// Immediate boot connection whenever SW initializes
boot().catch(() => {});

chrome.runtime.onConnect.addListener(ownerPortsOnly((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  getSettings().then((settings) => {
    try { port.postMessage({ kind: 'snapshot', cache: liveCache(), settings }); } catch { /* closed */ }
  });
}));

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    console.info('[ss] tab closed:', tabId);
  });
}

if (chrome.tabs && chrome.tabs.onReplaced) {
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    console.info('[ss] tab replaced:', removedTabId, '->', addedTabId);
  });
}

chrome.runtime.onMessage.addListener(ownerMessagesOnly((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'get-status': {
          const settings = await getSettings();
          sendResponse({ ok: true, cache: liveCache(), settings });
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
          await sup.ensure('settings', { retryUnauthorized: true });
          pollHealth();
          await registerWebBridge();
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
          // `bridge` describes the hub's routing target; `self` is THIS browser (web-status-self.js).
          const self = selfBridgeStatus(bridge, await getInstanceId().catch(() => null));
          sendResponse({ ok: true, webAccessEnabled: !!settings.webAccessEnabled, bridge, self });
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
            const self = selfBridgeStatus(result && result.data, await getInstanceId().catch(() => null));
            sendResponse({ ok: true, result, self });
          } catch (e) {
            sendResponse({ ok: true, result: { ok: false, error: e.message } });
          }
          break;
        }
        case 'test-hub': {
          const testUrl = msg.url || (await getSettings()).hubUrl;
          const testToken = msg.token !== undefined ? msg.token : (await getSettings()).token;
          try {
            const res = await hubFetch('/api/web/status', {
              method: 'GET',
              url: testUrl,
              token: testToken,
              timeoutMs: 4000,
            });
            sendResponse({ ok: true, result: res });
          } catch (e) {
            sendResponse({ ok: false, error: e.message, status: e.status });
          }
          break;
        }
        case 'get-grants': {
          const grants = await getGrantsForDisplay(); // saved grants + live "Allow once" ones
          sendResponse({ ok: true, grants });
          break;
        }
        case 'set-grant': {
          const grant = await saveOriginGrant(msg.origin, msg.grant || {});
          sendResponse({ ok: true, origin: msg.origin, grant });
          break;
        }
        case 'revoke-grant': {
          const res = await revokeOriginGrant(msg.origin);
          sendResponse({ ok: true, ...res });
          break;
        }
        case 'get-approvals': {
          sendResponse({ ok: true, approvals: getPendingApprovals() });
          break;
        }
        case 'resolve-approval': {
          const res = resolveApproval(msg.id, !!msg.approved, msg.decision === 'always' ? 'always' : 'once');
          sendResponse(res);
          break;
        }
        case 'get-audit-log': {
          const log = await getAuditLog(msg.args || {});
          sendResponse(log);
          break;
        }
        case 'export-audit-log': {
          const exp = await exportAuditLog();
          sendResponse(exp);
          break;
        }
        case 'get-guide': {
          const s = await getSettings();
          const GUIDE_TTL_MS = 24 * 60 * 60 * 1000;
          const cached = s.setupGuideCache;
          const ts = s.setupGuideFetchedAt ? new Date(s.setupGuideFetchedAt).getTime() : 0;
          const stale =
            !cached || !ts || Date.now() - ts > GUIDE_TTL_MS || cached.version !== FALLBACK_GUIDE.version;
          if (cached && !stale) {
            sendResponse({ ok: true, guide: cached, cached: true });
            break;
          }
          try {
            const res = await fetch(GUIDE_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`guide ${res.status}`);
            const guide = await res.json();
            await saveSettings({ setupGuideCache: guide, setupGuideFetchedAt: new Date().toISOString() });
            sendResponse({ ok: true, guide, cached: false });
          } catch {
            sendResponse({ ok: true, guide: cached || FALLBACK_GUIDE, cached: true, fallback: !cached });
          }
          break;
        }
        case 'reload-extension':
          sendResponse({ ok: true, reloading: true });
          setTimeout(() => {
            try { chrome.runtime.reload(); } catch {}
          }, 150);
          break;
        case 'open-dashboard':
          chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
          sendResponse({ ok: true });
          break;
        case 'open-side-panel': {
          try {
            const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            if (tab && chrome.sidePanel && chrome.sidePanel.open) {
              await chrome.sidePanel.open({ windowId: tab.windowId });
              sendResponse({ ok: true });
            } else {
              chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
              sendResponse({ ok: true, fallback: true });
            }
          } catch (err) {
            // sidePanel.open() needs a live user gesture; a message hop from the popup
            // does not carry one, so this can legitimately reject. Never fail silently.
            chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard.html') });
            sendResponse({ ok: false, fallback: true, error: String((err && err.message) || err) });
          }
          break;
        }
        case 'offscreen-ping':
          await sup.ensure('offscreen-ping');
          await registerWebBridge();
          sendResponse({ ok: true, pong: Date.now() });
          break;
        case 'get-takeover':
          sendResponse({ ok: true, takeover: getTakeoverStatus() });
          break;
        case 'resume-takeover':
          sendResponse(resumeTakeover(msg));
          break;
        case 'get-jobs':
          sendResponse({ ok: true, jobs: listJobs() });
          break;
        case 'cancel-job':
          sendResponse(cancelJob(msg.id));
          break;
        case 'get-diagnostics':
          sendResponse(await execExtensionDiagnostics());
          break;
        case 'get-threat-state':
          sendResponse(await fetchThreatState(msg.domain));
          break;
        default:
          sendResponse({ ok: false, error: `unknown message ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message, status: e.status });
    }
  })();
  return true; // async response
}));

if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        console.info('[ss] external message received:', msg, 'from:', sender?.url);
        await pollHealth();
        await sup.ensure('external');
        await registerWebBridge();
        await ensureOffscreenDoc();
        if (msg && msg.type === 'reload') {
          sendResponse({ ok: true, reloading: true });
          setTimeout(() => {
            try { chrome.runtime.reload(); } catch {}
          }, 150);
          return;
        }
        sendResponse({ ok: true, pong: Date.now() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  });
}
