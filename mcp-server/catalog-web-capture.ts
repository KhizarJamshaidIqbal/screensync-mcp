// The capture family of web tool definitions, moved out of catalog-web.ts (repo rule: no source file over 500
// lines). web_screenshot moved first, when its reply gained the fields that say whether the pixels can be
// trusted (2026-09-29); the rest of the family followed. The tools sit in three runs in the catalogue, so there
// are three functions, each spread back into webToolDefinitions() at its old position: the tool list and its
// order are unchanged.

import type { WebToolDef } from "./catalog-web-agent-core.js";

/** web_screenshot, web_full_screenshot, web_pdf. */
export function captureWebToolDefinitions(): WebToolDef[] {
  return [
    {
      name: "web_screenshot",
      description:
        "Captures the currently active browser tab as an inline image (what the user is actually looking at). Requires the extension connected with Web access enabled. Chrome's capture API only ever sees the foreground tab of a focused window, so a background/inactive tab (or tabId) is briefly activated and its window focused first — this is automatic, not something you need to call web_window for. It waits up to 1 s for an actual painted frame (not just 'load complete') before capturing. When the person is using the browser, pass background: true instead: nothing is activated or focused, a tab that is not in front is captured through CDP, and if that is impossible the call fails fast with CAPTURE_UNAVAILABLE and no image, never another page's pixels. " +
        "Reply: the image plus url and title of the page the tab showed WHEN the pixels were taken (read after the capture), format, and via ('cdp' | 'cdp_fallback') or activatedTab when they apply. paintConfirmed (captures of the window only) is false when no fresh frame was painted: a minimized, covered or hidden window runs no requestAnimationFrame, so the image may be an older frame, e.g. from before a scroll (with paintCheck: 'unavailable' beside it, the page cannot be scripted at all, e.g. an error page, and that alone is no doubt). navigatedDuringCapture {before, after} appears when the tab's url changed during the call, so the image may show either page. A tab that stopped being the one its window shows during the call is captured again through CDP (via 'cdp_fallback'); one that closed may leave a neighbouring tab's frame. A stale frame, a navigation or a closed tab adds degraded: true and a warning saying why; the call still succeeds with the image. On degraded, read the warning and capture again (background: true, or with the window in front) before trusting the pixels.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["png", "jpeg"], default: "jpeg", description: "Image format — use png for deterministic visual baselines." },
          tabId: { type: "integer", description: "Optional background tab ID. It is brought to the front for the capture unless background is true." },
          background: { type: "boolean", default: false, description: "Capture without activating the tab or focusing its window (through CDP when the tab is not in front); fails fast with CAPTURE_UNAVAILABLE rather than return another page. Use it when the person is using the browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_full_screenshot",
      description:
        "Captures the entire full-length web page (scrolling beyond the viewport) using Chrome DevTools Protocol. Returns a high-res full document image.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["jpeg", "png"], default: "jpeg" },
          quality: { type: "integer", minimum: 1, maximum: 100, default: 85 },
          longPage: { type: "boolean", default: false, description: "Use tiled scrolling capture for pages taller than 16,384px. Handles infinite scroll feeds, sticky header dedup, and stall detection." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_pdf",
      description: "Prints and exports the current browser tab as a PDF (full Playwright pdf() parity: named paper formats, scale, page ranges, margins, header/footer templates, CSS page size, document outline).",
      inputSchema: {
        type: "object",
        properties: {
          landscape: { type: "boolean", default: false },
          printBackground: { type: "boolean", default: true },
          format: { type: "string", enum: ["letter", "legal", "tabloid", "ledger", "a0", "a1", "a2", "a3", "a4", "a5", "a6"], description: "Named paper size (overrides paperWidth/Height)." },
          scale: { type: "number", minimum: 0.1, maximum: 2, description: "Page scale factor." },
          pageRanges: { type: "string", description: "Paper ranges to print, e.g. '1-5, 8, 11-13'." },
          margin: { type: "number", description: "Uniform margin in inches (per-side marginTop/Bottom/Left/Right override)." },
          headerTemplate: { type: "string", description: "HTML header template (enables displayHeaderFooter)." },
          footerTemplate: { type: "string", description: "HTML footer template (enables displayHeaderFooter)." },
          preferCSSPageSize: { type: "boolean", default: false, description: "Let @page CSS decide the paper size." },
          generateDocumentOutline: { type: "boolean", default: false, description: "Embed a PDF outline/bookmark tree." },
          generateTaggedPDF: { type: "boolean", default: false, description: "Generate tagged (accessible) PDF." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
  ];
}

/** web_pixel_diff, web_element_screenshot. */
export function compareCaptureWebToolDefinitions(): WebToolDef[] {
  return [
    {
      name: "web_pixel_diff",
      description:
        "Hardware-accelerated pixel-by-pixel visual regression comparison using an Offscreen Canvas. Compares two image data URLs (or imageA against the current live screen if imageB is omitted) and returns diff percentage, mismatched pixel count, and a visual heatmap diff image.",
      inputSchema: {
        type: "object",
        required: ["imageA"],
        properties: {
          imageA: { type: "string", description: "Baseline image data URL (e.g. from web_screenshot)." },
          imageB: { type: "string", description: "Comparison image data URL (optional; if omitted, current tab is captured automatically)." },
          threshold: { type: "number", minimum: 0, maximum: 1, default: 0.1, description: "Per-channel color delta sensitivity threshold (0.0 to 1.0)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_element_screenshot",
      description:
        "Captures a pixel-perfect cropped screenshot of a specific DOM element using Chrome DevTools Protocol clip capture. Supports Playwright locators (e.g. xpath=, role=, text=, placeholder=, label=) and standard CSS selectors. Waits for an actual painted frame before capturing, so a call right after a scroll or DOM change (e.g. scrollIntoView()) returns the settled element, not a blank/stale clip.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector or Playwright locator (e.g. 'text=Checkout', 'xpath=//button', 'role=button[name=Submit]')." },
          index: { type: "integer", minimum: 0, description: "Index from web_hierarchy interactive element list." },
          format: { type: "string", enum: ["jpeg", "png"], default: "jpeg" },
          quality: { type: "integer", minimum: 1, maximum: 100, default: 85 },
        },
        additionalProperties: false,
      },
    },
  ];
}

/** web_screencast. */
export function screencastWebToolDefinitions(): WebToolDef[] {
  return [
    {
      name: "web_screencast",
      description: "Motion video frame recording: streams and buffers timestamped JPEG frames at configurable FPS via CDP Page.startScreencast for multi-step visual proofs.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "get", "stop"], default: "start", description: "Screencast action." },
          quality: { type: "integer", minimum: 1, maximum: 100, default: 75, description: "JPEG quality." },
          everyNthFrame: { type: "integer", minimum: 1, maximum: 10, default: 2, description: "Frame throttle multiplier." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
  ];
}
