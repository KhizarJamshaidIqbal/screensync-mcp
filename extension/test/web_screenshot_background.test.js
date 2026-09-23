// web_screenshot {tabId, background: true}: capture a tab while the person is using the browser (seen live
// 2026-09-23 on the agent window, which was not focused: the old capture either timed out after the hub's 45 s or
// returned the pixels of whatever was on screen, which was the person's own page). chrome.tabs.captureVisibleTab
// captures what the WINDOW shows on screen, so in background mode it is only used for the active tab of the focused
// window. Any other tab is captured with CDP Page.captureScreenshot (attach, capture, detach), nothing is activated
// or focused, and when CDP cannot do it the call fails fast with CAPTURE_UNAVAILABLE instead of handing back another
// page. Without background the default is unchanged: the tab is brought to the front first (web_screenshot_focus).
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

const TABS = {
  7: { id: 7, windowId: 1, active: true, url: 'https://person.example/inbox', title: 'Person inbox', status: 'complete' },
  9: { id: 9, windowId: 2, active: true, url: 'https://cbm.example/wp-admin/admin.php?page=cbm-index', title: 'Index insights', status: 'complete' },
  11: { id: 11, windowId: 1, active: false, url: 'https://cbm.example/wp-admin/admin.php?page=cbm-posts', title: 'Posts', status: 'complete' },
};
const WINDOWS = { 1: { id: 1, focused: true, state: 'normal' }, 2: { id: 2, focused: false, state: 'normal' } };

let calls;
let cdp; // per-scenario CDP behaviour
function install() {
  calls = [];
  const chromeMock = createChromeMock();
  chromeMock.tabs.get = async (id) => ({ ...TABS[Number(id)] });
  chromeMock.tabs.update = async (id, props) => { calls.push(['tabs.update', id, props]); return {}; };
  chromeMock.windows = {
    get: async (id) => ({ ...WINDOWS[Number(id)] }),
    update: async (id, props) => { calls.push(['windows.update', id, props]); return {}; },
  };
  chromeMock.tabs.captureVisibleTab = async (windowId) => {
    calls.push(['captureVisibleTab', windowId]);
    return windowId === 1 ? 'data:image/jpeg;base64,PERSON_SCREEN' : 'data:image/jpeg;base64,WHATEVER_IS_ON_SCREEN';
  };
  chromeMock.scripting = { executeScript: async () => { calls.push(['paint-wait']); return [{ result: true }]; } };
  chromeMock.debugger = {
    attach: async (target) => {
      calls.push(['debugger.attach', target.tabId]);
      if (cdp.attachError) throw new Error(cdp.attachError);
    },
    detach: async (target) => { calls.push(['debugger.detach', target.tabId]); },
    sendCommand: async (target, method, params = {}) => {
      if (cdp.sendError) throw new Error(cdp.sendError);
      if (method === 'Runtime.evaluate') {
        // A hidden tab never fires requestAnimationFrame: the paint wait must not depend on it.
        assert.match(params.expression, /visibilityState === 'hidden'/, 'the CDP paint wait must skip hidden pages');
        return new Promise(() => {});
      }
      if (method === 'Page.captureScreenshot') {
        calls.push(['Page.captureScreenshot', target.tabId, params]);
        if (cdp.hang) return new Promise(() => {});
        return { data: `TAB_${target.tabId}_PIXELS` };
      }
      return {};
    },
  };
  globalThis.chrome = chromeMock;
}
const names = () => calls.map((c) => c[0]);

install(); cdp = {}; // modules read chrome.* at import time
const { execWebScreenshot } = await import('../lib/web-screenshot.js');
const { CDP_PAINT_WAIT_MS } = await import('../lib/web-adv-core.js');

// 0. Without background the default is unchanged: a tab in a window that is not focused is brought to the front
//    (tab activated, window focused) and captured with captureVisibleTab. No CDP.
{
  install(); cdp = {};
  const res = await execWebScreenshot({ tabId: 9 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.activatedTab, true, 'the default still reports the activation');
  assert.equal(res.data.via, undefined);
  assert.deepEqual(names(), ['tabs.update', 'windows.update', 'paint-wait', 'captureVisibleTab'], 'the default focuses, then captures');
  assert.deepEqual(calls[1], ['windows.update', 2, { focused: true }]);
  assert.ok(!names().some((n) => n.startsWith('debugger.')), 'the default does not go through CDP when the capture works');
  console.log('[test] web_screenshot_background: default (no background) still focuses the tab - PASSED');
}

// 1. The active tab of the focused window: captureVisibleTab, unchanged. No CDP, nothing focused.
{
  install(); cdp = {};
  const res = await execWebScreenshot({ tabId: 7, background: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,PERSON_SCREEN');
  assert.equal(res.data.via, undefined);
  assert.deepEqual(names(), ['paint-wait', 'captureVisibleTab']);
  console.log('[test] web_screenshot_background: background:true, front tab -> captureVisibleTab - PASSED');
}

// 2. The active tab of a window that is NOT focused (the agent window behind the person's): CDP, no focus change,
//    and never captureVisibleTab, which would have returned the person's screen.
{
  install(); cdp = {};
  const t0 = Date.now();
  const res = await execWebScreenshot({ tabId: 9, format: 'png', background: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/png;base64,TAB_9_PIXELS');
  assert.equal(res.data.via, 'cdp');
  assert.equal(res.data.url, TABS[9].url);
  assert.ok(!names().includes('captureVisibleTab'), 'captureVisibleTab must not run for a tab that is not in front');
  assert.ok(!names().includes('windows.update') && !names().includes('tabs.update'), 'nothing may be activated or focused');
  const shot = calls.find((c) => c[0] === 'Page.captureScreenshot');
  assert.equal(shot[2].captureBeyondViewport, false, 'web_screenshot is the viewport, not the full page');
  assert.deepEqual(names().filter((n) => n.startsWith('debugger.')), ['debugger.attach', 'debugger.detach'], 'attach, capture, detach');
  assert.ok(Date.now() - t0 < CDP_PAINT_WAIT_MS + 500, 'a paint wait that never settles is bounded');
  console.log('[test] web_screenshot_background: background:true, unfocused window -> CDP, no focus change - PASSED');
}

// 3. A background tab of the focused window: CDP too.
{
  install(); cdp = {};
  const res = await execWebScreenshot({ tabId: 11, background: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,TAB_11_PIXELS');
  assert.ok(!names().includes('captureVisibleTab'));
  console.log('[test] web_screenshot_background: background:true, background tab -> CDP - PASSED');
}

// 4. CDP refused: a clear error at once, never another page's pixels. Both ways Chrome refuses: the attach
//    itself fails, or DevTools already holds the tab ("already attached" is tolerated by rawAttach, because the
//    extension may hold it itself, and then the first command fails).
for (const [label, behaviour, pattern] of [
  ['attach refused', { attachError: 'Cannot attach to this target.' }, /Cannot attach/],
  ['DevTools holds the tab', { attachError: 'Another debugger is already attached to the tab with id: 9.', sendError: 'Debugger is not attached to the tab with id: 9.' }, /not attached/],
]) {
  install(); cdp = behaviour;
  const t0 = Date.now();
  const res = await execWebScreenshot({ tabId: 9, background: true });
  assert.equal(res.ok, false, label);
  assert.equal(res.code, 'CAPTURE_UNAVAILABLE', label);
  assert.equal(res.reason, 'cdp_failed', label);
  assert.equal(res.retryable, true, label);
  assert.equal(res.data, undefined, label);
  assert.match(res.error, pattern, label);
  assert.ok(!names().includes('captureVisibleTab'), 'no fallback to captureVisibleTab for a tab that is not in front');
  assert.ok(Date.now() - t0 < 1000, 'fails fast');
  console.log(`[test] web_screenshot_background: background:true, CDP refused (${label}) -> CAPTURE_UNAVAILABLE fast - PASSED`);
}

// 5. CDP never answers: bounded, detached, CAPTURE_UNAVAILABLE well before the hub's 45 s.
{
  install(); cdp = { hang: true };
  const t0 = Date.now();
  const res = await execWebScreenshot({ tabId: 9, background: true }, { cdpTimeoutMs: 1500 });
  const took = Date.now() - t0;
  assert.equal(res.ok, false);
  assert.equal(res.code, 'CAPTURE_UNAVAILABLE');
  assert.equal(res.reason, 'cdp_timeout');
  assert.ok(took >= 1400 && took < 3000, `bounded by the CDP timeout (took ${took} ms)`);
  assert.ok(names().includes('debugger.detach'), 'a hung capture must not keep the debugger attached');
  assert.ok(!names().includes('captureVisibleTab'));
  console.log('[test] web_screenshot_background: background:true, CDP hangs -> bounded CAPTURE_UNAVAILABLE - PASSED');
}

// 6. The front tab left the front while it was being captured: those pixels are dropped, CDP takes the tab.
{
  install(); cdp = {};
  let first = true;
  chrome.tabs.get = async (id) => {
    const t = { ...TABS[Number(id)] };
    if (Number(id) === 7 && !first) t.active = false; // the person switched tab during the capture
    first = false;
    return t;
  };
  const res = await execWebScreenshot({ tabId: 7, background: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,TAB_7_PIXELS');
  assert.equal(res.data.via, 'cdp_fallback');
  console.log('[test] web_screenshot_background: background:true, tab switched mid-capture -> screen pixels dropped - PASSED');
}

// 7. The shared CDP paint wait (cdpWaitPaintReady) is bounded for every CDP capture, not only web_screenshot:
//    web_element_screenshot of a hidden tab whose requestAnimationFrame never fires still answers.
{
  install(); cdp = {};
  chrome.scripting = { executeScript: async () => [{ result: { ok: true, data: { x: 1, y: 2, width: 30, height: 10 } } }] };
  const { cdpElementScreenshot } = await import('../lib/web-element-screenshot.js');
  const t0 = Date.now();
  const res = await cdpElementScreenshot({ id: 11, url: TABS[11].url }, { selector: 'h1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(Date.now() - t0 < CDP_PAINT_WAIT_MS + 500, 'the element capture is not held by a paint wait that never settles');
  console.log('[test] web_screenshot_background: shared CDP paint wait is bounded for web_element_screenshot - PASSED');
}

console.log('[test] web_screenshot_background.test.js: ALL ASSERTIONS PASSED');
