import { getSettings } from './storage.js';

export class HubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readError(res) {
  let msg = `Hub error ${res.status}`;
  try {
    const j = await res.json();
    if (j && j.error) msg = j.error;
  } catch { /* non-JSON error body */ }
  return new HubError(res.status, msg);
}

export async function hubFetch(path, { method = 'GET', body, url, token } = {}) {
  const s = await getSettings();
  const base = (url ?? s.hubUrl).replace(/\/$/, '');
  const tk = token ?? s.token;
  const headers = { Authorization: `Bearer ${tk}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

// Unauthenticated liveness probe with latency measurement.
export async function probeHub(url) {
  const t0 = Date.now();
  const res = await fetch(url.replace(/\/$/, '') + '/health', { cache: 'no-store' });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new HubError(res.status, `Hub replied ${res.status}`);
  const j = await res.json();
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
};
