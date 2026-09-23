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
import { execAdvTool } from './web-adv.js';
import { cdpScreenshot } from './web-adv-capture.js';
import { rawDetach } from './web-adv-core.js';
import { pickActiveTab, isRestrictedTab, waitForPaintReady } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';

/** How long the background CDP capture may take before the call gives up (well inside the hub's 45 s). */
export const CDP_CAPTURE_TIMEOUT_MS = 12000;

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
  await waitForPaintReady(captureTab.id);

  try {
    const imageDataUrl = await chrome.tabs.captureVisibleTab(captureTab.windowId, opts);
    return { ok: true, data: { imageDataUrl, url: captureTab.url, title: captureTab.title, format, ...(activatedTab ? { activatedTab: true } : {}) } };
  } catch (err) {
    const cdpRes = await execAdvTool('web_full_screenshot', captureTab, { format, quality: opts.quality })
      .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    if (cdpRes && cdpRes.ok && cdpRes.data && cdpRes.data.imageDataUrl) {
      return { ok: true, data: { imageDataUrl: cdpRes.data.imageDataUrl, url: captureTab.url, title: captureTab.title, via: 'cdp_fallback', format } };
    }
    // Both capture paths failed — surface both errors instead of only the first
    // (captureVisibleTab's), which used to hide the CDP fallback's real cause.
    const captureErr = String((err && err.message) || err);
    const cdpErr = cdpRes && cdpRes.error ? String(cdpRes.error) : 'no CDP fallback result';
    return makeError(ERROR_CODES.INTERNAL, `captureVisibleTab failed: ${captureErr}; CDP fallback failed: ${cdpErr}`);
  }
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
    await waitForPaintReady(tab.id);
    try {
      const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, format === 'png' ? { format: 'png' } : { format: 'jpeg', quality });
      // The person may have switched tab or window meanwhile: keep the pixels only if this tab is still in front.
      const after = await chrome.tabs.get(tab.id).catch(() => null);
      if (await isFrontTab(after)) {
        return { ok: true, data: { imageDataUrl, url: after.url, title: after.title, format } };
      }
      visibleErr = 'the tab left the front during the capture';
    } catch (err) {
      visibleErr = String((err && err.message) || err);
    }
  }

  const res = await captureViaCdp(tab, format, format === 'jpeg' ? quality : undefined, cdpTimeoutMs);
  if (res && res.ok && res.data && res.data.imageDataUrl) {
    return { ok: true, data: { imageDataUrl: res.data.imageDataUrl, url: tab.url, title: tab.title, format, via: front ? 'cdp_fallback' : 'cdp' } };
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
