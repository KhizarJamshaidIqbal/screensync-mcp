// web_screenshot must say what its pixels show (both seen live 2026-09-29, two agent sessions sharing one window):
//   A. Another session navigated the tab while web_screenshot {tabId, background:true} was capturing it. The image was
//      the new page, but url/title named the old one: they were read before the capture and reported after it.
//      Now url/title are read AFTER the pixels are taken, and a url that changed during the call adds
//      navigatedDuringCapture {before, after}, degraded:true and a warning. The image is still returned.
//   B. After web_scroll_to, a plain web_screenshot of a hidden/covered window returned the PRE-scroll frame twice with
//      ok:true: requestAnimationFrame does not run there, the paint wait ran out silently, and captureVisibleTab
//      handed back the last composited frame. Now the capture says paintConfirmed:false, degraded:true and why.
//   C. captureVisibleTab captures whichever tab its window shows at that moment. When another session switched tab
//      after the paint wait, or closed this one (Chrome then shows a neighbour), the default path used to label the
//      other tab's pixels with this tab's url. A tab that is no longer shown is now captured through CDP instead, and
//      a tab that can no longer be read is flagged degraded.
// The happy path (a visible page that paints, a url that does not change) is unchanged apart from paintConfirmed:true,
// and so is a page that cannot be scripted (paintCheck:'unavailable', not degraded: no retry could clear it).
import assert from 'node:assert/strict';
import { createChromeMock } from './harness.js';

const X = { url: 'https://privatetour.example/tours/', title: 'Private tours' };
const Y = { url: 'https://booking.example/checkout', title: 'Checkout' };
const WINDOWS = { 1: { id: 1, focused: true, state: 'normal' }, 2: { id: 2, focused: false, state: 'normal' } };

let calls;
let state; // per-scenario behaviour
function install(over = {}) {
  calls = [];
  state = { navigated: false, navigateOn: null, paint: 'painted', visibility: 'visible', captureThrows: false, cdpFails: false,
    switched: false, moved: false, closed: false, onCapture: null, ...over };
  const chromeMock = createChromeMock();
  // Tab 5 is the active tab of the focused window, tab 6 the active tab of a window that is not focused.
  // switched: another tab of window 1 is in front now; moved: tab 5 was dragged into window 2; closed: tab 5 is gone.
  const tabOf = (id) => ({
    id, windowId: id === 5 && !state.moved ? 1 : 2, active: !(id === 5 && state.switched), status: 'complete', ...(state.navigated ? Y : X),
  });
  chromeMock.tabs.get = async (id) => {
    calls.push(['tabs.get', Number(id)]);
    if (state.closed && Number(id) === 5) throw new Error('No tab with id: 5.');
    return tabOf(Number(id));
  };
  chromeMock.tabs.update = async (id, props) => { calls.push(['tabs.update', id, props]); return {}; };
  chromeMock.windows = {
    get: async (id) => ({ ...WINDOWS[Number(id)] }),
    update: async (id, props) => { calls.push(['windows.update', id, props]); return {}; },
  };
  chromeMock.tabs.captureVisibleTab = async (windowId) => {
    calls.push(['captureVisibleTab', windowId]);
    if (state.captureThrows) throw new Error('Cannot access contents of the page.');
    if (state.navigateOn === 'captureVisibleTab') state.navigated = true; // the other session navigates meanwhile
    if (state.onCapture) { state.onCapture(state); return 'data:image/jpeg;base64,TAB9_PIXELS'; } // the window shows another tab
    return 'data:image/jpeg;base64,WINDOW_FRAME';
  };
  chromeMock.scripting = {
    executeScript: async ({ func }) => {
      const src = func.toString();
      if (/requestAnimationFrame/.test(src)) {
        calls.push(['paint-wait']);
        if (state.paint === 'never') return new Promise(() => {}); // hidden window: rAF never runs
        if (state.paint === 'refused') throw new Error('Cannot access a chrome-error:// URL');
        return [{ result: { painted: true, visibility: 'visible' } }];
      }
      if (/visibilityState/.test(src)) {
        calls.push(['visibility-probe']);
        return [{ result: state.visibility }];
      }
      throw new Error(`unexpected injected function: ${src.slice(0, 80)}`);
    },
  };
  chromeMock.debugger = {
    attach: async (target) => {
      calls.push(['debugger.attach', target.tabId]);
      if (state.cdpFails) throw new Error('Cannot attach to this target.');
    },
    detach: async (target) => { calls.push(['debugger.detach', target.tabId]); },
    sendCommand: async (target, method, params = {}) => {
      if (method === 'Runtime.evaluate') return { result: { value: true } };
      if (method === 'Page.captureScreenshot') {
        calls.push(['Page.captureScreenshot', target.tabId, params]);
        if (state.navigateOn === 'Page.captureScreenshot') state.navigated = true;
        return { data: `TAB_${target.tabId}_PIXELS` };
      }
      return {};
    },
  };
  globalThis.chrome = chromeMock;
}
const names = () => calls.map((c) => c[0]);

install(); // modules read chrome.* at import time
const { execWebScreenshot, PAINT_WAIT_MS } = await import('../lib/web-screenshot.js');
const { waitForPaintReady } = await import('../lib/tab-resolve.js');

// ── happy path: unchanged apart from paintConfirmed ────────────────────────────────────────────────
{
  install();
  const t0 = Date.now();
  const res = await execWebScreenshot({ tabId: 5 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,WINDOW_FRAME');
  assert.equal(res.data.url, X.url);
  assert.equal(res.data.title, X.title);
  assert.equal(res.data.format, 'jpeg');
  assert.equal(res.data.paintConfirmed, true);
  for (const k of ['degraded', 'warning', 'navigatedDuringCapture', 'activatedTab', 'via']) assert.equal(res.data[k], undefined, k);
  assert.deepEqual(names().filter((n) => n !== 'tabs.get'), ['paint-wait', 'captureVisibleTab'], 'one paint wait, no probe, then the capture');
  assert.ok(Date.now() - t0 < 200, 'a page that paints is not slowed down');
  console.log('[test] web_screenshot_truth: happy path unchanged, paintConfirmed:true - PASSED');
}
{
  install();
  const res = await execWebScreenshot({ tabId: 6, background: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.via, 'cdp');
  assert.equal(res.data.url, X.url);
  assert.equal(res.data.paintConfirmed, undefined, 'a CDP capture renders its own frame: no paint claim either way');
  assert.equal(res.data.degraded, undefined);
  console.log('[test] web_screenshot_truth: background CDP happy path carries no degraded flag - PASSED');
}

// ── A: a navigation during the capture ─────────────────────────────────────────────────────────────
function assertNavigated(res, label) {
  assert.equal(res.ok, true, `${label}: ${JSON.stringify(res)}`);
  assert.ok(res.data.imageDataUrl, `${label}: the image is still returned`);
  assert.equal(res.data.url, Y.url, `${label}: url names the page at the moment of capture`);
  assert.equal(res.data.title, Y.title, label);
  assert.deepEqual(res.data.navigatedDuringCapture, { before: X.url, after: Y.url }, label);
  assert.equal(res.data.degraded, true, label);
  assert.match(res.data.warning, /navigated while it was being captured/, label);
  assert.ok(res.data.warning.includes(X.url) && res.data.warning.includes(Y.url), `${label}: the warning names both pages`);
}
{
  install({ navigateOn: 'captureVisibleTab' });
  const res = await execWebScreenshot({ tabId: 5 });
  assertNavigated(res, 'default path');
  assert.equal(res.data.paintConfirmed, true, 'the paint itself was fine');
  assert.ok(names().lastIndexOf('tabs.get') > names().indexOf('captureVisibleTab'), 'the tab is re-read after the pixels');
  console.log('[test] web_screenshot_truth: default path, navigation mid-capture -> post-capture url + navigatedDuringCapture - PASSED');
}
{
  install({ navigateOn: 'Page.captureScreenshot' });
  const res = await execWebScreenshot({ tabId: 6, background: true });
  assertNavigated(res, 'background CDP path');
  assert.equal(res.data.via, 'cdp');
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,TAB_6_PIXELS');
  console.log('[test] web_screenshot_truth: background CDP path, navigation mid-capture -> post-capture url + navigatedDuringCapture - PASSED');
}
{
  install({ navigateOn: 'captureVisibleTab' });
  const res = await execWebScreenshot({ tabId: 5, background: true });
  assertNavigated(res, 'background front-tab path');
  assert.equal(res.data.via, undefined);
  console.log('[test] web_screenshot_truth: background front-tab path, navigation mid-capture -> flagged - PASSED');
}
{
  // The default path's CDP fallback (captureVisibleTab refused) also reports the post-capture page, and it is a
  // viewport capture: web_full_screenshot would otherwise capture the whole document.
  install({ captureThrows: true, navigateOn: 'Page.captureScreenshot' });
  const res = await execWebScreenshot({ tabId: 5 });
  assertNavigated(res, 'default CDP fallback');
  assert.equal(res.data.via, 'cdp_fallback');
  const shot = calls.find((c) => c[0] === 'Page.captureScreenshot');
  assert.equal(shot[2].captureBeyondViewport, false, 'the fallback is the viewport, not the full page');
  console.log('[test] web_screenshot_truth: default CDP fallback -> viewport, post-capture url - PASSED');
}

// ── B: a frame that was never repainted ────────────────────────────────────────────────────────────
{
  install({ paint: 'never', visibility: 'hidden' });
  const t0 = Date.now();
  const res = await execWebScreenshot({ tabId: 5 });
  const took = Date.now() - t0;
  assert.equal(res.ok, true, 'an unconfirmed paint does not fail the call: ' + JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,WINDOW_FRAME', 'the frame is still returned');
  assert.equal(res.data.paintConfirmed, false);
  assert.equal(res.data.degraded, true);
  assert.match(res.data.warning, /without a freshly painted frame/);
  assert.match(res.data.warning, /visibilityState 'hidden'/);
  assert.match(res.data.warning, /background: true/, 'the default path suggests the CDP capture');
  assert.equal(res.data.navigatedDuringCapture, undefined);
  assert.equal(res.data.url, X.url);
  assert.deepEqual(names().filter((n) => n !== 'tabs.get'), ['paint-wait', 'visibility-probe', 'captureVisibleTab']);
  assert.ok(took >= PAINT_WAIT_MS - 50 && took < PAINT_WAIT_MS + 600, `bounded by the paint wait (took ${took} ms)`);
  console.log('[test] web_screenshot_truth: hidden window, paint never confirmed -> paintConfirmed:false + warning - PASSED');
}
{
  install({ paint: 'never', visibility: 'hidden' });
  const res = await execWebScreenshot({ tabId: 5, background: true });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.paintConfirmed, false);
  assert.equal(res.data.degraded, true);
  assert.match(res.data.warning, /Bring the browser window to the front/);
  assert.doesNotMatch(res.data.warning, /background: true/, 'background mode does not suggest itself');
  console.log('[test] web_screenshot_truth: background front tab, paint never confirmed -> flagged - PASSED');
}
for (const background of [false, true]) {
  // A visible page that can be captured but not scripted (a network error page keeps its https url; the Web Store):
  // the paint check can never run there, so it is reported but does not make every capture of it degraded.
  install({ paint: 'refused' });
  const res = await execWebScreenshot({ tabId: 5, ...(background ? { background: true } : {}) });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,WINDOW_FRAME');
  assert.equal(res.data.paintConfirmed, false);
  assert.equal(res.data.paintCheck, 'unavailable');
  for (const k of ['degraded', 'warning', 'navigatedDuringCapture', 'via']) assert.equal(res.data[k], undefined, `${k} (background ${background})`);
  assert.ok(!names().includes('visibility-probe'), 'no probe when the page cannot be scripted at all');
  console.log(`[test] web_screenshot_truth: paint check refused${background ? ' (background)' : ''} -> paintCheck:'unavailable', not degraded - PASSED`);
}
{
  // Both at once: one warning carrying both reasons.
  install({ paint: 'never', visibility: 'hidden', navigateOn: 'captureVisibleTab' });
  const res = await execWebScreenshot({ tabId: 5 });
  assertNavigated(res, 'both');
  assert.equal(res.data.paintConfirmed, false);
  assert.match(res.data.warning, /navigated.*without a freshly painted frame/s);
  console.log('[test] web_screenshot_truth: navigation and unpainted frame together -> both reported - PASSED');
}

// ── C: the tab stopped being the one its window shows ──────────────────────────────────────────────
for (const [label, change] of [['switched', (s) => { s.switched = true; }], ['moved', (s) => { s.moved = true; }]]) {
  // The window frame is another tab's: it is thrown away and this tab is captured through CDP.
  install({ onCapture: change });
  const res = await execWebScreenshot({ tabId: 5 });
  assert.equal(res.ok, true, `${label}: ${JSON.stringify(res)}`);
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,TAB_5_PIXELS', `${label}: the other tab's frame is never returned`);
  assert.equal(res.data.via, 'cdp_fallback', label);
  assert.equal(res.data.url, X.url, label);
  assert.equal(res.data.degraded, undefined, `${label}: a CDP capture of the right tab is clean`);
  assert.ok(names().indexOf('Page.captureScreenshot') > names().indexOf('captureVisibleTab'), label);
  console.log(`[test] web_screenshot_truth: tab ${label} during the capture -> window frame dropped, CDP capture - PASSED`);
}
{
  // And when CDP cannot capture it either, the call fails and says why, instead of returning another tab's pixels.
  install({ onCapture: (s) => { s.switched = true; }, cdpFails: true });
  const res = await execWebScreenshot({ tabId: 5 });
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.match(res.error, /was no longer the tab its window showed.*CDP fallback failed: .*Cannot attach to this target/s);
  console.log('[test] web_screenshot_truth: tab switched and CDP refused -> error, no mislabelled image - PASSED');
}
{
  // Closed during the capture: nothing can be captured any more, so the frame is kept but flagged.
  install({ onCapture: (s) => { s.closed = true; } });
  const res = await execWebScreenshot({ tabId: 5 });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.imageDataUrl, 'data:image/jpeg;base64,TAB9_PIXELS');
  assert.equal(res.data.url, X.url, 'url and title are the last ones known');
  assert.equal(res.data.degraded, true);
  assert.match(res.data.warning, /could not be read again after the capture .*may show another tab/);
  assert.equal(res.data.paintConfirmed, true, 'the paint itself was fine');
  assert.ok(!names().includes('Page.captureScreenshot'), 'a closed tab is not sent to CDP');
  console.log('[test] web_screenshot_truth: tab closed during the capture -> degraded + warning - PASSED');
}

// ── waitForPaintReady reports what happened, and stays compatible ─────────────────────────────────
{
  install();
  assert.deepEqual(await waitForPaintReady(5), { painted: true, visibility: 'visible' });
  chrome.scripting.executeScript = async () => [{ result: true }]; // the pre-2026-09-29 in-page result
  assert.deepEqual(await waitForPaintReady(5), { painted: true });
  chrome.scripting.executeScript = async () => [];
  assert.equal((await waitForPaintReady(5)).painted, false, 'no injection result is no confirmation');
  install({ paint: 'never', visibility: 'visible' });
  const t0 = Date.now();
  assert.deepEqual(await waitForPaintReady(5, 150), { painted: false, reason: 'timeout', visibility: 'visible' });
  assert.ok(Date.now() - t0 < 600, 'bounded');
  install({ paint: 'never' });
  chrome.scripting.executeScript = ({ func }) => new Promise(() => { void func; }); // not even the probe answers
  const t1 = Date.now();
  assert.deepEqual(await waitForPaintReady(5, 150), { painted: false, reason: 'timeout' });
  assert.ok(Date.now() - t1 < 800, 'the visibility probe is bounded too');
  console.log('[test] web_screenshot_truth: waitForPaintReady reports painted/timeout/visibility - PASSED');
}

console.log('[test] web_screenshot_truth.test.js: ALL ASSERTIONS PASSED');
