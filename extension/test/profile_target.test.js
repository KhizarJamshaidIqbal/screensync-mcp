// matchesSelfTarget: a web_request that names no instance, profile, email or browser reaches EVERY connected
// profile. An older hub sent one whenever its selectedProfile had gone offline, so with two logged-in Chrome
// profiles one web_click ran in both accounts. The hub now always names an instance; these pin the extension's
// own guard for older hubs: accept an untargeted request only when the hub has not reported another instance
// online, and keep the old behaviour when the hub sends no browser list.

import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();
const { matchesSelfTarget, noteHubPresence } = await import('../lib/profile-identity.js');

const self = { instanceId: 'inst-a', browserName: 'chrome', runtimeId: 'rt', profileEmail: 'a@profile.test', profileName: 'a' };
const untargeted = { id: '1', tool: 'web_click', args: { selector: '#post' }, targetInstanceId: null, targetBrowser: null, targetEmail: null, targetProfile: null };
const presence = (...online) => ({ browsers: online.map((on, i) => ({ instanceId: `inst-${i}`, online: on })) });

// Before any register reply the count is unknown: the old behaviour stands.
assert.equal(matchesSelfTarget(untargeted, self), true, 'unknown presence keeps accepting');

noteHubPresence(presence(true, true));
assert.equal(matchesSelfTarget(untargeted, self), false, 'two instances online: an untargeted request is dropped');
assert.equal(matchesSelfTarget({ ...untargeted, targetBrowser: 'any' }, self), false, "'any' names no browser");
assert.equal(matchesSelfTarget({ ...untargeted, args: { __browser: 'default' } }, self), false, "'default' names no browser");

// Targeted requests are judged exactly as before, whatever the presence count.
assert.equal(matchesSelfTarget({ ...untargeted, targetInstanceId: 'inst-a' }, self), true, 'addressed to us');
assert.equal(matchesSelfTarget({ ...untargeted, targetInstanceId: 'inst-b' }, self), false, 'addressed to the other profile');
assert.equal(matchesSelfTarget({ ...untargeted, args: { __profile: 'a@profile.test' } }, self), true, 'a profile hint that is us');

noteHubPresence(presence(true, false));
assert.equal(matchesSelfTarget(untargeted, self), true, 'the only instance online still accepts');

noteHubPresence({ online: true }); // an older hub's reply without a browser list
assert.equal(matchesSelfTarget(untargeted, self), true, 'no browser list: unknown, old behaviour');
noteHubPresence(undefined);
assert.equal(matchesSelfTarget(untargeted, self), true, 'no reply body: unknown, old behaviour');

// The count can also be passed explicitly (pure use).
assert.equal(matchesSelfTarget(untargeted, self, 3), false);
assert.equal(matchesSelfTarget(untargeted, self, 1), true);

console.log('profile_target: ok');
