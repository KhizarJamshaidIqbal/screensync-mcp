// ScreenSync web_screenshot executor — split out of web-tools.js (which sits at the repo's
// 500-line ceiling, see AGENTS.md §2) to fix background-tab captures without growing it further.
//
// Two modes:
//   - Default: a background tab is brought to the front (tab activated, window focused) and captured
//     with chrome.tabs.captureVisibleTab; a failed capture falls back to CDP (web_full_screenshot).
//   - background: true, for when the person is using the browser: nothing is activated or focused.
//     captureVisibleTab is used only for the active tab of the focused window, and only if that tab is
//     still in front after the capture. Any other tab is captured with CDP Page.captureScreenshot
//     (attach, capture, detach, viewport only). When CDP is refused or does not answer within 12 s the
//     call fails fast with CAPTURE_UNAVAILABLE and no image: captureVisibleTab returns what the WINDOW
//     shows on screen, so for a tab that is not in front it would hand back another page's pixels.
//
// Every image says what it shows (both seen live 2026-09-29, two agent sessions sharing one window):
//   - url/title are read AFTER the pixels are taken, so they name the page the tab showed at capture time.
//     They used to be read before, and a navigation by someone else mid-call labelled page X's pixels as
//     page Y. When the url changed during the call, navigatedDuringCapture { before, after } says so.
//   - paintConfirmed says whether the page painted a fresh frame before captureVisibleTab. A hidden or
//     covered window runs no requestAnimationFrame, and the capture returns the last composited frame (the
//     pre-scroll hero, twice, with nothing to say so). CDP captures render their own frame and omit it.
//     A page that cannot be scripted at all (an error page, the Web Store) cannot run the check either:
//     it reports paintConfirmed: false with paintCheck: 'unavailable', and that alone is not a doubt, since
//     no retry could ever clear it. Only a wait that ran out (reason 'timeout') is.
//   - captureVisibleTab returns whatever tab its window shows at that moment. When the requested tab is no
//     longer the one its window shows after the capture (another session switched tab, or moved it), the
//     window frame is thrown away and the tab is captured through CDP instead (via: 'cdp_fallback'). When the
//     tab cannot be read at all afterwards (closed: Chrome then shows a neighbour), the frame is kept but
//     flagged, because it may be the neighbour's.
//   - Any doubt adds degraded: true and a plain-language warning. The image is still returned and ok
//     stays true (web_visual_baseline, flows and fanout treat ok:false as a hard failure); the hub does not
//     count a degraded result as a clean success when it reflects on reliability.
import { execAdvTool } from './web-adv.js';
import { cdpScreenshot } from './web-adv-capture.js';
import { rawDetach } from './web-adv-core.js';
import { pickActiveTab, isRestrictedTab, waitForPaintReady } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';

/** How long the background CDP capture may take before the call gives up (well inside the hub's 45 s). */
export const CDP_CAPTURE_TIMEOUT_MS = 12000;
/** How long captureVisibleTab waits for a painted frame before it captures anyway (and says so). */
export const PAINT_WAIT_MS = 1000;

/**
 * @param {{ tabId?: number, format?: string, quality?: number, background?: boolean }} [args]
 * @param {{ cdpTimeoutMs?: number }} [opts] test seam for the background CDP bound
 */
export async function execWebScreenshot(args = {}, opts = {}) {
  const tab = await pickActiveTab(args);
  if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Cannot capture restricted tab (${tab.url}).`);
  const format = args.format === 'png' ? 'png' : 'jpeg';
  const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 85;
  if (args.background === true) {
    const cdpTimeoutMs = Number(opts.cdpTimeoutMs) > 0 ? Number(opts.cdpTimeoutMs) : CDP_CAPTURE_TIMEOUT_MS;
    return captureInBackground(tab, format, quality, cdpTimeoutMs);
  }
  return captureInFront(tab, format, quality);
}

async function captureInFront(tab, format, quality) {
  const opts = format === 'png' ? { format: 'png' } : { format: 'jpeg', quality };

  // chrome.tabs.captureVisibleTab always captures whichever tab is CURRENTLY foreground in the
  // target window — a background tabId does not steer it there, so it used to silently capture
  // the wrong tab (or a blank frame) while still reporting the REQUESTED tab's url/title. The
  // tool's own schema documents tabId as an "Optional background tab ID", so honor that by
  // bringing the requested tab and its window to the front first. Skip this when the tab is
  // already active/focused/non-minimized so the common (already-visible) path is unchanged.
  let captureTab = tab;
  let activatedTab = false;
  try {
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!tab.active || !win || !win.focused || win.state === 'minimized') {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, win && win.state === 'minimized' ? { focused: true, state: 'normal' } : { focused: true });
      activatedTab = true;
      captureTab = await chrome.tabs.get(tab.id).catch(() => tab);
    }
  } catch { /* best-effort activation — capture below still runs against the original tab */ }

  // Guard against the paint/compositor race: right after web_navigate reports status:'complete'
  // (load event fired), the compositor can still be a frame or two behind, so capturing
  // immediately can return every <img> as a flat grey/blank rect even though the DOM/network
  // layer already finished loading and decoding them. Two rAFs is cheap (~tens of ms) on an
  // already-settled page, so do this unconditionally rather than only right after navigation.
  // A wait that runs out (hidden or covered window) no longer passes silently: see describeCapture.
  const paint = await waitForPaintReady(captureTab.id, PAINT_WAIT_MS);

  let captureErr = '';
  try {
    const imageDataUrl = await chrome.tabs.captureVisibleTab(captureTab.windowId, opts);
    // The window's CURRENT tab was captured. Keep the pixels only if that is still this tab: another session may
    // have switched tab after the paint wait. A tab that cannot be read (closed) is kept, flagged by describeCapture.
    const after = await readTab(captureTab.id);
    if (!after || isShownIn(after, captureTab.windowId)) {
      return { ok: true, data: describeCapture(tab, after, { imageDataUrl, format, ...(activatedTab ? { activatedTab: true } : {}) }, { fallback: captureTab, paint, windowCapture: true }) };
    }
    captureErr = `tab ${captureTab.id} was no longer the tab its window showed when the pixels were taken, so they showed another tab`;
  } catch (err) {
    captureErr = String((err && err.message) || err);
  }
  // fullPage: false - web_full_screenshot captures the whole document unless told otherwise, and this is
  // a viewport screenshot.
  const cdpRes = await execAdvTool('web_full_screenshot', captureTab, { format, quality: opts.quality, fullPage: false })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  if (cdpRes && cdpRes.ok && cdpRes.data && cdpRes.data.imageDataUrl) {
    const after = await readTab(captureTab.id);
    return { ok: true, data: describeCapture(tab, after, { imageDataUrl: cdpRes.data.imageDataUrl, via: 'cdp_fallback', format }, { fallback: captureTab }) };
  }
  // Both capture paths failed — surface both errors instead of only the first
  // (captureVisibleTab's), which used to hide the CDP fallback's real cause.
  const cdpErr = cdpRes && cdpRes.error ? String(cdpRes.error) : 'no CDP fallback result';
  return makeError(ERROR_CODES.INTERNAL, `captureVisibleTab failed: ${captureErr}; CDP fallback failed: ${cdpErr}`);
}

/** True when captureVisibleTab(windowId) returns THIS tab: it is the active tab of that window. Focus does not matter. */
function isShownIn(tab, windowId) {
  return Boolean(tab && tab.active && tab.windowId === windowId);
}

/** True only when captureVisibleTab would return THIS tab: active in its window, and that window focused. */
export async function isFrontTab(tab) {
  if (!tab || !tab.active || tab.windowId == null) return false;
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  return Boolean(win && win.focused && win.state !== 'minimized');
}

async function captureViaCdp(tab, format, quality, timeoutMs) {
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs); });
  const res = await Promise.race([
    cdpScreenshot(tab, { fullPage: false, format, quality }).catch((e) => ({ ok: false, error: String((e && e.message) || e) })),
    expired,
  ]);
  clearTimeout(timer);
  // A capture that never answered must not leave the debugger attached to the tab.
  if (res && res.timedOut) await rawDetach({ tabId: tab.id }).catch(() => {});
  return res;
}

async function captureInBackground(tab, format, quality, cdpTimeoutMs) {
  const front = await isFrontTab(tab);
  let visibleErr = '';
  if (front) {
    // Compositor race: wait for a painted frame before reading pixels (tab-resolve.js waitForPaintReady).
    const paint = await waitForPaintReady(tab.id, PAINT_WAIT_MS);
    try {
      const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, format === 'png' ? { format: 'png' } : { format: 'jpeg', quality });
      // The person may have switched tab or window meanwhile: keep the pixels only if this tab is still in front.
      const after = await readTab(tab.id);
      if (await isFrontTab(after)) {
        return { ok: true, data: describeCapture(tab, after, { imageDataUrl, format }, { paint, background: true }) };
      }
      visibleErr = 'the tab left the front during the capture';
    } catch (err) {
      visibleErr = String((err && err.message) || err);
    }
  }

  const res = await captureViaCdp(tab, format, format === 'jpeg' ? quality : undefined, cdpTimeoutMs);
  if (res && res.ok && res.data && res.data.imageDataUrl) {
    const after = await readTab(tab.id);
    return { ok: true, data: describeCapture(tab, after, { imageDataUrl: res.data.imageDataUrl, format, via: front ? 'cdp_fallback' : 'cdp' }) };
  }
  const reason = res && res.timedOut ? 'cdp_timeout' : 'cdp_failed';
  const cdpWhy = res && res.timedOut
    ? `the CDP capture did not answer within ${Math.round(cdpTimeoutMs / 1000)} s`
    : `the CDP capture failed: ${(res && res.error) || 'no result'}`;
  const where = front
    ? `captureVisibleTab failed (${visibleErr}) and ${cdpWhy}`
    : `tab ${tab.id} is not the active tab of the focused window, so captureVisibleTab would return whatever is on screen instead of it, and ${cdpWhy}`;
  return makeError(ERROR_CODES.CAPTURE_UNAVAILABLE, `Cannot capture tab ${tab.id} in the background: ${where}. No image was taken. Retry, call web_screenshot without background to bring the tab forward, or ask the person to bring it to the front.`, true, { tabId: tab.id, reason });
}

/** The tab as it is now, or null (closed, or in another profile). */
function readTab(tabId) {
  return chrome.tabs.get(tabId).catch(() => null);
}

/**
 * The data of a capture that produced pixels.
 * @param {chrome.tabs.Tab} start the tab when the call started (pickActiveTab)
 * @param {chrome.tabs.Tab | null} after the tab read AFTER the pixels were taken: its url/title are reported
 * @param {object} base imageDataUrl, format, via, activatedTab
 * @param {{ fallback?: chrome.tabs.Tab, paint?: { painted: boolean, visibility?: string, reason?: string, error?: string } | null, background?: boolean, windowCapture?: boolean }} [opts]
 *   fallback: reported when `after` could not be read. paint: waitForPaintReady's report, for captureVisibleTab only.
 *   windowCapture: the pixels are the window's (captureVisibleTab), so a tab that can no longer be read may not be
 *   the one they show. A CDP capture is always the tab's own.
 */
function describeCapture(start, after, base, { fallback = start, paint = null, background = false, windowCapture = false } = {}) {
  const shown = after || fallback;
  const data = { ...base, url: shown.url, title: shown.title };
  const warnings = [];
  if (!after && windowCapture) {
    warnings.push('The tab could not be read again after the capture (it may have been closed, and Chrome then shows a neighbouring tab), so the image may show another tab. url and title are from before the capture. Take the screenshot again.');
  }
  if (after && start.url && after.url && after.url !== start.url) {
    data.navigatedDuringCapture = { before: start.url, after: after.url };
    warnings.push(`The tab navigated while it was being captured: it showed ${start.url} when the call started and ${after.url} when the pixels were taken. url and title name the page at the moment of capture, but the image may show either page. Take the screenshot again once the page has settled.`);
  }
  if (paint) {
    data.paintConfirmed = paint.painted === true;
    // A page that cannot be scripted (an error page, the Web Store) can never confirm a paint, and no retry would
    // change that: say so without calling the capture doubtful. Only a wait that ran out is a doubt.
    if (!data.paintConfirmed && paint.reason === 'unavailable') data.paintCheck = 'unavailable';
    else if (!data.paintConfirmed) warnings.push(unpaintedWarning(paint, background));
  }
  if (warnings.length) {
    data.degraded = true;
    data.warning = warnings.join(' ');
  }
  return data;
}

function unpaintedWarning(paint, background) {
  let why;
  if (paint.visibility === 'hidden') {
    why = "the page reported document.visibilityState 'hidden': its window is minimized, covered or otherwise not being drawn, so requestAnimationFrame is not running";
  } else {
    why = `no new frame was painted within ${PAINT_WAIT_MS} ms (the window may be covered, or the page too busy to paint)`;
  }
  const next = background
    ? 'Bring the browser window to the front (or ask the person to) and retry.'
    : 'Retry with background: true, which captures the tab through CDP instead of reading the window, or bring the browser window to the front and retry.';
  return `The capture went ahead without a freshly painted frame: ${why}. The image may be an older frame, for example from before a scroll or a navigation. ${next}`;
}
