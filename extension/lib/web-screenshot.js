// ScreenSync web_screenshot executor — split out of web-tools.js (which sits at the repo's
// 500-line ceiling, see AGENTS.md §2) to fix background-tab captures without growing it further.
import { execAdvTool } from './web-adv.js';
import { pickActiveTab, isRestrictedTab } from './tab-resolve.js';
import { makeError, ERROR_CODES } from './errors.js';

export async function execWebScreenshot(args = {}) {
  const tab = await pickActiveTab(args);
  if (isRestrictedTab(tab)) return makeError(ERROR_CODES.RESTRICTED_PAGE, `Cannot capture restricted tab (${tab.url}).`);
  const format = args.format === 'png' ? 'png' : 'jpeg';
  const opts = format === 'png'
    ? { format: 'png' }
    : { format: 'jpeg', quality: typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 85 };

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
