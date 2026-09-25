// getInstanceId(): a fresh service worker asks for its instance id from several places at once (boot, the
// health alarm, tab events, the SSE supervisor). With empty storage every concurrent caller used to mint its
// own id, so the hub listed a phantom second browser instance. And the id must survive a service-worker
// restart / chrome.runtime.reload() (a fresh module instance reading the same storage).
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

console.log('[test] running profile_identity tests...');

const first = await import('../lib/profile-identity.js?sw=1');
const ids = await Promise.all(Array.from({ length: 8 }, () => first.getInstanceId()));
assert.equal(new Set(ids).size, 1, `concurrent first calls agree on one id, got ${[...new Set(ids)].join(', ')}`);
assert.match(ids[0], /^inst_/);
assert.equal(chrome.storage.local._map.get('instanceId'), ids[0], 'and that id is the one persisted');

// A restarted service worker (new module instance, same storage) keeps the same identity.
await chrome.storage.local.set({ profileEmail: 'me@profile.test', profileName: 'me' });
const second = await import('../lib/profile-identity.js?sw=2');
const again = await Promise.all([second.getInstanceId(), second.getProfileIdentity()]);
assert.equal(again[0], ids[0], 'same instance id after a restart');
assert.equal(again[1].instanceId, ids[0]);
assert.equal(again[1].profileEmail, 'me@profile.test', 'persisted profile email survives a restart');

console.log('[test] profile_identity: all passed');
