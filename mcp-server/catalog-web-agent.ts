// Agent-parity web tool definitions — the Playwright / Claude-browser /
// Operator-browser feature layer that completes the extension's surface.
// Kept in a dedicated file so catalog-web.ts stops growing (repo 500-line rule).

import { agentCoreWebToolDefinitions, WebToolDef } from "./catalog-web-agent-core.js";

const locatorNote =
  "Accepts the full ScreenSync locator language: css=, >>> (shadow piercing), pierce/, :has-text(), xpath=, role=[name=\"…\"], placeholder=, label=, text=, testid=, or raw CSS.";

export function agentWebToolDefinitions(): WebToolDef[] {
  return [
    ...agentCoreWebToolDefinitions(),
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
          formData: { type: "object", description: "Multipart/form-data fields: string values or {filename, base64, contentType} file objects (real FormData — browser sets the boundary)." },
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
    {
      name: "web_flow_schedule",
      description: "THE automation completion: schedules a saved flow to run automatically every N minutes — the hub itself executes it on the real logged-in browsers ({{var}} vars supported). Survives hub restarts (persisted). E.g. schedule a daily-posting flow at everyMinutes 1440.",
      inputSchema: {
        type: "object",
        required: ["flow", "everyMinutes"],
        properties: {
          flow: { type: "string", description: "Saved flow name (web_flow_save)." },
          everyMinutes: { type: "number", minimum: 0.05, description: "Run interval in minutes (0.05 = every 3s; 1440 = daily)." },
          vars: { type: "object", description: "{{var}} values for every run." },
          stopOnError: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_flow_schedules",
      description: "Lists all active flow schedules with their last-run status (time, success, executed steps).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_flow_unschedule",
      description: "Stops and removes a flow schedule by id (from web_flow_schedules).",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "web_emulate_media",
      description:
        "Playwright page.emulateMedia() parity: emulates the media type (print/screen — test print stylesheets) and feature policies prefers-reduced-motion, forced-colors, and prefers-contrast. Reset by calling with media='' and no features.",
      inputSchema: {
        type: "object",
        properties: {
          media: { type: "string", enum: ["screen", "print", ""], description: "Emulated media type. Empty string = no emulation." },
          reducedMotion: { type: "string", enum: ["reduce", "no-preference"], description: "prefers-reduced-motion override." },
          forcedColors: { type: "string", enum: ["active", "none"], description: "forced-colors override." },
          contrast: { type: "string", enum: ["more", "less", "no-preference"], description: "prefers-contrast override." },
          colorScheme: { type: "string", enum: ["dark", "light"], description: "prefers-color-scheme override." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_mhtml",
      description:
        "Captures the ENTIRE page (DOM + resources) as a single MHTML archive via CDP Page.captureSnapshot — DevTools 'Save as MHTML' parity. Perfect tamper-evident run evidence; optionally downloads the .mhtml file.",
      inputSchema: {
        type: "object",
        properties: {
          download: { type: "boolean", default: false, description: "Save the .mhtml to Downloads." },
          filename: { type: "string", description: "Download filename." },
          returnData: { type: "boolean", description: "Force the full MHTML into the result even when large." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_cache_control",
      description:
        "Chrome cache control (DevTools parity): disable the HTTP cache for this tab (requests always hit the network), re-enable it, or clear the browser cache — essential for testing cache-sensitive flows and fresh-load behavior.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["disable", "enable", "clear"], default: "clear" },
          clearFirst: { type: "boolean", default: true, description: "With action=disable, also clear the existing cache." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_visual_baseline",
      description:
        "Playwright toHaveScreenshot() parity: saves named PNG baselines of a page and compares future screenshots against them (pixel diff + heatmap evidence). Missing baselines auto-create on first compare; updateBaseline:true accepts the new look after an intentional change.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["save", "compare", "list", "clear"], description: "Lifecycle." },
          name: { type: "string", description: "Baseline name, e.g. 'checkout-page'." },
          threshold: { type: "number", minimum: 0, maximum: 1, default: 0.05, description: "compare passes when diffPercent ≤ threshold." },
          updateBaseline: { type: "boolean", default: false, description: "On failed compare, overwrite the baseline with the current screenshot." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser (name or install id)." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000 },
        },
        additionalProperties: false,
      },
    },
  ];
}
