// The "Advanced toolkit (Playwright-grade)" run of web tool definitions: eval, console and network reads,
// dialogs, storage, tabs, waits and keys, CDP input and eval, the accessibility tree, DOM diffs, network rules,
// mocks and HAR export, and frames. Split out of catalog-web.ts (repo rule: no source file over 500 lines) and
// spread back into webToolDefinitions() at its old position, so the tool list and its order are unchanged.

import type { WebToolDef } from "./catalog-web-agent-core.js";

export function advancedWebToolDefinitions(): WebToolDef[] {
  return [
    // ── Advanced toolkit (Playwright-grade) ──
    {
      name: "web_eval",
      description:
        "Evaluates a JavaScript expression in the active tab's page context (like Playwright's page.evaluate) and returns the JSON-safe result. Use for reading state the DOM snapshot doesn't expose, or one-off computations.",
      inputSchema: {
        type: "object",
        required: ["expression"],
        properties: { expression: { type: "string", maxLength: 5000, description: "JS expression, e.g. document.title or [...document.links].length" } },
        additionalProperties: false,
      },
    },
    {
      name: "web_console",
      description:
        "Reads console output captured from the active tab (log/info/warn/error/debug plus page errors and unhandled rejections). Hooks install on first call; navigation resets them. Use sinceCursor from a previous call to fetch only new entries.",
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["log", "info", "warn", "error", "debug", "pageerror"], description: "Return only this level." },
          sinceCursor: { type: "integer", minimum: 0, description: "Only entries with id greater than this cursor." },
          clear: { type: "boolean", default: false, description: "Empty the buffer after reading." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_network",
      description:
        "Reads fetch/XHR requests captured from the active tab (method, url, status, durationMs). Hooks install on first call and capture only requests made AFTER installation; trigger the action first, then read.",
      inputSchema: {
        type: "object",
        properties: {
          sinceCursor: { type: "integer", minimum: 0, description: "Only entries with id greater than this cursor." },
          clear: { type: "boolean", default: false, description: "Empty the buffer after reading." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_dialog",
      description:
        "Reads alert/confirm/prompt dialogs intercepted on the active tab. Dialogs are auto-handled (alert dismissed, confirm accepted, prompt answered with its default) so automation never blocks.",
      inputSchema: {
        type: "object",
        properties: {
          sinceCursor: { type: "integer", minimum: 0, description: "Only entries with id greater than this cursor." },
          clear: { type: "boolean", default: false, description: "Empty the buffer after reading." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_storage",
      description:
        "Reads or writes the active tab's localStorage, sessionStorage, or (read-only) document.cookie. httpOnly cookies are not visible to page scripts.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "clear"], default: "get" },
          type: { type: "string", enum: ["local", "session", "cookie"], default: "local" },
          key: { type: "string", maxLength: 500, description: "Key for get/set of a single entry." },
          value: { type: "string", maxLength: 5000, description: "Value for set." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_perf",
      description:
        "Returns the active tab's performance metrics: DOMContentLoaded/load/FCP/LCP timing, CLS, resource count, and the 5 slowest resources.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_tabs",
      description: "Lists the browser's open tabs in the current window (tabId, url, title, active).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_tab",
      description: "Manages tabs: open a URL in a new tab, switch focus to a tab by id, or close a tab.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["open", "switch", "close"] },
          url: { type: "string", maxLength: 2000, description: "http(s) URL for action=open." },
          tabId: { type: "integer", description: "Tab id from web_tabs for switch/close." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_for",
      description:
        "Waits until a CSS selector exists or a text appears on the active tab (like Playwright's waitForSelector/waitForText). Use after actions that trigger async updates.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", maxLength: 300, description: "CSS selector to wait for." },
          text: { type: "string", maxLength: 300, description: "Visible text to wait for (alternative to selector)." },
          timeoutMs: { type: "integer", minimum: 200, maximum: 15000, default: 5000 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_key",
      description:
        "Presses a key on the focused element of the active tab (Enter, Tab, Escape, ArrowDown, single characters...). Enter inside a form submits it.",
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string", maxLength: 20, description: "Key name, e.g. Enter, Tab, Escape, ArrowDown, or a single character." } },
        additionalProperties: false,
      },
    },
    {
      name: "web_hover",
      description: "Hovers an element on the active tab (fires mouseover/mouseenter/mousemove), located by selector, visible text, or index.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", maxLength: 300 },
          text: { type: "string", maxLength: 200 },
          index: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_select",
      description: "Selects an option in a <select> on the active tab by its value or visible option text (fires input+change).",
      inputSchema: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string", maxLength: 300, description: "Option value, or the option's visible text." },
          selector: { type: "string", maxLength: 300, description: "CSS selector of the <select> (defaults to the first one)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_watch",
      description:
        "Watches the active tab like a realtime video: captures frames every ~500ms (the browser's 2fps capture ceiling), skips identical ones via pixel diffing, and returns EVERY changed frame as images — analyze them frame-by-frame in order. Frames are also streamed live over SSE (web_frame).",
      inputSchema: {
        type: "object",
        properties: {
          durationMs: { type: "integer", minimum: 1000, maximum: 10000, default: 6000, description: "How long to watch." },
          maxFrames: { type: "integer", minimum: 1, maximum: 20, default: 12, description: "Stop early after this many changed frames." },
          quality: { type: "integer", minimum: 20, maximum: 90, default: 60, description: "JPEG quality." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_cdp_click",
      description:
        "Dispatches a 100% genuine hardware mouse click via Chrome DevTools Protocol (CDP) with isTrusted=true. Use when SPAs or rich-text editors ignore synthetic clicks.",
      inputSchema: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "number", description: "X coordinate in viewport pixels." },
          y: { type: "number", description: "Y coordinate in viewport pixels." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_cdp_type",
      description:
        "Dispatches 100% genuine hardware keystrokes via Chrome DevTools Protocol (CDP) with isTrusted=true. Fully updates Quill, Lexical, React, and Ember editor models.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", maxLength: 5000, description: "Text to type via hardware keystrokes." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_scrape_schema",
      description:
        "Extracts repeated structured elements from the active tab according to a schema map (e.g. { title: 'h3', price: '.price', link: 'a@href' }). Returns clean structured JSON rows.",
      inputSchema: {
        type: "object",
        properties: {
          itemSelector: { type: "string", description: "CSS selector matching each container card/item/row." },
          schema: { type: "object", description: "Map of key to CSS selector or selector@attribute to extract." },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100, description: "Maximum items to extract." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_cdp_eval",
      description:
        "Evaluates a JavaScript expression via Chrome DevTools Protocol (CDP Runtime.evaluate). Completely bypasses page Content Security Policy (CSP), unsafe-eval restrictions, and sandbox limits.",
      inputSchema: {
        type: "object",
        required: ["expression"],
        properties: {
          expression: { type: "string", description: "JavaScript expression to evaluate via CDP." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_a11y_tree",
      description:
        "Retrieves Chrome's internal Accessibility Tree (AXTree) via CDP. Provides a compact, token-efficient semantic hierarchy (roles, names, values, states) optimized for LLMs with zero HTML markup noise.",
      inputSchema: {
        type: "object",
        properties: {
          maxNodes: { type: "integer", minimum: 10, maximum: 300, default: 120, description: "Maximum accessibility nodes to return." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_dom_diff",
      description:
        "Captures a structural DOM snapshot and compares against a previous snapshot. Returns added/removed nodes, modal appearances, toast messages, and URL changes for 100% autonomous verification.",
      inputSchema: {
        type: "object",
        properties: {
          previous: { type: "object", description: "The previous snapshot object to diff against." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_extension_diagnostics",
      description:
        "Returns comprehensive extension diagnostics: manifest permissions, local storage bytes in use, active alarms, total open tabs, tab groups, and browser platform info.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "web_network_rules",
      description:
        "Manages Declarative Net Request (DNR) dynamic rules: strip X-Frame-Options/CSP frame-ancestors to embed any site in side panels/iframes, inject custom request headers, list active rules, or clear rules.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["list", "clear", "allow_framing", "strip_headers", "inject_headers"], description: "Rule action to perform." },
          ruleId: { type: "integer", description: "Optional specific rule ID (default 1001/1002)." },
          urlFilter: { type: "string", default: "*", description: "URL filter pattern for the rule." },
          domains: { type: "array", items: { type: "string" }, description: "Optional list of initiator domains." },
          headers: { type: "array", items: { type: "object" }, description: "Custom request headers to inject." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_export_har",
      description:
        "Exports a structured HTTP Archive (HAR 1.2) containing all network requests and responses captured by the extension on the active tab, with timestamps, durations, and HTTP statuses.",
      inputSchema: {
        type: "object",
        properties: {
          clear: { type: "boolean", default: false, description: "Clear the network buffer after exporting." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_sandbox_group",
      description:
        "Manages multi-tab sandboxes and memory discard: create named color-coded tab groups, list groups and tab members, discard background tabs to reclaim RAM without losing URLs, or close groups.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["list", "create", "discard", "discard_all_inactive", "close_group"], description: "Sandbox group action." },
          groupId: { type: "integer", description: "Group ID for close_group." },
          tabId: { type: "integer", description: "Specific tab ID to discard." },
          tabIds: { type: "array", items: { type: "integer" }, description: "List of tab IDs for create." },
          title: { type: "string", default: "Agent Sandbox", description: "Group title." },
          color: { type: "string", enum: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"], default: "cyan", description: "Group color." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_frame_tree",
      description:
        "Discovers all frames and nested sandboxed iframes (cross-origin or same-origin) on the active tab using webNavigation. Returns frame IDs, URLs, and parent-child hierarchy.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "web_frame_exec",
      description:
        "Executes JavaScript directly inside an isolated cross-origin or sandboxed iframe by frameId (e.g. Stripe checkout, OAuth dialogs, Turnstile widget).",
      inputSchema: {
        type: "object",
        required: ["frameId"],
        properties: {
          frameId: { type: "integer", description: "Target frame ID from web_frame_tree." },
          code: { type: "string", description: "JavaScript code or expression to evaluate inside the iframe." },
          expression: { type: "string", description: "Alternative expression parameter." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_network_mock",
      description:
        "Intercepts network requests via CDP Fetch domain: mock API responses with custom JSON and HTTP status codes, inject network faults (Failed, ConnectionRefused, TimedOut), or disable mocking.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["mock_response", "fail_request", "disable"], description: "Action: mock response, fail request, or disable mocking." },
          urlPattern: { type: "string", default: "*", description: "URL pattern glob or substring to intercept." },
          status: { type: "integer", default: 200, description: "HTTP response status code." },
          body: { description: "Response body (string or JSON object/array)." },
          headers: { type: "array", items: { type: "object" }, description: "Response headers array of {name, value} objects." },
          errorReason: { type: "string", enum: ["Failed", "Aborted", "TimedOut", "AccessDenied", "ConnectionClosed", "ConnectionReset", "ConnectionRefused", "NameNotResolved", "InternetDisconnected"], default: "Failed", description: "CDP error reason for fail_request." },
        },
        additionalProperties: false,
      },
    },
  ];
}
