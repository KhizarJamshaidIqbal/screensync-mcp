// The text block beside a screenshot's image in an MCP reply (web_screenshot, web_full_screenshot,
// web_element_screenshot). The image block carries only pixels, so everything an agent needs to judge them
// has to ride here. It used to rebuild a fixed {url, title, fullPage, selector}, which silently dropped what
// the capture said about itself: via, activatedTab, and since 2026-09-29 whether the frame was confirmed
// fresh (or, paintCheck, could not be checked) and whether the tab navigated during the capture
// (extension/lib/web-screenshot.js).
//
// The four original keys and their defaults are kept as they were; the others appear only when the
// extension sent them, so a clean capture reads almost exactly as before.

/** What a capture may report about itself, in the order an agent should read it. */
export const CAPTURE_META_KEYS = ["degraded", "warning", "paintConfirmed", "paintCheck", "navigatedDuringCapture", "format", "via", "activatedTab"] as const;

export function captureMetaText(data: Record<string, unknown> | undefined): string {
  const d = data ?? {};
  const extra = Object.fromEntries(CAPTURE_META_KEYS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
  return JSON.stringify({ url: d.url ?? null, title: d.title ?? null, fullPage: d.fullPage ?? false, selector: d.selector ?? null, ...extra }, null, 2);
}
