// Regression test for web_navigate {newTab:true} (live bug 2026-09-23):
//   - it attached the beforeunload CDP guard to the CURRENT tab (the person's tab) although a
//     new tab unloads nothing; a hung attach stalled the call until the hub's 45 s timeout;
//   - it ignored the agent window ("New tabs will open here") and opened the tab wherever
//     Chrome chose.
// Also pins that the same-tab guard is bounded, so a hung attach cannot stall a navigation.
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

const created = [];
const updated = [];
let nextId = 100;

const chromeMock = createChromeMock();
chromeMock.windows = {
  create: async (props) => ({ id: 777, tabs: [{ id: 9, url: props.url }] }),
  get: async (id) => ({ id, focused: false, state: 'normal' }),
};
chromeMock.tabs.onCreated = { addListener: () => {} };
chromeMock.tabs.onUpdated = { addListener: () => {}, removeListener: () => {} };
chromeMock.tabs.query = async () => [{ id: 5, windowId: 1, url: 'https://person.example/', active: true }];
chromeMock.tabs.create = async (props) => {
  created.push(props);
  if (props.windowId === 999) throw new Error('No window with id: 999');
  const id = nextId++;
  return { id, windowId: props.windowId || 1, url: props.url, status: 'loading' };
};
chromeMock.tabs.update = async (id, props) => {
  updated.push({ id, ...props });
  return { id, windowId: 1, url: props.url, status: 'loading' };
};
chromeMock.tabs.get = async (id) => {
  const c = created.find((_, i) => 100 + i === Number(id));
  return { id: Number(id), windowId: c ? (c.windowId || 1) : 1, url: c ? c.url : 'https://x.test/', title: 'T', status: 'complete' };
};
chromeMock.tabs.group = undefined; // groupAgentTab no-ops without the API
chromeMock.scripting = { executeScript: async () => [{ result: true }] };
globalThis.chrome = chromeMock;

const { execWebNavigate, GUARD_TIMEOUT_MS } = await import('../lib/web-navigate.js');
const agent = await import('../lib/web-agent-window.js');

// 1. newTab never touches the current tab with CDP (the guard runner must not be called).
{
  const calls = [];
  const adv = async (tool, tab) => { calls.push([tool, tab && tab.id]); return { ok: true }; };
  const res = await execWebNavigate({ url: 'https://a.test/', newTab: true }, adv);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 0, 'a new tab must not attach the beforeunload guard to the person\'s tab');
  assert.equal(created.at(-1).windowId, undefined, 'without an agent window Chrome picks the window');
  assert.equal(res.data.inAgentWindow, false);
}

// 2. With an agent window, the new tab opens IN it.
{
  await agent.createAgentWindow();
  const res = await execWebNavigate({ url: 'https://b.test/', newTab: true }, async () => ({ ok: true }));
  assert.equal(created.at(-1).windowId, 777, 'the new tab must open in the agent window');
  assert.equal(res.data.windowId, 777);
  assert.equal(res.data.inAgentWindow, true);
}

// 3. NEGATIVE CONTROL: a hung guard on a same-tab navigation no longer stalls it.
{
  const started = Date.now();
  const hang = () => new Promise(() => {}); // never settles, like a CDP attach on a frozen renderer
  const res = await execWebNavigate({ url: 'https://c.test/' }, hang);
  const took = Date.now() - started;
  assert.equal(res.ok, true);
  assert.equal(updated.at(-1).url, 'https://c.test/', 'the navigation still happens');
  assert.ok(took >= GUARD_TIMEOUT_MS - 50 && took < GUARD_TIMEOUT_MS + 3000, `bounded wait, took ${took} ms`);
}

// 4. acceptBeforeUnload:false still skips the guard entirely.
{
  let called = false;
  await execWebNavigate({ url: 'https://d.test/', acceptBeforeUnload: false }, async () => { called = true; return { ok: true }; });
  assert.equal(called, false);
}

// 5. A service worker restart (fresh module = empty memory) keeps the agent window, and a
//    window the person closed is forgotten (chrome.storage.session).
{
  const session = new Map();
  chrome.storage.session = {
    get: async (k) => ({ [k]: session.get(k) }),
    set: async (o) => { for (const [k, v] of Object.entries(o)) session.set(k, v); },
  };
  const w1 = await import('../lib/web-agent-window.js?sw=1');
  await w1.createAgentWindow();
  const w2 = await import('../lib/web-agent-window.js?sw=2');
  const restored = await w2.agentWindowStatus();
  assert.equal(restored.active, true, 'a restarted worker must still know the agent window');
  assert.equal(restored.windowId, 777);
  chrome.windows.get = async () => { throw new Error('No window with id: 777'); };
  const w3 = await import('../lib/web-agent-window.js?sw=3');
  const gone = await w3.agentWindowStatus();
  assert.equal(gone.active, false, 'a window the person closed is not the agent window any more');
  assert.equal(session.get('ssAgentWindow'), null, 'and it is cleared from session storage');
}

console.log('web_navigate_newtab: all assertions passed');
