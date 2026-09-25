// lib/sse-supervisor.js: background.js calls ensure() from the 15s offscreen ping, the 30s alarm, every tab
// activation and page load. In 1.14.0 each call restarted the stream during its backoff sleep, so the backoff
// never grew (a retry storm against a stopped hub) and a 401 was never retried. These pin the fixed decisions.
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';
import { createClock, createFetch, settle } from './sse-fakes.js';

globalThis.chrome = createChromeMock();

const { SseClient } = await import('../lib/sse-client.js');
const { createSseSupervisor } = await import('../lib/sse-supervisor.js');
const C = await import('../lib/constants.js');

console.log('[test] running sse_supervisor tests...');

function setup(settings, { random = () => 0.5, probe = null } = {}) {
  const clock = createClock();
  const fetchImpl = createFetch();
  const statuses = [];
  const client = new SseClient({
    onEvent: () => {},
    onStatus: (s, d) => statuses.push([s, d]),
    fetchImpl, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random,
  });
  // A LAN hub by default: its backoff may grow to SSE_BACKOFF_MAX_MS (a loopback hub is capped lower).
  const s = { hubUrl: 'http://192.168.1.20:3999/', token: 'tok', onboardingComplete: true, ...settings };
  const sup = createSseSupervisor(client, {
    getSettings: async () => ({ ...s }),
    getInstanceId: async () => 'inst_test',
    now: clock.now,
    probe,
  });
  return { clock, fetchImpl, statuses, client, sup, s, last: () => statuses[statuses.length - 1] };
}

async function finish(t) {
  t.sup.stop('test over');
  await settle();
  assert.equal(t.clock.pending(), 0, 'no timer outlives stop()');
}

// Attempts a hub that never answers gets in `windowMs` when every failure sleeps the full backoff.
function scheduledAttempts(windowMs, jitter) {
  let at = 0;
  let base = C.SSE_BACKOFF_BASE_MS;
  let n = 0;
  while (at <= windowMs) {
    n += 1;
    at += Math.round(base * jitter);
    base = Math.min(base * 2, C.SSE_BACKOFF_MAX_MS);
  }
  return n;
}

// ── 10 minutes of hub down, ensure() every 15s: fetches follow the backoff schedule, not the ensure() spam ──
for (const [random, jitter] of [[() => 0.5, 1], [() => 0, 0.8], [() => 0.9999, 1.2]]) {
  const t = setup({}, { random });
  const TEN_MIN = 10 * 60_000;
  let ensures = 0;
  for (let at = 0; at <= TEN_MIN; at += 15_000) {
    await t.sup.ensure('offscreen-ping');
    ensures += 1;
    await t.clock.advance(15_000);
  }
  const bound = scheduledAttempts(TEN_MIN + 15_000, jitter);
  const calls = t.fetchImpl.calls.length;
  assert.ok(ensures >= 40, `ensure() was spammed (${ensures} calls)`);
  assert.ok(calls <= bound, `fetches ${calls} <= backoff bound ${bound} (jitter ${jitter})`);
  assert.ok(calls >= bound - 2, `and it kept retrying (${calls} of ${bound})`);
  assert.ok(calls < ensures, 'far fewer fetches than ensure() calls');
  assert.equal(t.client.backoffMs >= 0.8 * C.SSE_BACKOFF_MAX_MS, true, 'backoff reached its ceiling');
  await finish(t);
}

// ── URL, token and attribution come from settings (localhost normalised, trailing slash stripped) ──
{
  const t = setup({ hubUrl: 'http://localhost:3999/', token: '' }); // loopback hub without a saved token -> the local default
  assert.equal(await t.sup.ensure('boot'), 'start');
  await settle();
  const u = new URL(t.fetchImpl.last().url);
  assert.equal(u.origin, 'http://127.0.0.1:3999');
  assert.equal(u.searchParams.get('instanceId'), 'inst_test');
  assert.equal(t.fetchImpl.last().headers.Authorization, `Bearer ${C.DEFAULT_TOKEN}`);
  await finish(t);
}

// ── 401: same token -> no restart for SSE_UNAUTHORIZED_RETRY_MS; new token -> restart now ──
{
  const t = setup();
  t.fetchImpl.next(401);
  await t.sup.ensure('boot');
  await settle();
  assert.equal(t.client.state, 'unauthorized');
  for (let i = 0; i < 10; i++) {
    assert.equal(await t.sup.ensure('alarm'), 'unauthorized');
    await t.clock.advance(15_000);
  }
  assert.equal(t.fetchImpl.calls.length, 1, 'a wrong token is not hammered');
  t.fetchImpl.next(401);
  await t.clock.advance(C.SSE_UNAUTHORIZED_RETRY_MS);
  assert.equal(await t.sup.ensure('alarm'), 'start', 'retried after the cool-down (hub token may have changed)');
  await settle();
  assert.equal(t.fetchImpl.calls.length, 2);
  assert.equal(t.client.state, 'unauthorized');
  t.s.token = 'fixed';
  t.fetchImpl.next('open');
  assert.equal(await t.sup.ensure('settings'), 'start', 'new token: restart at once');
  await settle();
  assert.equal(t.client.open, true, 'recovered without a reload');
  assert.equal(t.fetchImpl.last().headers.Authorization, 'Bearer fixed');
  assert.equal(await t.sup.ensure('settings'), 'ok', 'saving the same settings again changes nothing');
  assert.equal(t.fetchImpl.calls.length, 3);
  await finish(t);
}

// ── an explicit settings save retries a 401 even with the same token ──
{
  const t = setup();
  t.fetchImpl.next(401, 'open');
  await t.sup.ensure('boot');
  await settle();
  assert.equal(await t.sup.ensure('settings', { retryUnauthorized: true }), 'start');
  await settle();
  assert.equal(t.client.open, true);
  await finish(t);
}

// ── no credentials -> stop; stop emits 'stopped' synchronously ──
{
  const t = setup({ hubUrl: 'http://192.168.1.20:3000', onboardingComplete: false });
  assert.equal(await t.sup.ensure('boot'), 'stopped', 'remote hub before onboarding: no stream');
  assert.equal(t.fetchImpl.calls.length, 0);
  assert.equal(t.statuses.length, 0, 'already idle: nothing to announce');
  t.s.onboardingComplete = true;
  t.fetchImpl.next('open');
  assert.equal(await t.sup.ensure('settings'), 'start');
  await settle();
  assert.equal(t.client.open, true);
  t.sup.stop('user');
  assert.deepEqual(t.last(), ['stopped', 'user'], 'stopped emitted synchronously');
  t.fetchImpl.next('open');
  await t.sup.ensure('boot');
  await settle();
  t.s.token = '';
  assert.equal(await t.sup.ensure('settings'), 'stopped', 'token removed on a remote hub');
  assert.equal(t.last()[0], 'stopped');
  await finish(t);
}

// ── open stream: ensure() is a no-op; stale -> restart; hub URL change -> start ──
{
  const t = setup();
  t.fetchImpl.next('open', 'open', 'open');
  await t.sup.ensure('boot');
  await settle();
  assert.equal(await t.sup.ensure('tab-activated'), 'ok');
  assert.equal(t.fetchImpl.calls.length, 1);
  t.clock.jump(C.SSE_STALE_MS + 1); // the worker was frozen: the watchdog never ran
  assert.equal(await t.sup.ensure('alarm'), 'restart');
  await settle();
  assert.equal(t.fetchImpl.calls.length, 2);
  assert.equal(t.client.open, true);
  t.s.hubUrl = 'http://127.0.0.1:4000';
  assert.equal(await t.sup.ensure('settings'), 'start');
  await settle();
  assert.equal(new URL(t.fetchImpl.last().url).port, '4000');
  await finish(t);
}

// ── hubReachable() ends a long backoff sleep (rate-limited in the client) ──
{
  const t = setup();
  await t.sup.ensure('boot');
  await settle();
  for (let i = 0; i < 6; i++) await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.backoffMs, C.SSE_BACKOFF_MAX_MS);
  t.fetchImpl.next('open');
  assert.equal(t.sup.hubReachable(), true);
  await settle();
  assert.equal(t.client.open, true, 'connected as soon as the health probe saw the hub');
  assert.equal(t.sup.snapshot().state, 'open');
  assert.equal(t.sup.hubReachable(), false, 'no-op while open');
  await finish(t);
}

// ── a loopback hub caps the backoff at SSE_BACKOFF_MAX_LOOPBACK_MS, so a restarted local hub is back in seconds ──
{
  const t = setup({ hubUrl: 'http://127.0.0.1:3999/' });
  await t.sup.ensure('boot');
  await settle();
  for (let i = 0; i < 8; i++) await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.backoffMs, C.SSE_BACKOFF_MAX_LOOPBACK_MS, 'loopback backoff never exceeds the loopback cap');
  const before = t.fetchImpl.calls.length;
  t.fetchImpl.next('open');
  await t.clock.advance(C.SSE_BACKOFF_MAX_LOOPBACK_MS);
  assert.equal(t.fetchImpl.calls.length, before + 1);
  assert.equal(t.client.open, true, 'reconnected within one capped backoff');
  await finish(t);
}

// ── ensure() during a long backoff probes the hub and reconnects at once when it answers ──
{
  let up = false;
  let probes = 0;
  const t = setup({}, { probe: async () => { probes += 1; return up; } });
  await t.sup.ensure('boot');
  await settle();
  for (let i = 0; i < 6; i++) await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.backoffMs, C.SSE_BACKOFF_MAX_MS);
  await t.clock.advance(1_000); // mid-sleep: far more than SSE_BACKOFF_PROBE_AFTER_MS left
  assert.equal(await t.sup.ensure('offscreen-ping'), 'backoff', 'hub still down: keep sleeping');
  assert.equal(probes, 1);
  up = true;
  t.fetchImpl.next('open');
  await t.clock.advance(3_000);
  assert.equal(await t.sup.ensure('offscreen-ping'), 'woken', 'hub answered the probe');
  await settle();
  assert.equal(t.client.open, true, 'connected without waiting out the backoff');
  assert.equal(await t.sup.ensure('offscreen-ping'), 'ok');
  assert.equal(probes, 2, 'no probe while the stream is open');
  await finish(t);
}

console.log('[test] sse_supervisor: all passed');
