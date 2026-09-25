// lib/sse-client.js + lib/sse-parse.js against a fake clock and a fetch that returns a real
// Response(ReadableStream). Each block pins one of the 1.14.0 bugs (A-I in the 1.14.1 design) so it cannot
// come back: `connected` meant "attempt in flight", a 401 was permanent, stop() never said 'stopped', leftover
// liveness timers killed new handshakes, event ids were ignored, and non-OK bodies were never cancelled.
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';
import { createClock, createFetch, settle, encode } from './sse-fakes.js';

globalThis.chrome = createChromeMock();

const { SseClient } = await import('../lib/sse-client.js');
const { parseSseChunk } = await import('../lib/sse-parse.js');
const C = await import('../lib/constants.js');

console.log('[test] running sse_client tests...');

const HUB = 'http://127.0.0.1:3999';

function setup({ random = () => 0.5 } = {}) {
  const clock = createClock();
  const fetchImpl = createFetch();
  const statuses = [];
  const events = [];
  const client = new SseClient({
    onEvent: (ev) => events.push(ev),
    onStatus: (s, d) => statuses.push([s, d]),
    fetchImpl, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random,
  });
  const lastStatus = () => statuses[statuses.length - 1];
  return { clock, fetchImpl, statuses, events, client, lastStatus };
}

async function done(t) {
  t.client.stop('test over');
  await settle();
  assert.equal(t.clock.pending(), 0, 'no timer may outlive stop()');
}

// ── parseSseChunk: CRLF, multi-line data, comments, ids, split boundaries ──
{
  let r = parseSseChunk(': connected\n\nid: 1\ndata: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(r.events, [{ id: '1', data: '{"a":1}' }]);
  assert.equal(r.rest, 'data: {"b"');
  r = parseSseChunk('id: 2\r\ndata: line1\r\ndata: line2\r\n\r\n: keepalive\r\n\r\n');
  assert.deepEqual(r.events, [{ id: '2', data: 'line1\nline2' }]);
  assert.equal(r.rest, '');
  r = parseSseChunk('data: x\r'); // CR of a CRLF, LF still in flight
  assert.deepEqual(r.events, []);
  r = parseSseChunk(r.rest + '\n\r\n');
  assert.deepEqual(r.events, [{ id: null, data: 'x' }]);
  r = parseSseChunk('data: a\n');
  r = parseSseChunk(r.rest + '\n');
  assert.deepEqual(r.events, [{ id: null, data: 'a' }], 'blank line split across chunks');
  assert.deepEqual(parseSseChunk('id: 9\n\n').events, [], 'no data -> no event');
  assert.deepEqual(parseSseChunk('data:tight\n\n').events, [{ id: null, data: 'tight' }]);
}

// ── A: `open` is the stream, not the attempt; 404 waits are not "connected" ──
{
  const t = setup();
  t.fetchImpl.next('hang');
  t.client.start(HUB, 'tok', { instanceId: 'inst_a' });
  await settle();
  assert.equal(t.client.state, 'connecting');
  assert.equal(t.client.open, false, 'a pending handshake is not open');
  assert.equal(t.client.active, true);
  assert.equal('connected' in t.client, false, 'the misleading `connected` getter is gone');
  t.client.stop();
  t.fetchImpl.next(404);
  t.client.start(HUB, 'tok');
  await settle();
  assert.equal(t.client.state, 'backoff');
  assert.equal(t.client.open, false, '404 wait is not open');
  assert.equal(t.lastStatus()[0], 'error');
  assert.match(t.lastStatus()[1], /^404/);
  // I: the refused body is cancelled, not left dangling
  assert.equal(t.fetchImpl.last().stream.cancelled, true, 'non-OK body cancelled');
  await done(t);
}

// ── B: a 401 ends the loop but is not permanent: start() again retries ──
{
  const t = setup();
  t.fetchImpl.next(401);
  t.client.start(HUB, 'wrong');
  await settle();
  assert.equal(t.client.state, 'unauthorized');
  assert.deepEqual(t.lastStatus(), ['error', '401 — wrong pairing token']);
  assert.equal(t.client.active, false);
  assert.equal(t.fetchImpl.last().stream.cancelled, true, '401 body cancelled');
  await t.clock.advance(120_000);
  assert.equal(t.fetchImpl.calls.length, 1, 'no retry storm after a 401');
  t.fetchImpl.next('open');
  assert.equal(t.client.start(HUB, 'right'), true);
  await settle();
  assert.equal(t.client.open, true, 'recovers with the new token, no reload needed');
  assert.equal(t.fetchImpl.last().headers.Authorization, 'Bearer right');
  await done(t);
}

// ── C: stop() emits 'stopped' synchronously, from any state; idle stop is silent ──
{
  const t = setup();
  t.client.stop();
  assert.equal(t.statuses.length, 0, 'stopping an idle client says nothing');
  t.fetchImpl.next('open');
  t.client.start(HUB, 'tok');
  await settle();
  assert.equal(t.client.open, true);
  t.client.stop('user');
  assert.deepEqual(t.lastStatus(), ['stopped', 'user'], 'emitted before any await');
  assert.equal(t.client.state, 'idle');
  await settle();
  assert.deepEqual(t.lastStatus(), ['stopped', 'user'], 'no late status from the aborted loop');
  t.fetchImpl.next(500);
  t.client.start(HUB, 'tok');
  await settle();
  assert.equal(t.client.state, 'backoff');
  t.client.stop();
  assert.equal(t.lastStatus()[0], 'stopped', 'stop during backoff');
  await done(t);
}

// ── D: start() with the same credentials never interrupts a backoff; backoff grows, +-20% jitter ──
{
  const t = setup({ random: () => 0.5 });
  t.client.start(HUB, 'tok', { instanceId: 'i1' }); // hub down (fallback)
  await settle();
  assert.equal(t.client.state, 'backoff');
  assert.equal(t.client.backoffMs, C.SSE_BACKOFF_BASE_MS);
  assert.equal(t.client.start(HUB, 'tok', { instanceId: 'i1' }), false, 'same creds + active = no-op');
  assert.equal(t.fetchImpl.calls.length, 1);
  const delays = [t.client.backoffMs];
  for (let i = 0; i < 6; i++) {
    await t.clock.advance(t.client.backoffMs);
    delays.push(t.client.backoffMs);
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(t.client.attempt, 7);
  assert.equal(t.client.snapshot().nextRetryAt, t.clock.now() + 30000);
  t.client.stop();
  const lo = setup({ random: () => 0 });
  lo.client.start(HUB, 'tok');
  await settle();
  assert.equal(lo.client.backoffMs, 800, '-20%');
  const hi = setup({ random: () => 0.9999 });
  hi.client.start(HUB, 'tok');
  await settle();
  assert.equal(hi.client.backoffMs, 1200, '+20%');
  await done(lo);
  await done(hi);
  await done(t);
}

// ── E: liveness fires on silence, and an old stream's timer never aborts the next handshake ──
{
  const t = setup();
  t.fetchImpl.next('open', 'open');
  t.client.start(HUB, 'tok');
  await settle();
  const first = t.fetchImpl.last().stream;
  first.push('data: {"type":"a"}\n\n');
  await t.clock.advance(1000);
  first.end(); // graceful end 1s after the last byte: its liveness timer must die with it
  await settle();
  assert.equal(t.client.state, 'backoff');
  await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.open, true, 'second stream open');
  const second = t.fetchImpl.last().stream;
  await t.clock.advance(C.SSE_LIVENESS_MS - 1500); // past the FIRST stream's would-be deadline
  assert.equal(t.client.open, true, 'leftover liveness timer did not abort the new stream');
  second.push(': keepalive\n\n');
  await t.clock.advance(C.SSE_LIVENESS_MS - 1);
  assert.equal(t.client.open, true, 'keepalive re-arms the watchdog');
  await t.clock.advance(2);
  assert.equal(t.client.state, 'backoff', 'silence past SSE_LIVENESS_MS aborts');
  assert.equal(t.lastStatus()[0], 'reconnecting');
  assert.match(t.lastStatus()[1], /liveness timeout/);
  await done(t);
}

// ── F: graceful end -> 'reconnecting' "stream ended by hub", final event delivered; UTF-8 split chunks ──
{
  const t = setup();
  t.fetchImpl.next('open');
  t.client.start(HUB, 'tok');
  await settle();
  const s = t.fetchImpl.last().stream;
  const bytes = encode('data: {"t":"héllo €"}\n\n');
  const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte euro sign
  s.push(bytes.slice(0, cut));
  await settle();
  s.push(bytes.slice(cut));
  s.push('data: {"n":2}\n\n');
  s.end();
  await settle();
  assert.deepEqual(t.events, [{ t: 'héllo €' }, { n: 2 }], 'multi-byte char split across chunks survives');
  assert.deepEqual(t.lastStatus(), ['reconnecting', 'stream ended by hub']);
  await done(t);
}

// ── G: ids tracked, Last-Event-ID sent on reconnect, attribution query ──
{
  const t = setup();
  t.fetchImpl.next('open', 'open');
  t.client.start(`${HUB}/`, 'tok', { instanceId: 'inst chrome/1' });
  await settle();
  const first = t.fetchImpl.calls[0];
  const u = new URL(first.url);
  assert.equal(u.origin + u.pathname, `${HUB}/api/events`, 'trailing slash stripped');
  assert.equal(u.searchParams.get('client'), 'extension');
  assert.equal(u.searchParams.get('instanceId'), 'inst chrome/1');
  assert.equal(first.headers['Last-Event-ID'], undefined, 'nothing to resume on the first connect');
  first.stream.push('id: 41\ndata: {"a":1}\n\nid: 42\ndata: {"a":2}\n\ndata: {"no":"id"}\n\n');
  await settle();
  assert.equal(t.client.lastEventId, '42', 'an event without id keeps the last id');
  first.stream.end();
  await settle();
  await t.clock.advance(t.client.backoffMs);
  assert.equal(t.fetchImpl.calls[1].headers['Last-Event-ID'], '42', 'resume where we left off');
  assert.equal(t.client.snapshot().lastEventId, '42');
  t.client.stop();
  t.fetchImpl.next('open');
  t.client.start('http://10.0.0.5:3000', 'tok');
  await settle();
  assert.equal(t.fetchImpl.last().headers['Last-Event-ID'], undefined, 'another hub: ids reset');
  await done(t);
}

// ── H: stale() only for an open stream silent past SSE_STALE_MS (timers frozen) ──
{
  const t = setup();
  assert.equal(t.client.stale(), false);
  t.fetchImpl.next('open');
  t.client.start(HUB, 'tok');
  await settle();
  t.clock.jump(C.SSE_STALE_MS - 1);
  assert.equal(t.client.stale(), false);
  t.clock.jump(2);
  assert.equal(t.client.stale(), true, 'silent open stream is stale');
  assert.equal(C.SSE_STALE_MS > C.SSE_LIVENESS_MS, true, 'stale is the backstop behind the watchdog');
  assert.equal(C.SSE_LIVENESS_MS >= 3 * C.SSE_KEEPALIVE_EXPECTED_MS, true, 'watchdog allows 3 missed keepalives');
  t.client.stop();
  t.client.start(HUB, 'tok'); // down -> backoff
  await settle();
  t.clock.jump(10 * C.SSE_STALE_MS);
  assert.equal(t.client.stale(), false, 'backoff is never stale');
  await done(t);
}

// ── I: 5xx/429 back off with detail; connect timeout aborts a hung handshake ──
{
  const t = setup();
  t.fetchImpl.next(429);
  t.client.start(HUB, 'tok');
  await settle();
  assert.deepEqual(t.lastStatus(), ['error', '429 — too many connections, retrying...']);
  t.fetchImpl.next(503);
  await t.clock.advance(t.client.backoffMs);
  assert.match(t.lastStatus()[1], /^503/);
  assert.equal(t.fetchImpl.last().stream.cancelled, true);
  t.fetchImpl.next('hang');
  await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.state, 'connecting');
  await t.clock.advance(C.SSE_CONNECT_TIMEOUT_MS);
  assert.equal(t.client.state, 'backoff');
  assert.match(t.lastStatus()[1], /connect timeout/);
  await done(t);
}

// ── Backoff resets only after a stable stream ──
{
  const t = setup();
  t.client.start(HUB, 'tok');
  await settle();
  await t.clock.advance(t.client.backoffMs); // 2s next
  await t.clock.advance(t.client.backoffMs); // 4s next
  assert.equal(t.client.backoffMs, 4000);
  t.fetchImpl.next('open');
  await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.open, true);
  await t.clock.advance(5000);
  t.fetchImpl.last().stream.end(); // flapping: open 5s only
  await settle();
  assert.equal(t.client.backoffMs, 8000, 'a short-lived stream does not reset the backoff');
  t.fetchImpl.next('open');
  await t.clock.advance(t.client.backoffMs);
  const s = t.fetchImpl.last().stream;
  for (let i = 0; i < 4; i++) { await t.clock.advance(10_000); s.push(': keepalive\n\n'); }
  s.end();
  await settle();
  assert.equal(t.client.backoffMs, C.SSE_BACKOFF_BASE_MS, 'stable (>= SSE_STABLE_MS) stream resets it');
  assert.equal(t.client.attempt, 1);
  await done(t);
}

// ── wake(): only in backoff, rate-limited ──
{
  const t = setup();
  t.client.start(HUB, 'tok');
  await settle();
  for (let i = 0; i < 6; i++) await t.clock.advance(t.client.backoffMs);
  assert.equal(t.client.backoffMs, 30000);
  const before = t.fetchImpl.calls.length;
  assert.equal(t.client.wake('hub reachable'), true);
  await settle();
  assert.equal(t.fetchImpl.calls.length, before + 1, 'retried at once');
  assert.equal(t.client.wake('again'), false, 'rate-limited within SSE_WAKE_MIN_GAP_MS');
  await t.clock.advance(C.SSE_WAKE_MIN_GAP_MS);
  assert.equal(t.client.wake('later'), true);
  t.client.stop();
  t.fetchImpl.next('open');
  t.client.start(HUB, 'tok');
  await settle();
  assert.equal(t.client.wake('open'), false, 'no-op while open');
  await done(t);
}

// ── A handler that stops the client: later events in the same chunk are not dispatched ──
{
  const t = setup();
  let seen = 0;
  t.client.onEvent = () => { seen += 1; t.client.stop('handler'); };
  t.fetchImpl.next('open');
  t.client.start(HUB, 'tok');
  await settle();
  t.fetchImpl.last().stream.push('data: {"a":1}\n\ndata: {"a":2}\n\n');
  await settle();
  assert.equal(seen, 1, 'generation checked before each dispatch');
  assert.equal(t.client.state, 'idle');
  await done(t);
}

// ── restart(): same credentials, reconnects now, snapshot counts it ──
{
  const t = setup();
  t.fetchImpl.next('open', 'open');
  t.client.start(HUB, 'tok');
  await settle();
  const first = t.fetchImpl.last().stream;
  assert.equal(t.client.restart('stale stream'), true);
  await settle();
  assert.equal(first.closed, true, 'old stream aborted');
  assert.equal(t.client.open, true);
  const snap = t.client.snapshot();
  assert.equal(snap.reconnects, 1);
  assert.equal(snap.hubUrl, HUB);
  for (const k of ['state', 'open', 'active', 'detail', 'since', 'openedAt', 'lastDataAt', 'lastEventId', 'attempt', 'reconnects', 'backoffMs', 'nextRetryAt', 'hubUrl']) {
    assert.ok(k in snap, `snapshot has ${k}`);
  }
  await done(t);
}

// ── a 200 that is not an event stream (another server on the hub's port) is an error, never 'connected' ──
{
  const t = setup();
  t.fetchImpl.next('html');
  t.client.start(HUB, 'tok');
  await settle();
  assert.equal(t.client.open, false, 'an HTML page is not a live stream');
  assert.equal(t.client.state, 'backoff');
  assert.equal(t.statuses.some(([s]) => s === 'connected'), false, 'never reported connected');
  assert.equal(t.lastStatus()[0], 'error');
  assert.match(t.lastStatus()[1], /text\/html.*not an event stream \(port conflict\?\)/);
  assert.equal(t.fetchImpl.last().stream.cancelled, true, 'the page body is cancelled');
  await done(t);
}

// ── meta.silenceMs: how long the stream was silent before an event's bytes began to arrive ──
// (web-bridge.js asks the hub whether a web_request that may have sat in a stalled socket is still pending.)
{
  const t = setup();
  const metas = [];
  t.client.onEvent = (ev, meta) => { t.events.push(ev); metas.push(meta); };
  t.fetchImpl.next('open');
  t.client.start(HUB, 'tok');
  await settle();
  const s = t.fetchImpl.last().stream;
  t.clock.jump(2_000);
  s.push('data: {"n":1}\n\n');
  await settle();
  t.clock.jump(50_000); // a stall: nothing arrives for 50s (below the 90s liveness window)
  s.push('data: {"n":2');
  await settle();
  t.clock.jump(1_000);
  s.push('}\n\n');
  await settle();
  assert.deepEqual(t.events.map((e) => e.n), [1, 2]);
  assert.equal(metas[0].silenceMs, 2_000);
  assert.equal(metas[1].silenceMs, 51_000, 'measured from before the event\'s first bytes, across chunks');
  await done(t);
}

console.log('[test] sse_client: all passed');
