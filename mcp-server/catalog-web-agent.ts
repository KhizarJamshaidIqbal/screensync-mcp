// Agent-parity web tool definitions — the Playwright / Claude-browser /
// Operator-browser feature layer that completes the extension's surface.
// Kept in a dedicated file so catalog-web.ts stops growing (repo 500-line rule).

type WebToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

const locatorNote =
  "Accepts the full ScreenSync locator language: css=, >>> (shadow piercing), pierce/, :has-text(), xpath=, role=[name=\"…\"], placeholder=, label=, text=, testid=, or raw CSS.";

export function agentWebToolDefinitions(): WebToolDef[] {
  return [
    {
      name: "web_expect",
      description:
        "Playwright expect(): auto-retrying assertion that polls the live page until the condition passes or the timeout expires. Replaces one-shot checks for navigation, toasts, spinner-gone, text-appears, and value-change flows.",
      inputSchema: {
        type: "object",
        required: ["condition"],
        properties: {
          condition: { type: "string", enum: ["visible", "hidden", "text", "value", "count", "url", "title", "checked"], description: "Assertion to retry until it passes." },
          selector: { type: "string", description: locatorNote },
          text: { type: "string", description: "Expected substring (for text/url/title conditions)." },
          value: { type: "string", description: "Expected exact input value (for the value condition)." },
          count: { type: "integer", description: "Expected element count (for the count condition)." },
          timeoutMs: { type: "integer", minimum: 100, maximum: 30000, default: 5000, description: "How long to keep polling." },
          pollMs: { type: "integer", minimum: 50, maximum: 2000, default: 250, description: "Poll interval." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_aria_snapshot",
      description:
        "Playwright ariaSnapshot(): renders the page (or a subtree) as a compact YAML ARIA tree — roles, names, states, and [index=N] refs that web_click/web_type accept directly. The structure-aware way for an AI to read a page instead of raw text dumps.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Optional subtree root. Omit for the whole page." },
          maxNodes: { type: "integer", minimum: 10, maximum: 700, default: 350, description: "Maximum nodes in the snapshot." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_table_extract",
      description:
        "Extracts <table> elements into structured data — headers + rows plus ready-to-use json, markdown, and csv renderings. Ideal for prices, comparison tables, and report grids.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", default: "table", description: "CSS selector for the table(s)." },
          index: { type: "integer", description: "Extract only the Nth <table> on the page (0-based)." },
          format: { type: "string", enum: ["all", "json", "markdown", "csv"], default: "all", description: "Which renderings to include." },
          limit: { type: "integer", minimum: 1, maximum: 1000, default: 200, description: "Maximum rows per table." },
          tableLimit: { type: "integer", minimum: 1, maximum: 20, default: 5, description: "Maximum tables when scanning by selector." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_get_by",
      description:
        "Playwright getByRole/getByText/getByLabel/getByPlaceholder/getByTestId/getByAltText/getByTitle in one tool: finds elements by ARIA role, text, label, placeholder, test id, alt, or title; stamps data-ss-id refs that web_click/web_type/web_fill accept, and returns bounding boxes.",
      inputSchema: {
        type: "object",
        required: ["by", "value"],
        properties: {
          by: { type: "string", enum: ["role", "text", "label", "placeholder", "testid", "alt", "title", "css"], description: "Query strategy." },
          value: { type: "string", description: "Role name, text, label, placeholder, test id, alt, title, or CSS." },
          name: { type: "string", description: "Accessible-name filter when by=role (e.g. role=button + name=Submit)." },
          exact: { type: "boolean", default: false, description: "Case-sensitive exact match instead of substring." },
          nth: { type: "integer", description: "Select the Nth match (negative counts from the end)." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Maximum matches to return." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_fill",
      description:
        "Playwright fill(): instantly sets an input/textarea/contenteditable value with proper input+change events (no keystroke emulation). Faster and more reliable than web_type for long text; use web_human_type instead when anti-bot cadence matters.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref from web_get_by / web_aria_snapshot." },
          value: { type: "string", description: "The value to set." },
          mask: { type: "boolean", default: false, description: "Echo '••••••' in the result instead of the value (passwords)." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_check",
      description:
        "Playwright check()/uncheck(): toggles native checkboxes/radios or ARIA [role=checkbox] elements to the desired state and verifies the result.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref from web_get_by / web_aria_snapshot." },
          checked: { type: "boolean", default: true, description: "Desired state — false unchecks." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_focus",
      description:
        "Playwright focus()/blur(): moves keyboard focus to an element, or blurs the currently focused one with blur:true. Useful before web_key combos and to dismiss popups.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref from web_get_by / web_aria_snapshot." },
          blur: { type: "boolean", default: false, description: "Blur the active element instead of focusing a target." },
          preventScroll: { type: "boolean", default: false, description: "Focus without scrolling the element into view." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_scroll_to",
      description:
        "Scrolls an element into view (Playwright locator.scrollIntoViewIfNeeded semantics with block/behavior options) or jumps the page to top/middle/bottom.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref from web_get_by / web_aria_snapshot." },
          position: { type: "string", enum: ["top", "middle", "bottom"], description: "Page jump when no selector is given." },
          block: { type: "string", enum: ["start", "center", "end", "nearest"], default: "center", description: "Vertical alignment for element scroll." },
          behavior: { type: "string", enum: ["smooth", "auto"], default: "smooth", description: "Scroll animation." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_run_code",
      description:
        "Playwright run_code parity: executes an async JS snippet in the page with a mini page API (ctx.find, ctx.findAll, ctx.click, ctx.fill, ctx.text, ctx.attr, ctx.waitFor, ctx.url, ctx.title) for compound multi-step operations in a single round trip. Same trust boundary as web_eval.",
      inputSchema: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string", description: "Async JS body, e.g. \"await ctx.waitFor('#results'); return ctx.findAll('.item').length\"." },
          timeoutMs: { type: "integer", minimum: 500, maximum: 30000, default: 8000, description: "Execution timeout." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_media_extract",
      description:
        "Enumerates the page's images (with dimensions + alt), videos (with poster/duration), audio sources, and links (flagging external ones) — the asset-discovery half of a browsing agent's toolkit.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100, description: "Maximum items per media type." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_device_emulate",
      description:
        "Playwright device descriptors: emulates a phone/tablet/desktop preset (viewport, DPR, touch, mobile UA) via CDP — iPhone SE/15/15 Pro Max, Pixel 7/8, Galaxy S24, iPad mini/Pro, laptop and desktop sizes. Pairs with web_navigate for mobile-first checks.",
      inputSchema: {
        type: "object",
        required: ["device"],
        properties: {
          device: { type: "string", enum: ["iphone_se", "iphone_15", "iphone_15_pro_max", "pixel_7", "pixel_8", "galaxy_s24", "ipad_mini", "ipad_pro", "laptop_13", "desktop_1080p", "desktop_1440p", "desktop_4k"], description: "Device preset." },
          orientation: { type: "string", enum: ["portrait", "landscape"], default: "portrait", description: "Viewport orientation." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_resize",
      description:
        "Playwright viewport.setViewportSize: resizes the tab's viewport via CDP metrics override; clear:true restores the real viewport.",
      inputSchema: {
        type: "object",
        properties: {
          width: { type: "integer", minimum: 1, description: "Viewport width in CSS pixels." },
          height: { type: "integer", minimum: 1, description: "Viewport height in CSS pixels." },
          deviceScaleFactor: { type: "number", minimum: 0.5, maximum: 4, default: 1, description: "Device pixel ratio." },
          mobile: { type: "boolean", default: false, description: "Mobile viewport flag." },
          hasTouch: { type: "boolean", default: false, description: "Touch events flag." },
          clear: { type: "boolean", default: false, description: "Clear the override instead of resizing." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_set_user_agent",
      description:
        "Playwright setUserAgent: overrides the tab's User-Agent (optionally Accept-Language and platform) via CDP; clear:true restores the native UA.",
      inputSchema: {
        type: "object",
        properties: {
          userAgent: { type: "string", description: "The User-Agent string to apply." },
          acceptLanguage: { type: "string", description: "Accept-Language header override (e.g. 'en-US,en;q=0.9')." },
          platform: { type: "string", description: "navigator.platform override (e.g. 'MacIntel')." },
          clear: { type: "boolean", default: false, description: "Restore the native User-Agent instead." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_har_record",
      description:
        "True HAR 1.2 network capture via the Chrome Debugger protocol: start, drive the page, stop — returns real request/response entries (method, URL, status, headers, timings, sizes, resource types, server IPs) far more accurate than the hook-based web_export_har. Optionally saves the .har to Downloads.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["start", "get", "stop"], description: "Recording lifecycle." },
          filter: { type: "string", description: "Only capture requests whose URL contains this substring." },
          maxEntries: { type: "integer", minimum: 1, maximum: 2000, default: 500, description: "Maximum captured entries." },
          download: { type: "boolean", default: false, description: "On stop, save the .har file to Downloads." },
          filename: { type: "string", description: "Download filename for the .har." },
          bodies: { type: "boolean", default: false, description: "Capture response bodies (≤256 KB each, 4 MB total) into HAR content blocks." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_trace_record",
      description:
        "Playwright tracing parity: records a real Chrome performance trace via the CDP Tracing domain — timeline, v8, JS events — and assembles the standard Chrome trace JSON on stop (openable in chrome://tracing / DevTools Performance). Optional .json download.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["start", "get", "stop"], description: "Recording lifecycle." },
          recordMode: { type: "string", enum: ["recordUntilFull", "recordContinuously"], default: "recordUntilFull", description: "Chromium trace record mode." },
          categories: { type: "array", items: { type: "string" }, description: "Override trace categories (defaults to timeline + v8 + JS)." },
          maxEvents: { type: "integer", minimum: 100, maximum: 100000, default: 20000, description: "Maximum captured trace events." },
          download: { type: "boolean", default: false, description: "On stop, save the trace .json to Downloads." },
          filename: { type: "string", description: "Download filename for the trace." },
          returnData: { type: "boolean", description: "Force the full trace JSON into the result even when large." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_video_record",
      description:
        "Records a real WebM video of the tab (Page.screencast frames → offscreen MediaRecorder) — Operator-style run evidence. Start, perform actions, stop; returns the video as base64 and/or saves it to Downloads.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["start", "stop"], description: "Recording lifecycle." },
          fps: { type: "integer", minimum: 5, maximum: 30, default: 15, description: "Target capture framerate." },
          maxWidth: { type: "integer", minimum: 100, maximum: 1920, default: 1280, description: "Max frame width." },
          maxHeight: { type: "integer", minimum: 100, maximum: 1080, default: 800, description: "Max frame height." },
          download: { type: "boolean", default: false, description: "On stop, save the .webm to Downloads." },
          filename: { type: "string", description: "Download filename for the .webm." },
          returnData: { type: "boolean", description: "Force the base64 WebM into the result even when large." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_clock_set",
      description:
        "Playwright clock API parity: shifts the page's Date by offsetMs or fixes it to an ISO timestamp — instantly and on every future navigation of this tab, until web_clock_clear. Essential for testing expiry states, countdowns, and date-sensitive UI.",
      inputSchema: {
        type: "object",
        properties: {
          offsetMs: { type: "integer", description: "Offset from real time in ms (negative = into the past)." },
          iso: { type: "string", description: "Fix the clock to an absolute ISO timestamp instead of an offset." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_clock_clear",
      description:
        "Restores the page's real clock and stops the override from applying to future navigations.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_events",
      description:
        "Real-time SSE event tail (answered instantly by the hub — no browser round trip): returns the sequenced live event stream — page navigations, tab activations, page loads, tool activity, frame uploads, inspections — with a cursor (since=lastSeq) and type filters. Poll it after actions to see what happened live; every event also carries an id for SSE Last-Event-ID replay.",
      inputSchema: {
        type: "object",
        properties: {
          since: { type: "integer", default: 0, description: "Only events with seq > since (pass the lastSeq you already saw)." },
          types: {
            oneOf: [
              { type: "string", description: "Comma-separated type filter, e.g. 'web_navigation,web_page_loaded'." },
              { type: "array", items: { type: "string" }, description: "Array of event types to include." },
            ],
            description: "Filter by event type: web_navigation, web_page_loaded, web_tab_activated, tool, frame, web_event.",
          },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100, description: "Maximum events returned." },
        },
        additionalProperties: false,
      },
    },
  ];
}
