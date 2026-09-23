// Regression test for web_screenshot against a tab that is not the active/focused one.
//
// chrome.tabs.captureVisibleTab always captures whichever tab is CURRENTLY foreground in the
// target window — a background tabId does not steer it there on its own. execWebScreenshot
// (web-screenshot.js) handles this by bringing the requested tab and its window to the front
// FIRST when either isn't already true, and skipping that step (the common case) when the tab is
// already active/focused/non-minimized. Chosen behaviour: auto-focus, not a fast failure — see the
// comment in web-screenshot.js. This test pins both halves of that: the tab that needs it gets
// activated before capture, and the tab that doesn't skips the extra round trip entirely.
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

// --- Part 1: a background tab (not active, or its window not focused/minimized) gets activated first ---
{
  const callOrder = [];
  const chromeMock = createChromeMock();

  let tabActive = false;
  chromeMock.tabs.get = (id) => Promise.resolve({
    id: Number(id),
    windowId: 9,
    url: 'http://localhost:4321/',
    title: 'Local Dev',
    status: 'complete',
    active: tabActive,
  });
  chromeMock.windows = {
    get: (id) => { assert.equal(id, 9); return Promise.resolve({ id: 9, focused: false, state: 'normal' }); },
    update: (id, opts) => {
      assert.equal(id, 9);
      assert.equal(opts.focused, true, 'must ask for OS-level window focus, which captureVisibleTab requires');
      callOrder.push('window-focused');
      return Promise.resolve({});
    },
  };
  chromeMock.tabs.update = (id, opts) => {
    assert.equal(id, 219239893);
    assert.equal(opts.active, true);
    callOrder.push('tab-activated');
    tabActive = true; // the mock's own chrome.tabs.get now reflects the activation, like the real API
    return Promise.resolve({});
  };
  chromeMock.tabs.captureVisibleTab = async (windowId) => {
    callOrder.push('capture');
    assert.equal(windowId, 9, 'must capture the activated tab\'s window');
    assert.ok(callOrder.indexOf('tab-activated') < callOrder.indexOf('capture'), 'capture must happen after activation, not before');
    assert.ok(callOrder.indexOf('window-focused') < callOrder.indexOf('capture'), 'capture must happen after the window is focused, not before');
    return 'data:image/jpeg;base64,ACTIVATED_TAB_FRAME';
  };
  chromeMock.scripting = { executeScript: async () => [{ result: true }] };
  globalThis.chrome = chromeMock;

  const { execWebScreenshot } = await import('../lib/web-screenshot.js');
  const res = await execWebScreenshot({ tabId: 219239893 });

  assert.equal(res.ok, true, 'execWebScreenshot should succeed: ' + JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,ACTIVATED_TAB_FRAME');
  assert.equal(res.data.activatedTab, true, 'the response must say the tab needed activating, so a caller can tell this happened');
  assert.deepEqual(callOrder, ['tab-activated', 'window-focused', 'capture']);

  console.log('[test] web_screenshot_focus.test.js: a background tab is activated before capture — PASSED');
}

// --- Part 2: a tab that is already active in a focused, non-minimized window skips activation entirely ---
{
  const chromeMock = createChromeMock();
  let updateCalled = false;
  let windowsUpdateCalled = false;

  chromeMock.tabs.get = (id) => Promise.resolve({
    id: Number(id), windowId: 3, url: 'https://citytourinbarcelona.com/', title: 'City Tour', status: 'complete', active: true,
  });
  chromeMock.windows = {
    get: () => Promise.resolve({ id: 3, focused: true, state: 'normal' }),
    update: () => { windowsUpdateCalled = true; return Promise.resolve({}); },
  };
  chromeMock.tabs.update = () => { updateCalled = true; return Promise.resolve({}); };
  chromeMock.tabs.captureVisibleTab = async (windowId) => {
    assert.equal(windowId, 3);
    return 'data:image/jpeg;base64,ALREADY_VISIBLE_FRAME';
  };
  chromeMock.scripting = { executeScript: async () => [{ result: true }] };
  globalThis.chrome = chromeMock;

  const { execWebScreenshot } = await import('../lib/web-screenshot.js'); // same module: it holds no state between calls
  const res = await execWebScreenshot({ tabId: 219239893 });

  assert.equal(res.ok, true, 'execWebScreenshot should succeed: ' + JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,ALREADY_VISIBLE_FRAME');
  assert.equal(res.data.activatedTab, undefined, 'an already-visible tab must not be reported as activated');
  assert.equal(updateCalled, false, 'an already-active tab must not need chrome.tabs.update');
  assert.equal(windowsUpdateCalled, false, 'an already-focused window must not need chrome.windows.update');

  console.log('[test] web_screenshot_focus.test.js: an already-active/focused tab skips activation — PASSED');
}

console.log('[test] web_screenshot_focus.test.js: ALL ASSERTIONS PASSED');
