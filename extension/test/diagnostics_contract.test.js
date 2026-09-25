// Diagnostics contract (1.14.1 C9/C10).
//
// The Diagnostics tab once read fields web-diag.js never returned (sseConnected, uptimeSeconds,
// grantsCount, hubUrl), so it showed "SSE Offline / Uptime N/A / Grants 0" while the header said
// "SSE Live". This runs the REAL execExtensionDiagnostics() under the Chrome mock, then proves
// every `data.<path>` diagnostics-view.js reads exists in that payload, the rendered pills follow
// the real SSE state, and the payload never carries the pairing token or the grant map.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createChromeMock } from './harness.js';

const TOKEN = 'tok-SECRET-9f3c1d-never-leak';
const GRANTED_ORIGIN = 'https://private-bank.example';

const chromeMock = createChromeMock();
chromeMock.runtime.getManifest = () => ({
  name: 'ScreenSync MCP', version: '1.14.1', manifest_version: 3, permissions: ['tabs', 'storage', 'alarms'],
});
chromeMock.storage.local.getBytesInUse = async () => 4321;
chromeMock.storage.local.QUOTA_BYTES = 10485760;
chromeMock.alarms.getAll = async () => [{ name: 'ss-heartbeat' }, { name: 'ss-sse-keepalive' }];
let tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
chromeMock.tabs.query = async () => tabs;
chromeMock.tabGroups = { query: async () => [{ id: 9 }] };
globalThis.chrome = chromeMock;

await chrome.storage.local.set({
  hubUrl: 'http://localhost:3000/',
  token: TOKEN,
  webAccessEnabled: true,
  grants: { [GRANTED_ORIGIN]: { read: true, act: false, cookies: false, updatedAt: 1 } },
});

// fetch stub: only the hub's unauthenticated /health may be called, at the normalized base.
const fetched = [];
let hubUp = true;
globalThis.fetch = async (url, opts = {}) => {
  fetched.push({ url: String(url), headers: opts.headers || {} });
  if (!hubUp) throw new TypeError('fetch failed');
  return new Response(JSON.stringify({
    ok: true, service: 'screensync-hub', version: '1.12.0', port: 3000, latestFrameAt: 1700000000000,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { provideSwState, SW_STARTED_AT } = await import('../lib/sw-state.js');
const { execExtensionDiagnostics } = await import('../lib/web-diag.js');
const { renderDiagnostics, formatDuration } = await import('../components/diagnostics-view.js');
const { grantAllowOnce } = await import('../lib/consent.js');

console.log('[test] running diagnostics contract checks...');

const now = Date.now();
const openSnapshot = {
  state: 'open', open: true, active: true, detail: null, since: now - 60_000, openedAt: now - 60_000,
  lastDataAt: now - 4_000, lastEventId: '812', attempt: 0, reconnects: 2, backoffMs: 0, nextRetryAt: null,
  hubUrl: 'http://127.0.0.1:3000',
};
let sse = openSnapshot;
provideSwState('sse', () => sse);
provideSwState('health', () => ({ ok: true, latencyMs: 8, checkedAt: now - 1_000 }));
grantAllowOnce('https://once.example');

// 1. The real payload, with every section the design names.
const res = await execExtensionDiagnostics();
assert.equal(res.ok, true);
const data = res.data;
assert.equal(data.version, '1.14.1', 'real manifest version, no fallback');
assert.equal(data.manifestVersion, 3);
assert.equal(data.extensionId, 'test-mock-extension-id');
assert.equal(data.sw.startedAt, SW_STARTED_AT);
assert.ok(Number.isInteger(data.sw.uptimeSeconds) && data.sw.uptimeSeconds >= 0);
assert.equal(data.hub.url, 'http://127.0.0.1:3000', 'hub url normalized (localhost -> 127.0.0.1, no trailing slash)');
assert.equal(data.hub.reachable, true);
assert.ok(Number.isFinite(data.hub.latencyMs));
assert.equal(data.hub.error, null);
assert.equal(data.hub.tokenConfigured, true);
assert.deepEqual(data.hub.health, { service: 'screensync-hub', version: '1.12.0', port: 3000, latestFrameAt: 1700000000000 });
assert.deepEqual(data.hub.lastPoll, { ok: true, latencyMs: 8, checkedAt: now - 1_000 });
assert.equal(fetched.length, 1);
assert.equal(fetched[0].url, 'http://127.0.0.1:3000/health', 'probe goes through probeHub at the normalized base');
assert.equal(JSON.stringify(fetched[0].headers).includes(TOKEN), false, 'the health probe must not send the token');
assert.equal(data.sse.state, 'open');
assert.equal(data.sse.open, true);
assert.equal(data.sse.lastEventId, '812');
assert.equal(data.sse.reconnects, 2);
assert.ok(data.sse.lastDataAgeSeconds >= 4 && data.sse.lastDataAgeSeconds < 30);
assert.equal('hubUrl' in data.sse, false, 'sse section carries only the documented fields');
assert.deepEqual(data.grants, { count: 2, saved: 1, allowOnce: 1 });
assert.equal(data.grantedOriginsCount, 2);
assert.deepEqual(data.approvals, { enforced: true, pending: 0 });
assert.deepEqual(data.storage, { bytesInUse: 4321, quotaBytes: 10485760 });
assert.equal(data.storageBytesInUse, 4321);
assert.equal(data.webAccessEnabled, true);
assert.equal(data.openTabsCount, 3);
assert.equal(data.tabGroupsCount, 1);
assert.deepEqual(data.activeAlarms, ['ss-heartbeat', 'ss-sse-keepalive']);
assert.deepEqual(data.permissions, ['tabs', 'storage', 'alarms']);
assert.ok(!Number.isNaN(Date.parse(data.timestamp)));

// 2. No secrets: no grant map, no token, no granted origin anywhere in the payload.
assert.equal('grantedOrigins' in data, false, 'the full grant map must not be returned');
const json = JSON.stringify(res);
assert.equal(json.includes(TOKEN), false, 'the pairing token must never appear in diagnostics');
assert.equal(json.includes(GRANTED_ORIGIN), false, 'granted origins must not appear, only counts');
assert.equal(json.includes('once.example'), false, 'allow-once origins must not appear, only counts');

// 3. Every data.<path> the view reads resolves in the real payload.
const viewSrc = readFileSync(resolve(import.meta.dirname, '..', 'components', 'diagnostics-view.js'), 'utf-8');
const paths = [...new Set([...viewSrc.matchAll(/data\.[\w.]+/g)].map((m) => m[0].replace(/\.$/, '')))];
assert.ok(paths.length >= 12, `expected >= 12 data paths in diagnostics-view.js, found ${paths.length}`);
for (const p of paths) {
  const value = p.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), data);
  assert.notEqual(value, undefined, `diagnostics-view.js reads ${p}, which the payload does not have`);
}

// 4. Rendering: Live pill for an open stream, a real uptime, exact counts.
let html = renderDiagnostics(data);
assert.match(html.netHtml, /Live · data \d+s ago/, 'open stream renders as Live');
assert.ok(!/Offline|Unauthorized|Unknown/.test(html.netHtml));
assert.ok(html.swHtml.includes(formatDuration(data.sw.uptimeSeconds)), 'uptime comes from sw.uptimeSeconds');
assert.ok(!html.swHtml.includes('N/A'));
assert.match(html.swHtml, /Open Tabs:<\/span>\s*<span>3<\/span>/, 'exact tab count');
assert.match(html.netHtml, /2 origins \(1 allow-once\)/);
assert.match(html.netHtml, /On · 0 waiting/);
assert.match(html.netHtml, /http:\/\/127\.0\.0\.1:3000/);
assert.match(html.netHtml, /Reachable · \d+ms/);
assert.match(renderDiagnostics({ ...data, sw: { ...data.sw, uptimeSeconds: 3725 } }).swHtml, /1h 2m/);
assert.equal(formatDuration(59), '59s');
assert.equal(formatDuration(192), '3m 12s');
assert.equal(formatDuration(90000), '1d 1h');

// 5. Zero tabs shows 0 (never the old `|| 1`); a missing count shows a dash.
tabs = [];
const zero = (await execExtensionDiagnostics()).data;
assert.equal(zero.openTabsCount, 0);
html = renderDiagnostics(zero);
assert.match(html.swHtml, /Open Tabs:<\/span>\s*<span>0<\/span>/, '0 tabs must render as 0');
assert.match(renderDiagnostics({ ...zero, openTabsCount: null }).swHtml, /Open Tabs:<\/span>\s*<span>—<\/span>/);

// 6. State-driven SSE pills.
sse = { ...openSnapshot, state: 'unauthorized', open: false, active: false, detail: '401 — wrong pairing token' };
let d = (await execExtensionDiagnostics()).data;
assert.equal(d.sse.state, 'unauthorized');
assert.match(renderDiagnostics(d).netHtml, /class="pill off"[^>]*>Unauthorized — check token/);

sse = { ...openSnapshot, state: 'backoff', open: false, attempt: 3, nextRetryAt: Date.now() + 8_000 };
d = (await execExtensionDiagnostics()).data;
assert.match(renderDiagnostics(d).netHtml, /class="pill warn"[^>]*>Reconnecting in \d+s \(attempt 3\)/);

sse = { ...openSnapshot, state: 'idle', open: false, active: false };
d = (await execExtensionDiagnostics()).data;
assert.match(renderDiagnostics(d).netHtml, />Stopped</);

// 7. No 'sse' provider registered -> unknown, never "open".
provideSwState('sse', null);
d = (await execExtensionDiagnostics()).data;
assert.equal(d.sse.state, 'unknown');
assert.equal(d.sse.open, false);
assert.match(renderDiagnostics(d).netHtml, /class="pill off"[^>]*>Unknown/);

// 8. Hub down: reachable false with the probe's error, rendered as Unreachable.
hubUp = false;
d = (await execExtensionDiagnostics()).data;
assert.equal(d.hub.reachable, false);
assert.equal(d.hub.latencyMs, null);
assert.equal(d.hub.health, null);
assert.match(d.hub.error, /Cannot connect to hub at http:\/\/127\.0\.0\.1:3000/);
assert.match(renderDiagnostics(d).netHtml, /Unreachable/);
hubUp = true;

// 9. Missing optional Chrome APIs degrade to null, not invented numbers.
delete chromeMock.tabGroups;
delete chromeMock.storage.local.getBytesInUse;
d = (await execExtensionDiagnostics()).data;
assert.equal(d.tabGroupsCount, null);
assert.equal(d.storage.bytesInUse, null);
assert.equal(d.storageBytesInUse, null);

// 10. Rendered values are escaped.
const evil = renderDiagnostics({ ...data, hub: { ...data.hub, url: '<img src=x onerror=alert(1)>' } });
assert.equal(evil.netHtml.includes('<img'), false, 'hub url must be escaped');
assert.ok(evil.netHtml.includes('&lt;img'));
assert.doesNotThrow(() => renderDiagnostics(null), 'an empty payload must still render');

// 11. The MCP tool path (web-tools.js) returns this same payload.
const toolsSrc = readFileSync(resolve(import.meta.dirname, '..', 'lib', 'web-tools.js'), 'utf-8');
assert.match(toolsSrc, /case 'web_extension_diagnostics': return execExtensionDiagnostics\(\);/);

console.log(`[test] diagnostics_contract.test.js: ALL ASSERTIONS PASSED (${paths.length} view paths checked)`);
