// Boots the real service worker (background.js) under a chrome mock and a fake hub: the whole import graph
// must link, the SSE stream must open with attribution, and the 'sse'/'health' state that web-diag and the
// Diagnostics tab read (lib/sw-state.js) must be registered. Also pins background.js under 500 lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeMock } from './harness.js';
import { settle } from './sse-fakes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines = fs.readFileSync(path.join(root, 'background.js'), 'utf8').split(/\r?\n/).length;
assert.ok(lines <= 500, `background.js is ${lines} lines (max 500)`);

console.log('[test] running sw_boot tests...');

// ── chrome mock: the harness plus every API background.js touches at start-up ──
const listeners = {};
const ev = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); }, removeListener() {} });
const mock = createChromeMock();
mock.runtime.onMessage = ev('onMessage');
mock.runtime.onConnect = ev('onConnect');
mock.runtime.onInstalled = ev('onInstalled');
mock.runtime.onStartup = ev('onStartup');
mock.runtime.onMessageExternal = ev('onMessageExternal');
mock.runtime.getManifest = () => ({ name: 'ScreenSync MCP', version: '1.14.1' });
mock.tabs.onActivated = ev('tabs.onActivated');
mock.tabs.create = async (o) => ({ id: 9, ...o });
mock.alarms = { create() {}, clear() {}, getAll: async () => [], onAlarm: ev('onAlarm') };
mock.windows = { getAll: async () => [{ id: 1, focused: true, state: 'normal', type: 'normal', tabs: [{ id: 1, active: true, url: 'https://example.com', title: 'Example' }] }] };
mock.contextMenus = { removeAll: (cb) => cb && cb(), create() {}, onClicked: ev('contextMenus.onClicked') };
mock.commands = { onCommand: ev('commands.onCommand') };
mock.offscreen = { hasDocument: async () => true, createDocument: async () => {} };
mock.webNavigation = { onCommitted: ev('webNavigation.onCommitted') };
mock.identity = { getProfileUserInfo: (_o, cb) => cb({ email: '', id: '' }) };
mock.cookies = { getAll: async () => [] };
mock.sidePanel = { setPanelBehavior: async () => {}, open: async () => {} };
mock.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} };
globalThis.chrome = mock;
globalThis.self = globalThis;
if (!globalThis.navigator || !globalThis.navigator.userAgent) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
}

// ── fake hub ──
const enc = new TextEncoder();
const streams = [];
const requests = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  requests.push({ path: u.pathname, url: u, headers: init.headers || {}, method: init.method || 'GET' });
  if (u.pathname === '/health') return json({ ok: true, service: 'screensync-hub', version: 'test', latestFrameAt: null });
  if (u.pathname === '/api/web/register') return json({ ok: true, status: { online: true, browsers: [] } });
  if (u.pathname === '/api/events') {
    const s = { closed: false };
    const body = new ReadableStream({ start(c) { s.ctl = c; } });
    init.signal.addEventListener('abort', () => {
      if (s.closed) return;
      s.closed = true;
      const e = new Error('aborted');
      e.name = 'AbortError';
      s.ctl.error(e);
    });
    s.push = (t) => s.ctl.enqueue(enc.encode(t));
    streams.push(s);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return json({ ok: true });
};

await chrome.storage.local.set({ hubUrl: 'http://localhost:3999', token: 'tok', onboardingComplete: true });

const { readSwState } = await import('../lib/sw-state.js');
await import('../background.js');

async function until(pred, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await settle(5);
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

// ── the stream opens by itself at boot, attributed to this browser instance ──
await until(() => readSwState('sse')?.open === true, 'the SSE stream to open');
const sse = readSwState('sse');
assert.equal(typeof sse.state, 'string');
assert.equal(sse.state, 'open');
assert.equal(sse.hubUrl, 'http://127.0.0.1:3999', 'localhost normalised by the supervisor');
const evReq = requests.find((r) => r.path === '/api/events');
assert.equal(evReq.url.searchParams.get('client'), 'extension');
assert.match(evReq.url.searchParams.get('instanceId') || '', /^inst_/);
assert.equal(evReq.headers.Authorization, 'Bearer tok');
assert.equal(streams.length, 1, 'boot + onStartup + first alarms opened ONE stream');

await until(() => readSwState('health')?.ok === true, 'the health probe');
const health = readSwState('health');
assert.equal(typeof health.latencyMs, 'number');
assert.equal(typeof health.checkedAt, 'number');

const reg = requests.filter((r) => r.path === '/api/web/register');
assert.ok(reg.length >= 1, 'registered with the hub');

// ── owner messages: get-status carries a live snapshot; ensure() spam does not reconnect ──
const owner = { id: chrome.runtime.id, url: `chrome-extension://${chrome.runtime.id}/pages/popup.html` };
// takeover.js and approval-notify.js listen too (for their own tab channels): the first answer wins.
const ask = (msg) => new Promise((resolve) => {
  for (const fn of listeners.onMessage) fn(msg, owner, resolve);
});
streams[0].push('id: 3\ndata: {"type":"frame","at":"2026-09-25T00:00:00Z"}\n\n');
await settle();
let st = await ask({ type: 'get-status' });
assert.equal(st.ok, true);
assert.equal(st.cache.sseStatus, 'connected');
assert.equal(st.cache.sse.open, true);
assert.equal(st.cache.sse.lastEventId, '3');
assert.equal(st.cache.events[0].type, 'frame');
for (let i = 0; i < 5; i++) await ask({ type: 'offscreen-ping' });
for (const fn of listeners['tabs.onActivated'] || []) await fn({ tabId: 1 });
assert.equal(streams.length, 1, 'offscreen pings and tab events leave a live stream alone');
assert.equal(readSwState('sse').reconnects, 0);

// ── menus/commands still registered from sw-menus.js ──
assert.equal((listeners['contextMenus.onClicked'] || []).length, 1);
assert.equal((listeners['commands.onCommand'] || []).length, 1);

// ── unpairing via settings stops the stream and says so ──
st = await ask({ type: 'update-settings', patch: { hubUrl: 'http://192.0.2.1:3000', token: '', onboardingComplete: false } });
assert.equal(st.ok, true);
assert.equal(readSwState('sse').state, 'idle');
assert.equal(streams[0].closed, true, 'stream aborted');
st = await ask({ type: 'get-status' });
assert.equal(st.cache.sseStatus, 'stopped');

console.log('[test] sw_boot: all passed');
