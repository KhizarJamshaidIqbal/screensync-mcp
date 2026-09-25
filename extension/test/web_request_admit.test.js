// lib/web-request-admit.js + its use in web-bridge.js handleWebRequest. The SSE client now resumes with
// Last-Event-ID, so the hub can replay a web_request: one already run here, or one the hub stopped waiting
// for, must run nothing and post nothing (the agent already has its answer).
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const { admitWebRequest, localizeDeadline, needsHubConfirmation, resetAdmittedRequests } = await import('../lib/web-request-admit.js');

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

// ── needsHubConfirmation: a live event that may have outlived the hub's wait is confirmed with the hub ──
assert.equal(needsHubConfirmation(req('n1', { remainingMs: 45_000 }), { silenceMs: 30_000 }, NOW), false, 'idle keepalive gap');
assert.equal(needsHubConfirmation(req('n2', { remainingMs: 45_000 }), { silenceMs: 44_500 }, NOW), true, 'silence ~ the whole wait');
assert.equal(needsHubConfirmation(req('n3', { remainingMs: 5_000 }), { silenceMs: 10_000 }, NOW), true, 'a short wait after a long silence');
assert.equal(needsHubConfirmation(req('n4', { remainingMs: 30_000, deadlineAt: NOW - 5_000 }), { silenceMs: 0 }, NOW), true,
  'past its deadline on this clock (late, or a skewed hub): the hub decides');
assert.equal(needsHubConfirmation(req('n5'), undefined, NOW), false, 'no meta, deadline ahead');

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
  const pendingOnHub = new Set(['b1']); // what the hub still waits for (GET /api/web/pending/:id)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init = {}) => {
    posts.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const pendingId = /\/api\/web\/pending\/([^/?]+)/.exec(String(url));
    if (pendingId) {
      return pendingOnHub.has(decodeURIComponent(pendingId[1]))
        ? json({ success: true, remainingMs: 25_000 })
        : json({ success: false, code: 'NOT_PENDING', error: 'Unknown or already-resolved request id.' }, 404);
    }
    return json({ ok: true });
  };
  // Web access off: an admitted request is answered (NO_GRANT) without touching any tab.
  await chrome.storage.local.set({ webAccessEnabled: false, instanceId: 'inst_self', profileEmail: 'me@x.test' });
  const { handleWebRequest } = await import('../lib/web-bridge.js');
  // The hub's clock is a minute behind this browser's: deadlineAt is "in the past" here, remainingMs is not.
  // The hub is asked (not the local clock), confirms it still waits, and the request runs.
  const live = { ...req('b1'), deadlineAt: Date.now() - 60_000, remainingMs: 30_000, targetInstanceId: 'inst_self' };
  await handleWebRequest(live, { silenceMs: 0 });
  const results = () => posts.filter((p) => p.url.endsWith('/api/web/result'));
  const checks = () => posts.filter((p) => p.url.includes('/api/web/pending/'));
  assert.equal(checks().length, 1, 'a deadline already past on this clock is confirmed with the hub');
  assert.equal(results().length, 1, 'a fresh request is answered, whatever the clock skew');
  assert.equal(results()[0].body.id, 'b1');
  // A live event that sat in a stalled socket longer than the hub's wait: the hub already answered TIMEOUT.
  const ahead = { ...req('stalled'), deadlineAt: Date.now() + 30_000, remainingMs: 45_000, targetInstanceId: 'inst_self' };
  await handleWebRequest(ahead, { silenceMs: 60_000 });
  assert.equal(checks().length, 2, 'a stall longer than the wait is confirmed with the hub');
  assert.equal(results().length, 1, 'no longer pending on the hub: it runs nothing and posts nothing');
  // An ordinary live event (short silence, deadline ahead) runs without a round trip to the hub.
  await handleWebRequest({ ...ahead, id: 'prompt' }, { silenceMs: 2_000 });
  assert.equal(checks().length, 2, 'no confirmation for an event that cannot have expired');
  assert.equal(results().length, 2);
  await handleWebRequest({ ...live, replayed: true });
  assert.equal(results().length, 2, 'the replayed duplicate posts nothing');
  await handleWebRequest({ ...live, id: 'b2', remainingMs: 0 });
  assert.equal(results().length, 2, 'an expired request posts nothing');
  pendingOnHub.add('b3');
  await handleWebRequest({ ...live, id: 'b3', targetInstanceId: 'someone-else' });
  await handleWebRequest({ ...live, id: 'b3' });
  assert.equal(results().length, 3, 'a request for another profile does not consume its id here');
}

console.log('[test] web_request_admit: all passed');
