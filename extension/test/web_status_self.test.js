// lib/web-status-self.js: onboarding and the Web Access tab must judge THIS browser's entry on the hub, not the
// top-level web_status values, which describe whichever browser the hub routes an untargeted call to.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { selfBridgeStatus } = await import('../lib/web-status-self.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

console.log('[test] running web_status_self tests...');

const entry = (instanceId, over = {}) => ({ instanceId, name: 'chrome', online: true, sseConnected: true, activeTab: { url: `https://${instanceId}.test/` }, ...over });

// Scenario 1: profile A is the routing target and its stream is down; B (this browser) is healthy.
{
  const status = { online: false, sseConnected: false, targetInstanceId: 'inst_a',
    browsers: [entry('inst_a', { sseConnected: false }), entry('inst_b')] };
  const me = selfBridgeStatus(status, 'inst_b');
  assert.equal(me.online, true, 'B passes although the routed-to browser A is down');
  assert.equal(me.sseConnected, true);
  assert.equal(me.activeTab.url, 'https://inst_b.test/', "B's own active tab");
}

// Scenario 2: A is up and routed to; B's stream is down, or B never registered.
{
  const status = { online: true, sseConnected: true, targetInstanceId: 'inst_a',
    browsers: [entry('inst_a'), entry('inst_b', { sseConnected: false })] };
  assert.equal(selfBridgeStatus(status, 'inst_b').online, false, "B fails although A's stream is up");
  assert.equal(selfBridgeStatus(status, 'INST_A').online, true, 'instanceId match is case-insensitive');
  const unregistered = selfBridgeStatus(status, 'inst_c');
  assert.deepEqual([unregistered.known, unregistered.registered, unregistered.online], [true, false, false]);
  assert.equal(selfBridgeStatus({ ...status, browsers: [entry('inst_b', { online: false })] }, 'inst_b').online, false, 'heartbeat expired');
}

// An older hub: per-browser sseConnected absent -> the heartbeat decides; no browsers list -> top level.
assert.equal(selfBridgeStatus({ browsers: [{ instanceId: 'inst_b', online: true }] }, 'inst_b').online, true);
assert.equal(selfBridgeStatus({ online: true }, 'inst_b').online, true);
assert.equal(selfBridgeStatus({ online: true, browsers: [] }, null).known, false, 'no instanceId: top level');
for (const junk of [null, undefined, 'x', 42]) assert.equal(selfBridgeStatus(junk, 'inst_b').online, false);

// The consumers read `self`, never the routed-to top level alone.
assert.match(read('background.js'), /selfBridgeStatus\(bridge, /, 'get-web-status answers self');
assert.match(read('pages/onboarding.js'), /statusRes\?\.self\?\.online === true/, 'onboarding checks this browser');
assert.doesNotMatch(read('pages/onboarding.js'), /bridge\?\.online/, 'onboarding does not use the routing target');
assert.match(read('components/web-access.js'), /const b = r\.self \|\|/, 'the Web Access pill reads self');

console.log('[test] web_status_self: all passed');
