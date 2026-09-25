// lib/web-request-admit.js + its use in web-bridge.js handleWebRequest. The SSE client now resumes with
// Last-Event-ID, so the hub can replay a web_request: one already run here, or one the hub stopped waiting
// for, must run nothing and post nothing (the agent already has its answer).
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const { admitWebRequest, localizeDeadline, resetAdmittedRequests } = await import('../lib/web-request-admit.js');

console.log('[test] running web_request_admit tests...');

const NOW = 1_700_000_000_000;
const req = (id, extra = {}) => ({ type: 'web_request', id, tool: 'web_click', args: { selector: '#a' }, deadlineAt: NOW + 30_000, ...extra });

// ── malformed ──
for (const bad of [null, undefined, 'x', {}, { id: 1, tool: 'web_click' }, { id: 'a' }, { id: 'a', tool: '' },
  { id: 'a', tool: 'web_click', args: 'nope' }, { id: 'a', tool: 'web_click', deadlineAt: 'soon' },
  { id: 'a', tool: 'web_click', remainingMs: 'lots' }]) {
  assert.deepEqual(admitWebRequest(bad, NOW), { ok: false, reason: 'malformed' }, JSON.stringify(bad));
}

// ── first delivery admitted, replay of the same id refused ──
assert.deepEqual(admitWebRequest(req('r1'), NOW), { ok: true });
assert.deepEqual(admitWebRequest(req('r1'), NOW + 5), { ok: false, reason: 'duplicate' });
assert.deepEqual(admitWebRequest({ id: 'no-deadline', tool: 'web_status' }, NOW), { ok: true }, 'older hub without deadlineAt');

// ── expired: less than a second of the hub's wait left, judged on the hub's relative remainingMs ──
assert.deepEqual(admitWebRequest(req('late', { remainingMs: 999 }), NOW), { ok: false, reason: 'expired' });
assert.deepEqual(admitWebRequest(req('gone', { remainingMs: 0, replayed: true }), NOW), { ok: false, reason: 'expired' });
assert.deepEqual(admitWebRequest(req('late', { remainingMs: 5_000 }), NOW), { ok: true }, 'an expired id is not remembered');

// ── clock skew: the hub's clock is 60s behind or ahead of this browser's; remainingMs decides, not deadlineAt ──
const SKEW = 60_000;
assert.deepEqual(admitWebRequest(req('behind', { deadlineAt: NOW - SKEW + 30_000, remainingMs: 30_000 }), NOW), { ok: true },
  'a hub clock running behind never drops a live call');
assert.deepEqual(admitWebRequest(req('ahead', { deadlineAt: NOW + SKEW + 500, remainingMs: 500 }), NOW), { ok: false, reason: 'expired' },
  'a hub clock running ahead does not keep an expired call alive');
// An older hub (no remainingMs): a LIVE event is never dropped on the absolute clock; only a replay is.
assert.deepEqual(admitWebRequest(req('old-live', { deadlineAt: NOW - SKEW }), NOW), { ok: true }, 'live, old hub, skewed clock');
assert.deepEqual(admitWebRequest(req('old-replay', { deadlineAt: NOW - SKEW, replayed: true }), NOW), { ok: false, reason: 'expired' });

// ── localizeDeadline: the deadline is re-based on this browser's clock ──
assert.equal(localizeDeadline({ id: 'x', deadlineAt: NOW - SKEW, remainingMs: 20_000 }, NOW).deadlineAt, NOW + 20_000);
const untouched = { id: 'y', deadlineAt: 123 };
assert.equal(localizeDeadline(untouched, NOW), untouched, 'no remainingMs: unchanged');

// ── bounded memory: 256-entry LRU ──
resetAdmittedRequests();
for (let i = 0; i < 256; i++) assert.equal(admitWebRequest(req(`id${i}`), NOW).ok, true);
assert.equal(admitWebRequest(req('id0'), NOW).reason, 'duplicate', 'id0 still remembered (and refreshed)');
admitWebRequest(req('id256'), NOW); // evicts the oldest: id1 (id0 was just refreshed)
assert.equal(admitWebRequest(req('id0'), NOW).reason, 'duplicate');
assert.equal(admitWebRequest(req('id1'), NOW).ok, true, 'evicted id admitted again');

// ── web-bridge: a refused request runs nothing and posts nothing ──
{
  resetAdmittedRequests();
  const posts = [];
  globalThis.fetch = async (url, init = {}) => {
    posts.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // Web access off: an admitted request is answered (NO_GRANT) without touching any tab.
  await chrome.storage.local.set({ webAccessEnabled: false, instanceId: 'inst_self', profileEmail: 'me@x.test' });
  const { handleWebRequest } = await import('../lib/web-bridge.js');
  // The hub's clock is a minute behind this browser's: deadlineAt is "in the past" here, remainingMs is not.
  const live = { ...req('b1'), deadlineAt: Date.now() - 60_000, remainingMs: 30_000, targetInstanceId: 'inst_self' };
  await handleWebRequest(live);
  const results = () => posts.filter((p) => p.url.endsWith('/api/web/result'));
  assert.equal(results().length, 1, 'a fresh request is answered, whatever the clock skew');
  assert.equal(results()[0].body.id, 'b1');
  await handleWebRequest({ ...live, replayed: true });
  assert.equal(results().length, 1, 'the replayed duplicate posts nothing');
  await handleWebRequest({ ...live, id: 'b2', remainingMs: 0 });
  assert.equal(results().length, 1, 'an expired request posts nothing');
  await handleWebRequest({ ...live, id: 'b3', targetInstanceId: 'someone-else' });
  await handleWebRequest({ ...live, id: 'b3' });
  assert.equal(results().length, 2, 'a request for another profile does not consume its id here');
}

console.log('[test] web_request_admit: all passed');
