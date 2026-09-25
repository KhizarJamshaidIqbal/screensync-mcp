// ScreenSync Extension Diagnostics Unit
// Real self-check for the dashboard's Diagnostics tab and the web_extension_diagnostics tool:
// service-worker uptime, hub reachability, the live SSE client state (read from the SW state
// registry, never re-derived), grant counts, approvals, storage, tabs and alarms.
//
// Never returns secrets: no pairing token and no per-origin grant map (web_extension_settings
// exposes only a count, and so does this). The SSE/health state comes from lib/sw-state.js,
// because importing background.js from here would close an import cycle
// (background -> web-bridge -> web-tools -> web-diag).

import { getSettings } from './storage.js';
import { probeHub, normalizeHubBase } from './api.js';
import { getGrantsForDisplay, getPendingApprovals } from './consent.js';
import { readSwState, swUptimeSeconds, SW_STARTED_AT } from './sw-state.js';

const HUB_PROBE_TIMEOUT_MS = 3000;

const orNull = (v) => (v === undefined ? null : v);

// Runs fn (sync or async); any throw/rejection or undefined result becomes `fallback`.
async function attempt(fn, fallback) {
  try {
    const v = await fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

async function probe(hubUrl) {
  try {
    const h = await probeHub(hubUrl, HUB_PROBE_TIMEOUT_MS);
    return {
      reachable: true,
      latencyMs: orNull(h.latencyMs),
      error: null,
      health: {
        service: orNull(h.service),
        version: orNull(h.version),
        port: orNull(h.port),
        latestFrameAt: orNull(h.latestFrameAt),
      },
    };
  } catch (err) {
    return { reachable: false, latencyMs: null, error: String((err && err.message) || err), health: null };
  }
}

const UNKNOWN_SSE = Object.freeze({
  state: 'unknown', open: false, detail: null, since: null, lastDataAt: null,
  lastDataAgeSeconds: null, lastEventId: null, attempt: null, reconnects: null,
  backoffMs: null, nextRetryAt: null,
});

// The SSE client snapshot published by background.js ('sse' provider). A missing provider
// means the service worker has not wired its stream (yet): report 'unknown', never "open".
function sseView(now) {
  const s = readSwState('sse');
  if (!s || typeof s !== 'object') return { ...UNKNOWN_SSE };
  const lastDataAt = Number.isFinite(s.lastDataAt) ? s.lastDataAt : null;
  return {
    state: typeof s.state === 'string' && s.state ? s.state : 'unknown',
    open: s.open === true,
    detail: orNull(s.detail),
    since: orNull(s.since),
    lastDataAt,
    lastDataAgeSeconds: lastDataAt === null ? null : Math.max(0, Math.floor((now - lastDataAt) / 1000)),
    lastEventId: orNull(s.lastEventId),
    attempt: orNull(s.attempt),
    reconnects: orNull(s.reconnects),
    backoffMs: orNull(s.backoffMs),
    nextRetryAt: orNull(s.nextRetryAt),
  };
}

// The service worker's own last health poll ('health' provider), if it has published one.
function lastPoll() {
  const h = readSwState('health');
  if (!h || typeof h !== 'object') return null;
  return { ok: h.ok === true, latencyMs: orNull(h.latencyMs), checkedAt: orNull(h.checkedAt) };
}

// Counts only: saved grants plus live "Allow once" grants (held in memory by consent.js).
async function grantCounts() {
  const grants = await attempt(() => getGrantsForDisplay(), {});
  const entries = Object.values(grants || {});
  const allowOnce = entries.filter((g) => g && g.allowOnceUntil).length;
  return { count: entries.length, saved: entries.length - allowOnce, allowOnce };
}

// Length of api.query({}) or null when the API is missing or fails (never a made-up number).
function countOf(api) {
  if (!api || typeof api.query !== 'function') return Promise.resolve(null);
  return attempt(async () => {
    const list = await api.query({});
    return Array.isArray(list) ? list.length : null;
  }, null);
}

export async function execExtensionDiagnostics() {
  const c = typeof chrome !== 'undefined' ? chrome : {};
  const runtime = c.runtime || {};
  const local = (c.storage && c.storage.local) || {};
  const settings = await attempt(() => getSettings(), {});
  const manifest = await attempt(() => runtime.getManifest(), {});
  const hubUrl = normalizeHubBase(settings.hubUrl);

  const [hub, grants, bytesInUse, alarms, openTabsCount, tabGroupsCount] = await Promise.all([
    probe(hubUrl),
    grantCounts(),
    attempt(() => local.getBytesInUse(null), null),
    attempt(() => c.alarms.getAll(), []),
    countOf(c.tabs),
    countOf(c.tabGroups),
  ]);

  const now = Date.now();
  const pending = await attempt(() => getPendingApprovals(), []);
  const bytes = Number.isFinite(bytesInUse) ? bytesInUse : null;
  const quota = Number.isFinite(local.QUOTA_BYTES) ? local.QUOTA_BYTES : null;

  return {
    ok: true,
    data: {
      version: manifest.version || 'unknown',
      manifestVersion: orNull(manifest.manifest_version),
      extensionId: runtime.id || 'unknown',
      sw: { startedAt: SW_STARTED_AT, uptimeSeconds: swUptimeSeconds(now) },
      hub: {
        url: hubUrl,
        reachable: hub.reachable,
        latencyMs: hub.latencyMs,
        error: hub.error,
        tokenConfigured: Boolean(settings.token && String(settings.token).length > 0),
        health: hub.health,
        lastPoll: lastPoll(),
      },
      sse: sseView(now),
      grants,
      grantedOriginsCount: grants.count,
      approvals: { enforced: true, pending: Array.isArray(pending) ? pending.length : 0 },
      storage: { bytesInUse: bytes, quotaBytes: quota },
      storageBytesInUse: bytes,
      webAccessEnabled: Boolean(settings.webAccessEnabled),
      openTabsCount,
      tabGroupsCount,
      activeAlarms: (Array.isArray(alarms) ? alarms : []).map((a) => a && a.name).filter(Boolean),
      permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
      userAgent: typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'unknown',
      timestamp: new Date(now).toISOString(),
    },
  };
}
