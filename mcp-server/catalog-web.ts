// Web bridge tool definitions (browser access for AI agents). Kept separate
// from catalog.ts so the shared catalog stays under the file-size budget.
// These run the user's real browser tabs through the ScreenSync browser
// extension, mirroring the phone control surface. They require the extension
// to be paired to this hub with Web access enabled.

export function webToolDefinitions() {
  return [
    {
      name: "web_status",
      description:
        "Reports whether the ScreenSync browser extension is connected and Web access is enabled, plus the currently active browser tab. Always call this before any web_* action.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_screenshot",
      description:
        "Captures the currently active browser tab as an inline image (what the user is actually looking at). Requires the extension connected with Web access enabled.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_navigate",
      description: "Navigates the active browser tab to a URL (or opens it in a new tab).",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", maxLength: 2000 },
          newTab: { type: "boolean", default: false, description: "Open in a new tab instead of navigating the active one." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_click",
      description:
        "Clicks an element on the active browser tab. Locate it by visible text, CSS selector, or index from web_hierarchy. Prefer text for reliability.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 200, description: "Visible text of the element to click." },
          selector: { type: "string", maxLength: 300, description: "CSS selector of the element to click." },
          index: { type: "integer", minimum: 0, description: "Index from web_hierarchy.interactive list." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_type",
      description: "Types text into an input/textarea on the active tab, located by selector, index, or label placeholder.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", maxLength: 5000 },
          selector: { type: "string", maxLength: 300 },
          index: { type: "integer", minimum: 0, description: "Index from web_hierarchy.interactive list." },
          submit: { type: "boolean", default: false, description: "Press Enter/submit after typing." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_scroll",
      description: "Scrolls the active browser tab in a direction.",
      inputSchema: {
        type: "object",
        required: ["direction"],
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "number", minimum: 0.1, maximum: 1, default: 0.6, description: "Fraction of the viewport to travel." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_hierarchy",
      description:
        "Returns a structured snapshot of the active browser tab: title, URL, visible text, and a list of interactive elements (with indexes for web_click/web_type). Use to locate elements precisely instead of guessing.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
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
  ];
}

// Agent-facing skills (MCP prompts) for the browser extension. Message
// builders live in prompts.ts; these definitions are what clients list.
export function webSkillDefinitions() {
  return [
    {
      name: "web_see_and_report",
      description:
        "Looks at the user's live browser tab (web_screenshot + web_hierarchy) and explains what is on it — the 'what am I looking at?' skill.",
      arguments: [
        { name: "focus", description: "Optional focus, e.g. 'checkout state' or 'error messages'.", required: false },
      ],
    },
    {
      name: "web_form_autofill",
      description:
        "Fills and submits a form on the user's live tab using web_hierarchy indexes — no selector guessing, verifies the result visually.",
      arguments: [
        { name: "goal", description: "Which form and outcome, e.g. 'submit the contact form'.", required: true },
        { name: "data", description: "Optional values to fill, e.g. 'name=Ada, email=ada@x.com'.", required: false },
      ],
    },
    {
      name: "web_visual_qa",
      description:
        "Audits a URL in the user's real browser — scrolls the whole page, screenshots each viewport, and reports layout/a11y defects with evidence.",
      arguments: [
        { name: "url", description: "Page to audit (omit to audit the current tab).", required: false },
        { name: "focus", description: "Optional focus, e.g. 'mobile nav' or 'contrast'.", required: false },
      ],
    },
    {
      name: "web_reproduce_issue",
      description:
        "Reproduces a reported web bug step-by-step in the user's actual browser with before/after screenshot evidence and a divergence report.",
      arguments: [
        { name: "steps", description: "Repro steps, e.g. '1. open /cart 2. click Checkout 3. submit empty'.", required: true },
        { name: "expected", description: "What should happen, so deviation is obvious.", required: false },
      ],
    },
    {
      name: "web_debug_session",
      description:
        "Full debug session: reproduces an issue while collecting console errors, network failures, and dialog evidence, then reports root-cause findings with a final screenshot.",
      arguments: [
        { name: "steps", description: "What to do on the page, e.g. 'click Login with empty fields'.", required: true },
        { name: "symptom", description: "The reported symptom, e.g. 'button does nothing'.", required: false },
      ],
    },
    {
      name: "web_watch_flow",
      description:
        "Realtime observation: starts web_watch on the live tab, performs the action while it records, then narrates every captured frame in order like a video review.",
      arguments: [
        { name: "action", description: "What to do while watching, e.g. 'submit the form' or 'scroll to the footer'.", required: true },
        { name: "durationMs", description: "Watch window in ms (1000-10000, default 6000).", required: false },
      ],
    },
    {
      name: "web_perf_audit",
      description:
        "Performance audit of a page in the real browser: loads it, reads web_perf metrics (FCP/LCP/CLS/load), screenshots it, and gives prioritized optimization recommendations.",
      arguments: [
        { name: "url", description: "Page to audit (omit to audit the current tab).", required: false },
      ],
    },
    {
      name: "web_multitab_workflow",
      description:
        "Multi-tab workflow: opens pages in separate tabs, switches between them with web_tabs/web_tab, acts in each, and checkpoint-screenshots every tab before summarizing.",
      arguments: [
        { name: "urls", description: "Comma-separated URLs to open, e.g. 'https://a.com, https://b.com'.", required: true },
        { name: "goal", description: "What to accomplish across the tabs.", required: true },
      ],
    },
  ];
}
