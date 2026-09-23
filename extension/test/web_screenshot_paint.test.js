// Regression test for the post-navigation paint/compositor race (Bug: a web_screenshot taken
// immediately after web_navigate reports status:'complete' could capture a frame from before the
// compositor had painted decoded <img> elements, showing every image as a flat grey/blank rect
// even though the DOM/network layer had already fully loaded and decoded them — confirmed live by
// running web_eval's `[...document.querySelectorAll('img')].map(...)` on the same page and seeing
// `complete: true` + real naturalWidth/naturalHeight for every image right after the blank
// screenshot). Both capture paths must now wait for an actual painted frame (two consecutive
// requestAnimationFrame callbacks — the standard guarantee that a paint has happened since the
// callback was scheduled) before taking the pixels:
//   1. execWebScreenshot (web-screenshot.js) -> chrome.tabs.captureVisibleTab, guarded by the
//      shared waitForPaintReady() helper (tab-resolve.js) via chrome.scripting.executeScript.
//   2. cdpScreenshot (web-adv-capture.js), the CDP fallback -> Page.captureScreenshot, guarded by
//      an equivalent double-rAF wait sent over the already-attached CDP session (Runtime.evaluate
//      with awaitPromise:true).
// Each mock below simulates a real async delay for the paint wait and asserts (inside the capture
// mock itself) that the wait already resolved — so if a future change removes the `await` on the
// paint-readiness call, this test fails with a clear message instead of silently regressing.
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

// --- Part 1: execWebScreenshot -> chrome.tabs.captureVisibleTab (web-screenshot.js) ---
{
  const callOrder = [];
  let paintWaited = false;

  const chromeMock = createChromeMock();
  chromeMock.tabs.get = (id) => Promise.resolve({
    id: Number(id),
    windowId: 1,
    url: 'https://citytourinbarcelona.com/explore-catalonia/',
    title: 'Explore Catalonia',
    status: 'complete',
    active: true,
  });
  chromeMock.windows = {
    get: () => Promise.resolve({ id: 1, focused: true, state: 'normal' }),
    update: () => Promise.resolve({}),
  };
  chromeMock.tabs.update = () => Promise.resolve({});
  chromeMock.tabs.captureVisibleTab = async () => {
    callOrder.push('capture');
    assert.equal(paintWaited, true, 'captureVisibleTab must not fire before the paint-readiness wait resolves');
    return 'data:image/jpeg;base64,PAINTED_FRAME';
  };
  chromeMock.scripting = {
    executeScript: async ({ func }) => {
      assert.match(func.toString(), /requestAnimationFrame/, 'expected the injected function to be the double-rAF paint wait');
      callOrder.push('paint-wait-start');
      // A genuine async delay: if production code stops `await`-ing waitForPaintReady(),
      // captureVisibleTab above runs before this resolves and its assertion fails.
      await new Promise((resolve) => setTimeout(resolve, 15));
      paintWaited = true;
      callOrder.push('paint-wait-done');
      return [{ result: true }];
    },
  };
  globalThis.chrome = chromeMock;

  const { execWebScreenshot } = await import('../lib/web-screenshot.js');
  const res = await execWebScreenshot({ tabId: 7 });

  assert.equal(res.ok, true, 'execWebScreenshot should succeed: ' + JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,PAINTED_FRAME');
  assert.deepEqual(
    callOrder,
    ['paint-wait-start', 'paint-wait-done', 'capture'],
    'the paint wait must fully resolve before chrome.tabs.captureVisibleTab is called'
  );

  console.log('[test] web_screenshot_paint.test.js: execWebScreenshot waits for paint before captureVisibleTab — PASSED');
}

// --- Part 2: cdpScreenshot -> Page.captureScreenshot (web-adv-capture.js, CDP fallback path) ---
{
  const cdpCallOrder = [];
  let cdpPaintWaited = false;

  globalThis.chrome.debugger = {
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (_target, method, params = {}) => {
      if (method === 'Target.setAutoAttach' || method === 'Page.setInterceptFileChooserDialog' || method === 'Page.enable') {
        return {};
      }
      if (method === 'Runtime.evaluate') {
        cdpCallOrder.push('runtime-evaluate-start');
        assert.match(params.expression || '', /requestAnimationFrame/, 'expected the CDP paint wait to use a double rAF expression');
        assert.equal(params.awaitPromise, true, 'Runtime.evaluate must set awaitPromise so the rAF chain is actually awaited');
        await new Promise((resolve) => setTimeout(resolve, 15));
        cdpPaintWaited = true;
        cdpCallOrder.push('runtime-evaluate-done');
        return { result: { value: true } };
      }
      if (method === 'Page.captureScreenshot') {
        cdpCallOrder.push('capture');
        assert.equal(cdpPaintWaited, true, 'Page.captureScreenshot must not fire before the CDP paint-readiness wait resolves');
        return { data: 'UEFJTlRFRA==' };
      }
      throw new Error('Unhandled chrome.debugger.sendCommand method: ' + method);
    },
  };

  const { cdpScreenshot } = await import('../lib/web-adv-capture.js');
  const tab = { id: 7, url: 'https://citytourinbarcelona.com/explore-catalonia/', title: 'Explore Catalonia' };
  const res = await cdpScreenshot(tab, { format: 'png' });

  assert.equal(res.ok, true, 'cdpScreenshot should succeed: ' + JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/png;base64,UEFJTlRFRA==');
  assert.deepEqual(
    cdpCallOrder,
    ['runtime-evaluate-start', 'runtime-evaluate-done', 'capture'],
    'the CDP paint wait must fully resolve before Page.captureScreenshot is called'
  );

  console.log('[test] web_screenshot_paint.test.js: cdpScreenshot waits for paint before Page.captureScreenshot — PASSED');
}

console.log('[test] web_screenshot_paint.test.js: ALL ASSERTIONS PASSED');
