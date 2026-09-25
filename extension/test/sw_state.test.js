// Unit tests for the service-worker state registry (lib/sw-state.js) and the hub URL
// helpers in lib/api.js (normalizeHubBase / isLoopbackHub).
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const { SW_STARTED_AT, provideSwState, readSwState, swUptimeSeconds } = await import('../lib/sw-state.js');
const { normalizeHubBase, isLoopbackHub, DEFAULT_HUB_URL } = await import('../lib/api.js');

console.log('[test] running sw_state unit tests...');

// 1. readSwState: missing key -> null
assert.equal(readSwState('sse'), null, 'unregistered key must read as null');

// 2. provider value is returned (fresh on every read)
let n = 0;
provideSwState('health', () => ({ ok: true, latencyMs: 8, checkedAt: ++n }));
assert.deepEqual(readSwState('health'), { ok: true, latencyMs: 8, checkedAt: 1 });
assert.equal(readSwState('health').checkedAt, 2, 'getter must be called on each read');

// 3. throwing getter -> null, never throws
provideSwState('sse', () => { throw new Error('boom'); });
assert.doesNotThrow(() => readSwState('sse'));
assert.equal(readSwState('sse'), null, 'throwing getter must read as null');

// 4. undefined -> null; replace provider; non-function unregisters
provideSwState('sse', () => undefined);
assert.equal(readSwState('sse'), null);
provideSwState('sse', () => ({ state: 'open', open: true }));
assert.equal(readSwState('sse').state, 'open');
provideSwState('sse', null);
assert.equal(readSwState('sse'), null, 'non-function provider must unregister the key');

// 5. swUptimeSeconds
assert.equal(typeof SW_STARTED_AT, 'number');
assert.equal(swUptimeSeconds(SW_STARTED_AT), 0);
assert.equal(swUptimeSeconds(SW_STARTED_AT + 4_999), 4);
assert.equal(swUptimeSeconds(SW_STARTED_AT + 125_000), 125);
assert.equal(swUptimeSeconds(SW_STARTED_AT - 10_000), 0, 'clock skew must never go negative');
assert.ok(swUptimeSeconds() >= 0);

// 6. normalizeHubBase
assert.equal(DEFAULT_HUB_URL, 'http://127.0.0.1:3000');
assert.equal(normalizeHubBase('http://localhost:3000'), 'http://127.0.0.1:3000', 'localhost -> 127.0.0.1');
assert.equal(normalizeHubBase('http://LOCALHOST:3001/'), 'http://127.0.0.1:3001');
assert.equal(normalizeHubBase('http://localhost'), 'http://127.0.0.1');
assert.equal(normalizeHubBase('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000', 'trailing slash stripped');
assert.equal(normalizeHubBase('http://127.0.0.1:3000//'), 'http://127.0.0.1:3000');
assert.equal(normalizeHubBase('  http://192.168.1.20:3000/  '), 'http://192.168.1.20:3000', 'whitespace trimmed');
assert.equal(normalizeHubBase(''), 'http://127.0.0.1:3000', 'empty -> default');
assert.equal(normalizeHubBase('   '), 'http://127.0.0.1:3000');
assert.equal(normalizeHubBase(undefined), 'http://127.0.0.1:3000');
assert.equal(normalizeHubBase(null), 'http://127.0.0.1:3000');
assert.equal(normalizeHubBase('https://hub.example.com/'), 'https://hub.example.com', 'https kept');
assert.equal(normalizeHubBase('https://localhost:8443'), 'https://127.0.0.1:8443');
assert.equal(normalizeHubBase('http://localhost.example.com:3000'), 'http://localhost.example.com:3000',
  'only the exact localhost host is rewritten');

// 7. isLoopbackHub
assert.equal(isLoopbackHub('http://127.0.0.1:3000'), true);
assert.equal(isLoopbackHub('http://localhost:3001/'), true);
assert.equal(isLoopbackHub('https://localhost'), true);
assert.equal(isLoopbackHub('http://127.1.2.3:3000'), true);
assert.equal(isLoopbackHub('http://[::1]:3000'), true);
assert.equal(isLoopbackHub(''), true, 'empty resolves to the default local hub');
assert.equal(isLoopbackHub('http://192.168.1.20:3000'), false, 'LAN IP is not loopback');
assert.equal(isLoopbackHub('http://10.0.0.5:3000'), false);
assert.equal(isLoopbackHub('https://hub.example.com'), false);
assert.equal(isLoopbackHub('http://127.0.0.1.evil.com:3000'), false, 'lookalike host is not loopback');
assert.equal(isLoopbackHub('http://localhost.example.com'), false);
assert.equal(isLoopbackHub('not a url'), false, 'unparseable -> false');

console.log('[test] sw_state.test.js: ALL ASSERTIONS PASSED');
