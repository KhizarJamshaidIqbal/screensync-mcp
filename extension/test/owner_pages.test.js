// Who may drive the extension's controls.
//
// The service worker answers messages that read and change what the owner decided (grants, web access, the
// approval queue), and the offscreen page can read the clipboard. Nothing in this build lets an agent run code
// where it could send those messages (web_run_code and web_eval run in the page's own world through the
// debugger; the extension's isolated world did not evaluate a string when checked in Chrome), so this is
// hardening. These tests pin that a sender that is not the extension's own page is refused everywhere, so
// that stays true if a future feature changes what can run in a tab.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createChromeMock } from './harness.js';

globalThis.chrome = createChromeMock();

const { isOwnerPage, ownerMessagesOnly, ownerPortsOnly, lockStorageToOwnerContexts } = await import('../lib/owner-pages.js');
const { enqueueApproval, getPendingApprovals, resolveApproval } = await import('../lib/consent.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const ID = chrome.runtime.id;
const base = `chrome-extension://${ID}/`;

const owners = {
  popup: { id: ID, url: `${base}pages/popup.html` },
  dashboardOpenedInATab: { id: ID, url: `${base}pages/dashboard.html`, tab: { id: 3 } },
  serviceWorker: { id: ID, url: `${base}background.js` },
  workerWithoutAUrl: { id: ID, origin: `chrome-extension://${ID}` },
};
const outsiders = {
  scriptInjectedIntoATab: { id: ID, url: 'https://shop.example/cart', origin: 'https://shop.example', tab: { id: 7 }, frameId: 0 },
  scriptInjectedIntoAFrame: { id: ID, url: 'https://ads.example/frame', origin: 'https://ads.example', tab: { id: 7 }, frameId: 4 },
  anotherExtension: { id: 'someone-else', url: 'chrome-extension://someone-else/pages/popup.html' },
  anotherExtensionWithOurUrl: { id: 'someone-else', url: `${base}pages/popup.html` },
  lookalikeHost: { id: ID, url: `chrome-extension://${ID}.evil/pages/popup.html` },
  lookalikeOrigin: { id: ID, origin: `chrome-extension://${ID}.evil` },
  ourUrlInAQuery: { id: ID, url: `https://evil.example/?next=${base}pages/popup.html`, origin: 'https://evil.example' },
  noUrlAtAll: { id: ID },
  empty: {},
  nothing: undefined,
  nul: null,
};

console.log('[test] running owner-pages tests...');

// ── TEST 1: only the extension's own pages and service worker count as the owner ──
for (const [name, sender] of Object.entries(owners)) assert.equal(isOwnerPage(sender), true, `${name} is the owner`);
for (const [name, sender] of Object.entries(outsiders)) assert.equal(isOwnerPage(sender), false, `${name} is not`);

// ── TEST 2: a message from a tab never reaches the handler, and nothing is answered ──
{
  const seen = [];
  const answers = [];
  const listener = ownerMessagesOnly((msg, _sender, respond) => { seen.push(msg.type); respond({ ok: true }); return true; });
  const respond = (r) => answers.push(r);

  assert.equal(listener({ type: 'get-approvals' }, owners.popup, respond), true, 'the popup is served, and its async answer is kept open');
  assert.deepEqual(seen, ['get-approvals']);
  assert.equal(answers.length, 1);

  for (const [name, sender] of Object.entries(outsiders)) {
    assert.equal(listener({ type: 'resolve-approval', id: 'x', approved: true }, sender, respond), false, `${name}: refused`);
  }
  assert.equal(listener(null, outsiders.scriptInjectedIntoATab, respond), false, 'a malformed message from a tab is refused, not a crash');
  // The in-page approval dialog and the help overlay talk to their own listeners, which judge them; here they are
  // declined like any other message from a tab, just without a warning in the console for each one.
  const warned = [];
  const warn = console.warn;
  console.warn = (...a) => { warned.push(a.join(' ')); };
  try {
    for (const type of ['ss-approval-dialog', 'help_overlay_done']) {
      assert.equal(listener({ type, id: 'x', decision: 'approve' }, outsiders.scriptInjectedIntoATab, respond), false, `${type} from a tab: declined`);
    }
    assert.equal(warned.length, 0, 'quietly');
    listener({ type: 'resolve-approval' }, outsiders.scriptInjectedIntoATab, respond);
    assert.equal(warned.length, 1, 'anything else from a tab is still reported');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(seen, ['get-approvals'], 'none of them reached the handler');
  assert.equal(answers.length, 1, 'and none was answered');
}

// ── TEST 3: what a script in a tab would try: approve its own request ──
{
  const pending = enqueueApproval({ origin: 'https://shop.example', tool: 'web_click', risk: 'destructive', details: {}, timeoutMs: 30_000 });
  const settled = pending.then(() => 'approved', (e) => e.code);
  const [item] = getPendingApprovals();
  assert.ok(item, 'a request is waiting for a person');

  // The same shape as the service worker's own handlers: it lists what is waiting and resolves a request.
  const serviceWorker = ownerMessagesOnly((msg, _sender, respond) => {
    if (msg.type === 'get-approvals') respond({ ok: true, approvals: getPendingApprovals() });
    if (msg.type === 'resolve-approval') respond(resolveApproval(msg.id, msg.approved === true));
    return true;
  });
  const fromTheAgent = (msg) => { let got; serviceWorker(msg, outsiders.scriptInjectedIntoATab, (r) => { got = r; }); return got; };

  assert.equal(fromTheAgent({ type: 'get-approvals' }), undefined, 'it cannot even see what is waiting');
  assert.equal(fromTheAgent({ type: 'resolve-approval', id: item.id, approved: true }), undefined, 'and it cannot approve it');
  assert.equal(getPendingApprovals().length, 1, 'the request is still waiting for a person');

  let answered;
  serviceWorker({ type: 'resolve-approval', id: item.id, approved: false }, owners.popup, (r) => { answered = r; });
  assert.equal(answered.ok, true, 'the owner, from the popup, can');
  assert.equal(await settled, 'USER_DECLINED');
}

// ── TEST 4: a port from a tab is closed, not served ──
{
  let served = 0;
  let closed = 0;
  const onConnect = ownerPortsOnly(() => { served += 1; });
  onConnect({ name: 'dashboard', sender: owners.popup, disconnect() { closed += 1; } });
  assert.equal(served, 1);
  assert.equal(closed, 0);
  onConnect({ name: 'snoop', sender: outsiders.scriptInjectedIntoATab, disconnect() { closed += 1; } });
  assert.equal(served, 1, 'the snapshot (settings included) is not sent to a script in a tab');
  assert.equal(closed, 1);
  onConnect({ name: 'snoop', sender: outsiders.scriptInjectedIntoATab, disconnect() { throw new Error('already gone'); } });
  onConnect(undefined);
}

// ── TEST 5: storage is limited to the extension's own contexts; a missing or failing API is not fatal ──
{
  const levels = [];
  chrome.storage.local.setAccessLevel = async ({ accessLevel }) => { levels.push(['local', accessLevel]); };
  chrome.storage.sync.setAccessLevel = async ({ accessLevel }) => { levels.push(['sync', accessLevel]); };
  lockStorageToOwnerContexts();
  assert.deepEqual(levels, [['local', 'TRUSTED_CONTEXTS'], ['sync', 'TRUSTED_CONTEXTS']], 'grants and settings are not readable from a tab');

  chrome.storage.local.setAccessLevel = async () => { throw new Error('refused'); };
  delete chrome.storage.sync.setAccessLevel;
  lockStorageToOwnerContexts();
  await new Promise((r) => setImmediate(r)); // a rejection nobody handled would end this process
}

// ── TEST 6: every listener in the extension has decided who it trusts ──
{
  const background = read('background.js');
  assert.match(background, /chrome\.runtime\.onMessage\.addListener\(ownerMessagesOnly\(/, 'the service worker answers only the owner\'s pages');
  assert.match(background, /chrome\.runtime\.onConnect\.addListener\(ownerPortsOnly\(/, 'and accepts ports only from them');
  assert.match(background, /^lockStorageToOwnerContexts\(\);$/m, 'and locks storage at start-up');

  // A new listener must be a conscious decision. These are the only ones, and why.
  const expected = {
    'background.js': 'wrapped (checked above)',
    'pages/offscreen.js': 'refuses anything that came from a tab (checked below)',
    'lib/takeover.js': 'is handed the help overlay\'s own "done" message by a script in the tab; it can only end that overlay',
    'lib/approval-notify.js': 'answers only the in-page approval dialog it injected: same extension, tab, top frame, document and origin, plus that dialog\'s one-time nonce (approval_notify.test.js)',
  };
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!['test', 'node_modules', 'scripts'].includes(entry.name)) walk(rel); continue; }
      if (entry.name.endsWith('.js') && /chrome\.runtime\.onMessage\.addListener\(/.test(read(rel))) found.push(rel);
    }
  };
  walk('');
  assert.deepEqual(found.sort(), Object.keys(expected).sort(), 'a new chrome.runtime.onMessage listener needs a trust decision; add it above with the reason');
}

// ── TEST 7: the offscreen page (it can read the clipboard) does not answer a script in a tab ──
{
  let listener;
  let clipboardReads = 0;
  const sandbox = {
    chrome: {
      runtime: {
        id: ID,
        connect: () => ({ onDisconnect: { addListener() {} }, postMessage() {} }),
        sendMessage: async () => {},
        onMessage: { addListener: (fn) => { listener = fn; } },
      },
    },
    navigator: { clipboard: { readText: async () => { clipboardReads += 1; return 'a password the user just copied'; } } },
    setInterval: () => 0,
    setTimeout: () => 0,
    console,
  };
  vm.runInNewContext(read('pages/offscreen.js'), sandbox);
  assert.equal(typeof listener, 'function', 'the page registered its listener');

  const answers = [];
  const respond = (r) => answers.push(r);
  assert.equal(listener({ type: 'clipboard-read' }, outsiders.scriptInjectedIntoATab, respond), false, 'refused');
  assert.equal(listener({ type: 'clipboard-read' }, { id: 'someone-else' }, respond), false, 'another extension is not the service worker either');
  assert.equal(listener({ type: 'clipboard-read' }, undefined, respond), false);
  assert.equal(clipboardReads, 0, 'the clipboard was never touched');
  assert.equal(answers.length, 0, 'and nothing was said');

  assert.equal(listener({ type: 'clipboard-read' }, owners.serviceWorker, respond), true, 'the service worker still gets its answer');
  await new Promise((r) => setImmediate(r));
  assert.equal(clipboardReads, 1);
  assert.equal(answers[0].text, 'a password the user just copied');
}

console.log('[test] owner_pages.test.js: ALL ASSERTIONS PASSED (a script in a tab cannot drive the extension)');
