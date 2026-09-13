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
          condition: { type: "string", enum: ["visible", "hidden", "text", "value", "count", "url", "title", "checked", "accessible_name", "attribute", "has_class", "attached", "detached"], description: "Assertion to retry until it passes." },
          not: { type: "boolean", default: false, description: "Negate the assertion (Playwright expect.not parity) — polls until it does NOT hold." },
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
        "Playwright clock API parity: shifts the page's Date by offsetMs, fixes it to an ISO timestamp (fixed:true — Date always returns that instant), or sets an absolute system time — instantly and on every future navigation of this tab, until web_clock_clear. Essential for testing expiry states, countdowns, and date-sensitive UI.",
      inputSchema: {
        type: "object",
        properties: {
          offsetMs: { type: "integer", description: "Offset from real time in ms (negative = into the past)." },
          iso: { type: "string", description: "Fix the clock to an absolute ISO timestamp instead of an offset." },
          fixed: { type: "boolean", default: false, description: "Freeze Date at the given instant (setFixedTime parity) instead of offsetting." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_clock_fast_forward",
      description:
        "Playwright clock.fastForward parity: advances (or rewinds with negative ms) the active clock override on this tab by the given delta — perfect for jumping past an expiry or a countdown mid-test. Requires a prior web_clock_set.",
      inputSchema: {
        type: "object",
        properties: {
          ms: { type: "integer", description: "Delta in ms (e.g. 86400000 for +1 day)." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_window",
      description:
        "Window management for automation: restore a minimized/tiny window to normal or maximized state (screenshots, screencasts and visibility checks need a real viewport), focus it, or move/resize. Uses chrome.windows — no CDP.",
      inputSchema: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["normal", "maximized", "minimized", "fullscreen"], description: "Target window state. Default: normal." },
          focused: { type: "boolean", description: "Bring the window to the foreground." },
          tabId: { type: "integer", description: "Identify the window via this tab." },
          windowId: { type: "integer", description: "Direct window id." },
          left: { type: "integer" },
          top: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_download",
      description:
        "Playwright page.waitForDownload parity: resolves when the browser starts a NEW download (optionally filtered by url/filename substring) and it completes — returns filename, size, mime and finalUrl. Call it BEFORE (or in parallel with) the action that triggers the download.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Only resolve for downloads whose URL contains this substring." },
          filename: { type: "string", description: "Only resolve for downloads whose filename contains this substring." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, default: 30000, description: "How long to wait for the download." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_tab_fanout",
      description:
        "Multi-TAB orchestration (mirror of web_fanout): runs ONE web tool on every tab (or a filtered subset: tabIds / url substrings / activeOnly) of the connected browser and merges results keyed per tab. E.g. extract a table from 5 open tabs in one call.",
      inputSchema: {
        type: "object",
        required: ["tool"],
        properties: {
          tool: { type: "string", description: "The web_* tool to run on each tab (must accept tabId)." },
          args: { type: "object", description: "Arguments forwarded to the tool on every tab." },
          tabIds: { type: "array", items: { type: "integer" }, description: "Restrict to these tab ids." },
          urls: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Restrict to tabs whose URL contains a substring (or any of them)." },
          activeOnly: { type: "boolean", default: false, description: "Only the active tab." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000, description: "Per-tab timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_record",
      description:
        "Teach-once-replay-anywhere: while recording, EVERY web tool call you make is captured {tool, args}. web_record {action:'stop'} returns the step list — edit it freely — then web_replay re-executes the whole flow. Ideal for daily real-account flows (posting, scraping, checking).",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["start", "stop", "status"], description: "Recorder lifecycle." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_replay",
      description:
        "Re-executes a recorded step list (from web_record {action:'stop'}, optionally edited by you) step by step on the live browser — with stopOnError control, per-step results, and web_replay_step events visible in web_events. The replay half of teach-once-replay-anywhere.",
      inputSchema: {
        type: "object",
        required: ["steps"],
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "web_* tool for this step." },
                args: { type: "object", description: "Arguments for the tool." },
              },
            },
            description: "Steps to execute in order.",
          },
          stopOnError: { type: "boolean", default: true, description: "Abort the replay on the first failing step." },
          stepTimeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000, description: "Per-step timeout." },
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
    {
      name: "web_fanout",
      description:
        "Multi-browser orchestration: runs ONE web tool on every connected browser (or a chosen subset) and merges the results keyed by browser. The core of operating several real browsers at once — e.g. web_social_matrix across all browsers, or web_screenshot on each. Tool name + args pass through; each browser executes its own copy.",
      inputSchema: {
        type: "object",
        required: ["tool"],
        properties: {
          tool: { type: "string", description: "The web_* tool to run on each browser (e.g. 'web_social_matrix')." },
          args: { type: "object", description: "Arguments forwarded to the tool on every browser." },
          browsers: {
            oneOf: [
              { type: "string", description: "'all' or comma-separated browser names/ids." },
              { type: "array", items: { type: "string" }, description: "Browser names or install ids (from web_status.browsers)." },
            ],
            description: "Which browsers to target. Omit/'all' = every connected browser.",
          },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000, description: "Per-browser timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_session_transfer",
      description:
        "THE multi-browser data-sync capability: copies a domain's logged-in session (cookies + optional localStorage) FROM one connected browser TO another — e.g. sync the LinkedIn login from Edge to Chrome without ever touching credentials. Requires 2+ paired browsers; identify them via web_status.browsers (use install ids when names collide).",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Session domain to transfer, e.g. 'linkedin.com'." },
          from: { type: "string", description: "Source browser name or install id. Default: first connected." },
          to: { type: "string", description: "Target browser name or install id. Default: next connected." },
          localStorage: { type: "boolean", default: true, description: "Also transfer localStorage (opens a temporary tab on the origin in both browsers)." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000, description: "Per-step timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_route_for",
      description:
        "Answers 'which connected browser is logged into this domain?': probes each browser's auth cookies for the domain and returns per-browser evidence plus a recommended browser (id) for operating that site. The routing brain for multi-browser operator flows.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Domain to probe, e.g. 'x.com'." },
          url: { type: "string", description: "Alternative: a full URL whose domain is probed." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 30000, description: "Per-browser probe timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_in_frame",
      description:
        "Playwright frameLocator parity: runs any interact/agent/extract web tool INSIDE a specific iframe of the active tab (web_click, web_fill, web_expect, web_table_extract, ...). Resolve frames with web_frame_tree, then pass frameId or a frameUrl substring plus the inner tool and args.",
      inputSchema: {
        type: "object",
        required: ["tool"],
        properties: {
          tool: { type: "string", description: "Inner page tool to run in the frame (web_click, web_fill, web_expect, web_table_extract, ...)." },
          args: { type: "object", description: "Arguments for the inner tool (selector, value, condition, ...)." },
          frameId: { type: "integer", description: "Target frame id from web_frame_tree." },
          frameUrl: { type: "string", description: "Alternative: substring of the frame's URL to target." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_session_export",
      description:
        "Exports this browser's session for one domain (cookies via the browser-level cookie jar + optional localStorage) as a transferable payload — the building block web_session_transfer uses, exposed for manual control (backups, session inspection without values leaving the browser).",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Domain to export, e.g. 'github.com'." },
          localStorage: { type: "boolean", default: true, description: "Include localStorage (opens a temporary tab on the origin if none is open)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_session_import",
      description:
        "Imports a session payload (from web_session_export) into this browser: sets the cookies and restores localStorage onto the origin.",
      inputSchema: {
        type: "object",
        required: ["session"],
        properties: {
          session: { type: "object", description: "Payload from web_session_export (domain, cookies[], localStorage)." },
          domain: { type: "string", description: "Optional domain override." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_network_auth",
      description:
        "Playwright page.authenticate parity: automatically answers HTTP basic/proxy auth challenges (401 + WWW-Authenticate) with the given credentials via CDP Fetch.authRequired — the agent never sees the browser's native login dialog.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["set", "clear"], default: "set", description: "set = start answering challenges; clear = stop." },
          username: { type: "string", description: "Auth username." },
          password: { type: "string", description: "Auth password." },
          urlPattern: { type: "string", default: "*", description: "Only intercept auth challenges for matching URLs." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_api_fetch",
      description:
        "Playwright request-context parity: makes HTTP requests WITH the browser's real logged-in session — the profile's cookies attach automatically, so the agent reads the same JSON APIs the logged-in site uses (feeds, timelines, account data) without ever handling credentials. Use noCookies:true for a clean request.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to call." },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], default: "GET" },
          headers: { type: "object", description: "Extra request headers." },
          body: { type: "object", description: "Request body (object → JSON)." },
          noCookies: { type: "boolean", default: false, description: "Send WITHOUT the session cookies." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 60000, default: 20000 },
          maxBodyChars: { type: "integer", minimum: 1000, maximum: 1000000, default: 200000, description: "Body truncation limit." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_history",
      description:
        "Searches the browser's recent navigation history (chrome.history) — operator context: what sites were visited recently, how often. Filter by text and time window.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Substring filter for URL/title. Omit for all recent." },
          hoursBack: { type: "integer", minimum: 1, maximum: 2160, default: 24, description: "Look-back window in hours." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_bookmarks",
      description:
        "Lists/searches the browser's bookmarks (chrome.bookmarks) with folder paths — quick navigation targets for operator flows.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Substring filter for title/URL/folder. Omit for all." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_flow_save",
      description:
        "Saves a step list (from web_record {action:'stop'} — edit freely) under a name as a reusable flow. Use {{var}} placeholders in args for parameterization. Flows persist on the hub (DATA_DIR/flows).",
      inputSchema: {
        type: "object",
        required: ["name", "steps"],
        properties: {
          name: { type: "string", description: "Flow name, e.g. 'daily-linkedin-post'." },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "web_* tool for this step." },
                args: { type: "object", description: "Tool arguments — {{var}} placeholders allowed." },
              },
            },
            description: "Steps in execution order.",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_flow_list",
      description: "Lists all saved flows with step counts and the tools they use.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_flow_run",
      description:
        "Runs a saved flow by name: executes its steps sequentially with {{var}} substitution, stopOnError control, per-step results, and web_replay_step events in web_events. The daily-driver for recorded real-account flows.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Flow name to run." },
          vars: { type: "object", description: "Variable values substituted into {{var}} placeholders, e.g. {message: 'Hello'}." },
          stopOnError: { type: "boolean", default: true },
          stepTimeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_flow_delete",
      description: "Deletes a saved flow by name.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "web_account_report",
      description:
        "ONE-call account dashboard: probes every connected browser's social/platform logins (social matrix fanout) and merges into a single map — 'kaunsa account kis browser mein live hai'. The starting point for any multi-browser operator task.",
      inputSchema: {
        type: "object",
        properties: {
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000, description: "Per-browser probe timeout." },
        },
        additionalProperties: false,
      },
    },
  ];
}
