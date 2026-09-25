import { getSettings } from './storage.js';

export class HubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readError(res) {
  let msg = `Hub error ${res.status}`;
  if (res.status === 401 || res.status === 403) {
    msg = 'Pairing token invalid or expired (401/403). Check token in Settings or restart the hub.';
  } else if (res.status === 404) {
    msg = `Endpoint not found (${res.status}). Verify hub version or check for a port conflict.`;
  }
  try {
    const j = await res.json();
    if (j && j.error) msg = j.error;
  } catch { /* non-JSON error body */ }
  return new HubError(res.status, msg);
}

export const DEFAULT_HUB_URL = 'http://127.0.0.1:3000';

// Canonical hub base URL: trimmed, localhost -> 127.0.0.1 (avoids ::1 resolution),
// no trailing slash; empty/missing -> the default local hub.
export function normalizeHubBase(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return DEFAULT_HUB_URL;
  return raw.replace(/^(https?:\/\/)localhost(?=[:/?#]|$)/i, '$1127.0.0.1').replace(/\/+$/, '');
}

// True when the (normalized) hub URL points at this machine's loopback interface.
export function isLoopbackHub(url) {
  let host;
  try {
    host = new URL(normalizeHubBase(url)).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

export async function hubFetch(path, { method = 'GET', body, url, token, timeoutMs = 10_000 } = {}) {
  const s = await getSettings();
  const base = normalizeHubBase(url ?? s.hubUrl);
  const tk = token ?? s.token;
  const headers = { Authorization: `Bearer ${tk}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      cache: 'no-store',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new HubError(408, `Hub request timed out after ${timeoutMs}ms (${base}${path})`);
    }
    throw new HubError(503, `Cannot reach ScreenSync Hub at ${base} — verify hub is running (${err.message || 'connection failed'})`);
  }
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Unauthenticated liveness probe with latency measurement and strict identity validation.
export async function probeHub(url, timeoutMs = 6_000) {
  const t0 = Date.now();
  const base = normalizeHubBase(url);
  let res;
  try {
    res = await fetch(base + '/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new HubError(408, `Hub health probe timed out after ${timeoutMs}ms at ${base}`);
    }
    throw new HubError(503, `Cannot connect to hub at ${base} (${err.message || 'connection refused'})`);
  }
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new HubError(res.status, `Hub /health replied ${res.status}`);
  const j = await res.json().catch(() => null);
  if (!j || j.ok !== true || j.service !== 'screensync-hub') {
    const occupant = (j && j.service) ? j.service : 'an unrelated service';
    throw new HubError(409, `Port at ${base} is occupied by ${occupant}, not ScreenSync Hub. Try port 3001 or stop the conflicting service.`);
  }
  return { ...j, latencyMs };
}

export const api = {
  latestFrame: () => hubFetch('/api/screens/latest'),
  deviceStatus: () => hubFetch('/api/device/status'),
  catalog: () => hubFetch('/api/mcp/catalog'),
  inspection: () => hubFetch('/api/inspections/latest'),
  patch: () => hubFetch('/api/patches/latest'),
  pairInfo: () => hubFetch('/api/pair'),
  control: (action, body = {}) => hubFetch(`/api/control/${action}`, { method: 'POST', body }),
  // Hub-side web tools (the cognitive engines live in the hub process, not here).
  webTool: (tool, args = {}) => hubFetch('/api/web/tool', { method: 'POST', body: { tool, args } }),
};
