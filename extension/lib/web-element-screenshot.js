// ScreenSync web_element_screenshot executor — split out of web-adv-capture.js (which sat at the
// repo's 500-line ceiling, see AGENTS.md §2) so this CDP clip-capture path could get its own
// paint-readiness guard without growing that file further.
import { rawAttach, rawDetach, cdpWaitPaintReady } from './web-adv-core.js';
import { ssWebUnitExtract } from './web-unit.js';

export async function cdpElementScreenshot(tab, args = {}) {
  let bounds = null;
  try {
    const bRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: ssWebUnitExtract,
      args: [{ ...args, __tool: 'web_element_bounds' }],
    });
    if (bRes && bRes[0] && bRes[0].result && bRes[0].result.ok) {
      bounds = bRes[0].result.data;
    }
  } catch {}
  if (!bounds) {
    return { ok: false, error: 'Could not calculate bounds for element screenshot. Make sure element is visible on page.' };
  }

  const padding = Number(args.padding) || 4;
  const useFullPage = args.fullPage === true;
  const clipX = useFullPage ? (bounds.pageX ?? bounds.x) : bounds.x;
  const clipY = useFullPage ? (bounds.pageY ?? bounds.y) : bounds.y;
  const clip = {
    x: Math.max(0, clipX - padding),
    y: Math.max(0, clipY - padding),
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    scale: 1,
  };

  const target = { tabId: tab.id };
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }
  try {
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    // Same compositor-lag guard as cdpScreenshot (web-adv-capture.js): this path used to capture
    // immediately after computing the element's bounds, with no wait for an actual painted frame,
    // so a capture right after a scroll or DOM change (e.g. web_eval's scrollIntoView()) could
    // return a blank/stale clip even though the bounds themselves were already correct — confirmed
    // live 2026-09-23 (web_element_screenshot returned ok:true with a solid-color image immediately
    // after a successful scrollIntoView()). cdpScreenshot got this guard first (a131511); this path
    // never did.
    await cdpWaitPaintReady(target);
    const format = args.format === 'png' ? 'png' : 'jpeg';
    const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 85;
    const captureOpts = { format, clip, captureBeyondViewport: useFullPage };
    if (format === 'jpeg') captureOpts.quality = quality;

    const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', captureOpts);
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    return {
      ok: true,
      data: {
        imageDataUrl: `data:${mime};base64,${res.data}`,
        format,
        clip,
        bounds,
        url: tab.url,
      },
    };
  } catch (err) {
    return { ok: false, error: `CDP element screenshot error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      await rawDetach(target);
    }
  }
}
