// Unit tests for extension storage: asserts token & secrets never land in sync storage (D2)
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const { getSettings, saveSettings } = await import('../lib/storage.js');

console.log('[test] running storage unit tests...');

// 1. Initial defaults (Safe defaults: OFF by default per §0 / Phase 0)
const s1 = await getSettings();
assert.equal(typeof s1.token, 'string', 'Token should be present in settings');
assert.equal(s1.token, '', 'Safe default: token must be empty on fresh install (no default secret)');
assert.equal(s1.onboardingComplete, false, 'Safe default: onboardingComplete must be false on fresh install');
assert.equal(s1.webAccessEnabled, false, 'Safe default: webAccessEnabled must be false on fresh install (OFF by default)');
assert.equal(typeof s1.hubUrl, 'string', 'hubUrl should be present');

// 2. Saving secret token writes to local, NOT sync
await saveSettings({ token: 'test-secret-token-12345', hubUrl: 'http://127.0.0.1:3000', theme: 'light' });

const localData = await chrome.storage.local.get(null);
const syncData = await chrome.storage.sync.get(null);

assert.equal(localData.token, 'test-secret-token-12345', 'Token must be stored in chrome.storage.local');
assert.equal(localData.hubUrl, 'http://127.0.0.1:3000', 'hubUrl must be stored in chrome.storage.local');
assert.equal(syncData.token, undefined, 'CRITICAL: Token must NEVER be written to chrome.storage.sync (D2)');
assert.equal(syncData.hubUrl, undefined, 'CRITICAL: hubUrl must NEVER be written to chrome.storage.sync (D2)');
assert.equal(syncData.theme, 'light', 'UI preferences (theme) must be stored in chrome.storage.sync');

const s2 = await getSettings();
assert.equal(s2.token, 'test-secret-token-12345');
assert.equal(s2.theme, 'light');

console.log('[test] storage.test.js: ALL ASSERTIONS PASSED (D2 guaranteed)');
