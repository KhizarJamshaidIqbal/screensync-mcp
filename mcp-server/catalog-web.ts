// Web bridge tool definitions (browser access for AI agents). Kept separate
// from catalog.ts so the shared catalog stays under the file-size budget.
// These run the user's real browser tabs through the ScreenSync browser
// extension, mirroring the phone control surface. They require the extension
// to be paired to this hub with Web access enabled.
import { agentWebToolDefinitions } from "./catalog-web-agent.js";
import { operatorWebToolDefinitions } from "./catalog-web-operator.js";

export function webToolDefinitions() {
  return [
    {
      name: "web_status",
      description:
        "Reports whether the ScreenSync browser extension is connected and Web access is enabled, plus the currently active browser tab. Always call this before any web_* action.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_extension_reload",
      description: "Triggers a programmatic hot reload of the unpacked ScreenSync Chrome extension from disk.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_screenshot",
      description:
        "Captures the currently active browser tab as an inline image (what the user is actually looking at). Requires the extension connected with Web access enabled.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["png", "jpeg"], default: "jpeg", description: "Image format — use png for deterministic visual baselines." },
          tabId: { type: "integer", description: "Optional background tab ID." },
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
      name: "web_session_save",
      description:
        "Saves all cookies and local storage items for the current tab's origin into a portable JSON session state.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_session_restore",
      description:
        "Restores cookies and local storage from a previously saved session blob into the current tab's origin.",
      inputSchema: {
        type: "object",
        required: ["session"],
        properties: {
          session: { type: "object", description: "The session object containing cookies and localStorage." },
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
      name: "web_stealth_cloak",
      description:
        "Injects anti-detection stealth cloak into the browser tab via CDP. Masks navigator.webdriver, spoofs standard desktop plugins/languages, mimics real chrome runtime/loadTimes, and spoofs WebGL GPU vendor strings to bypass bot detection.",
      inputSchema: {
        type: "object",
        properties: {},
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
      name: "web_human_mouse",
      description:
        "Executes a human-like, anti-bot mouse movement and click using cubic Bézier curves, randomized micro-jitter, and natural dwell timing via CDP. Bypasses Cloudflare Turnstile, Datadome, and bot detection heuristics.",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number", description: "Target X coordinate (viewport px)." },
          y: { type: "number", description: "Target Y coordinate (viewport px)." },
          selector: { type: "string", description: "CSS selector of element to click with human trajectory." },
          text: { type: "string", description: "Visible text of element to click with human trajectory." },
          click: { type: "boolean", default: true, description: "Whether to click upon reaching destination." },
          steps: { type: "integer", minimum: 5, maximum: 100, default: 25, description: "Interpolation steps along the curve." },
          dwellMs: { type: "integer", minimum: 10, maximum: 2000, default: 120, description: "Dwell time before clicking in ms." },
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
        "Captures a pixel-perfect cropped screenshot of a specific DOM element using Chrome DevTools Protocol clip capture. Supports Playwright locators (e.g. xpath=, role=, text=, placeholder=, label=) and standard CSS selectors.",
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
    {
      name: "web_emulate",
      description:
        "Emulates device viewport (e.g. mobile/tablet screen dimensions, scale factor), color scheme preference (dark/light mode), geolocation coordinates, and network throttling presets (3G, 4G, offline) via CDP.",
      inputSchema: {
        type: "object",
        properties: {
          viewport: {
            type: "object",
            properties: {
              width: { type: "integer", minimum: 100, maximum: 4000 },
              height: { type: "integer", minimum: 100, maximum: 4000 },
              deviceScaleFactor: { type: "number", minimum: 1, maximum: 3, default: 1 },
              mobile: { type: "boolean", default: false },
            },
          },
          colorScheme: { type: "string", enum: ["dark", "light", "none"] },
          geolocation: {
            type: "object",
            required: ["latitude", "longitude"],
            properties: {
              latitude: { type: "number" },
              longitude: { type: "number" },
              accuracy: { type: "number", default: 100 },
            },
          },
          network: { type: "string", enum: ["online", "offline", "slow3g", "fast3g", "4g"] },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_upload_file",
      description:
        "Uploads local files into <input type=\"file\"> elements or drag-and-drop file dropzones. Supports both native local file paths (via CDP DOM.setFileInputFiles) and base64/data URLs.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", default: "input[type=\"file\"]", description: "Selector for the file input element." },
          filePath: { type: "string", description: "Absolute local file path on disk (e.g. C:/images/photo.png)." },
          files: { type: "array", items: { type: "string" }, description: "Array of absolute local file paths for multi-file inputs." },
          fileName: { type: "string", description: "File name when providing base64Data." },
          base64Data: { type: "string", description: "Base64 encoded file data (alternative to local filePath)." },
          mimeType: { type: "string", description: "MIME type when providing base64Data (e.g. 'image/png')." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_drag_and_drop",
      description:
        "Performs HTML5 drag-and-drop (dragstart→dragover→drop→dragend) between a source element and a target drop element. Supports CSS selectors or Playwright locators, optional text filters, and coordinate-based drag offsets.",
      inputSchema: {
        type: "object",
        required: ["sourceSelector", "targetSelector"],
        properties: {
          sourceSelector: { type: "string", description: "CSS selector or locator of the element to drag." },
          targetSelector: { type: "string", description: "CSS selector or locator of the drop target element." },
          sourceText: { type: "string", description: "Text filter for the source element." },
          targetText: { type: "string", description: "Text filter for the target element." },
          sourceX: { type: "integer", description: "Optional source start X coordinate." },
          sourceY: { type: "integer", description: "Optional source start Y coordinate." },
          targetX: { type: "integer", description: "Optional target drop X coordinate." },
          targetY: { type: "integer", description: "Optional target drop Y coordinate." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_load_state",
      description:
        "Waits until the active tab reaches a desired navigation or load state: 'load', 'domcontentloaded', or 'networkidle' (no network requests for 500ms). Fully mirrors Playwright page.waitForLoadState.",
      inputSchema: {
        type: "object",
        properties: {
          state: { type: "string", enum: ["load", "domcontentloaded", "networkidle"], default: "load", description: "Target load state." },
          timeoutMs: { type: "integer", minimum: 500, maximum: 60000, default: 15000, description: "Maximum wait time in ms." },
          idleMs: { type: "integer", minimum: 100, maximum: 5000, default: 500, description: "Idle silence period for networkidle in ms." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_profile_sync",
      description:
        "Discovers authenticated user accounts and real logged-in sessions across social and web platforms in the user's live Chrome browser (X/Twitter, LinkedIn, Facebook, Instagram, Reddit, GitHub, or custom domains) without exposing credentials.",
      inputSchema: {
        type: "object",
        properties: {
          platforms: {
            type: "array",
            items: { type: "string" },
            description: "List of platforms to check (defaults to twitter, github, facebook, linkedin, instagram, reddit).",
          },
          domain: { type: "string", description: "Optional custom domain to inspect session cookies for (e.g. 'cutomsofaprices.com')." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_batch_crawl",
      description:
        "Crawls and extracts structured data from multiple URLs in parallel using the user's real browser session (preserving logged-in cookies, Cloudflare clearance, and anti-bot bypass) across managed tab groups, with automatic memory cleanup.",
      inputSchema: {
        type: "object",
        required: ["urls"],
        properties: {
          urls: { type: "array", items: { type: "string" }, description: "List of http(s) URLs to scrape in parallel." },
          schema: { type: "object", description: "Optional extraction schema mapping field names to CSS selectors or attributes." },
          maxConcurrency: { type: "integer", minimum: 1, maximum: 10, default: 3, description: "Number of concurrent background tabs." },
          delayMs: { type: "integer", minimum: 0, maximum: 10000, default: 500, description: "Delay between batches in ms." },
          discardAfter: { type: "boolean", default: true, description: "Whether to close background tabs immediately after data extraction." },
          timeoutMs: { type: "integer", minimum: 2000, maximum: 60000, default: 20000, description: "Per-tab load timeout in ms." },
        },
        additionalProperties: false,
      },
    },

    // ── Phase 2: Previously missing tools (implemented but not exposed) ──

    {
      name: "web_paste",
      description: "Instant clipboard injection for long text or markdown into inputs or rich-text editors (Quill, Lexical, ProseMirror, Draft.js) via synthetic paste events.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "Text or markdown content to paste." },
          selector: { type: "string", maxLength: 300, description: "CSS selector of the target editor/input." },
          index: { type: "integer", minimum: 0, description: "Index from web_hierarchy interactive elements." },
          clear: { type: "boolean", default: true, description: "Clear previous editor contents before pasting." },
          submit: { type: "boolean", default: false, description: "Submit form or press Enter after pasting." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_clear",
      description: "Clears an input, textarea, or rich-text contenteditable element completely and dispatches input/change events.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", maxLength: 300, description: "CSS selector of target element." },
          index: { type: "integer", minimum: 0, description: "Index from web_hierarchy interactive elements." },
          text: { type: "string", maxLength: 200, description: "Visible text to locate target element." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_highlight",
      description: "Draws a pulsing neon purple border and glow around a target element and scrolls it into view for visual identification.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", maxLength: 300, description: "CSS selector of target element." },
          index: { type: "integer", minimum: 0, description: "Index from web_hierarchy interactive elements." },
          text: { type: "string", maxLength: 200, description: "Visible text to locate target element." },
          durationMs: { type: "integer", minimum: 500, maximum: 10000, default: 2500, description: "Duration to keep highlight visible." },
        },
        additionalProperties: false,
      },
    },

    // ── Phase 3: New Playwright-parity tools ──

    {
      name: "web_go_back",
      description: "Navigate the active tab back in browser history (equivalent to Playwright page.goBack()).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_go_forward",
      description: "Navigate the active tab forward in browser history (equivalent to Playwright page.goForward()).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_reload",
      description: "Reload the active tab, optionally bypassing the cache (equivalent to Playwright page.reload()).",
      inputSchema: {
        type: "object",
        properties: {
          bypassCache: { type: "boolean", default: false, description: "If true, bypasses the browser cache (hard reload)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_for_url",
      description: "Waits for the active tab's URL to match a pattern or substring, useful for detecting SPA navigations (equivalent to Playwright page.waitForURL()).",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "URL substring or regex pattern to match." },
          regex: { type: "boolean", default: false, description: "If true, treats url as a regex pattern." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 30000, default: 10000, description: "Maximum wait time." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_for_function",
      description: "Polls until a JavaScript expression evaluates to a truthy value (equivalent to Playwright page.waitForFunction()).",
      inputSchema: {
        type: "object",
        required: ["expression"],
        properties: {
          expression: { type: "string", description: "JavaScript expression that should evaluate to truthy when condition is met." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 30000, default: 10000, description: "Maximum wait time." },
          pollMs: { type: "integer", minimum: 50, maximum: 2000, default: 200, description: "Polling interval between checks." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_key_combo",
      description: "Presses keyboard combinations with modifier keys via CDP (e.g. Control+A, Shift+Tab, Control+C). Equivalent to Playwright page.keyboard.press('Control+A').",
      inputSchema: {
        type: "object",
        required: ["combo"],
        properties: {
          combo: { type: "string", description: "Key combination string, e.g. 'Control+A', 'Shift+Tab', 'Alt+F4', 'Control+Shift+I'." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_mouse",
      description: "Granular mouse control via CDP: move, down, up, click, dblclick, right-click, and mouse wheel. Equivalent to Playwright page.mouse.*.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["click", "move", "down", "up", "dblclick", "wheel", "contextmenu", "right-click"], default: "click", description: "Mouse action to perform." },
          x: { type: "number", description: "X coordinate on the page." },
          y: { type: "number", description: "Y coordinate on the page." },
          button: { type: "string", enum: ["left", "right", "middle"], default: "left", description: "Mouse button." },
          deltaX: { type: "number", description: "Horizontal scroll delta (for wheel action)." },
          deltaY: { type: "number", description: "Vertical scroll delta (for wheel action, negative = scroll up)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_touch",
      description: "Touchscreen events via CDP: tap at coordinates or swipe between two points. Equivalent to Playwright page.touchscreen.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["tap", "swipe"], default: "tap", description: "Touch action." },
          x: { type: "number", description: "Start X coordinate." },
          y: { type: "number", description: "Start Y coordinate." },
          endX: { type: "number", description: "End X coordinate (for swipe)." },
          endY: { type: "number", description: "End Y coordinate (for swipe)." },
          steps: { type: "integer", minimum: 2, maximum: 50, default: 10, description: "Number of intermediate touch move events (for swipe)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_cookies",
      description: "Granular cookie management: get, set, delete, or clear cookies for the active tab's domain via chrome.cookies API (includes httpOnly cookies). Equivalent to Playwright context.addCookies/clearCookies.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "delete", "clear"], default: "get", description: "Cookie action." },
          name: { type: "string", description: "Cookie name (required for set/delete, optional filter for get)." },
          value: { type: "string", description: "Cookie value (for set)." },
          domain: { type: "string", description: "Cookie domain (defaults to active tab hostname)." },
          path: { type: "string", default: "/", description: "Cookie path." },
          secure: { type: "boolean", description: "Secure flag." },
          httpOnly: { type: "boolean", description: "HttpOnly flag." },
          sameSite: { type: "string", enum: ["no_restriction", "lax", "strict"], description: "SameSite policy." },
          expirationDate: { type: "number", description: "Cookie expiration as Unix timestamp in seconds." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_grant_permissions",
      description: "Grants browser permissions (geolocation, camera, microphone, notifications, clipboard-read, etc.) to the active tab's origin via CDP Browser.grantPermissions. Equivalent to Playwright context.grantPermissions().",
      inputSchema: {
        type: "object",
        properties: {
          permissions: { type: "array", items: { type: "string" }, description: "List of permissions to grant, e.g. ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read']." },
          permission: { type: "string", description: "Single permission to grant (alternative to permissions array)." },
          origin: { type: "string", description: "Origin to grant permissions for (defaults to active tab origin)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_set_timezone",
      description: "Overrides the browser timezone via CDP Emulation.setTimezoneOverride. Equivalent to Playwright with timezone context option.",
      inputSchema: {
        type: "object",
        properties: {
          timezoneId: { type: "string", description: "IANA timezone ID, e.g. 'Asia/Karachi', 'America/New_York', 'Europe/London'." },
          timezone: { type: "string", description: "Alias for timezoneId." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_download",
      description: "Initiates a file download and waits for completion, returning filename, size, and MIME type. Equivalent to Playwright download handling.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "URL of the file to download." },
          filename: { type: "string", description: "Optional suggested filename." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 30000, description: "Maximum wait time for download completion." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_find",
      description: "Find DOM elements matching a CSS selector with optional text filter and nth selection. Returns count, coordinates, and element details. Equivalent to Playwright page.locator().nth().filter().",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to match elements." },
          text: { type: "string", description: "Filter elements by visible text content (case-insensitive contains)." },
          hasText: { type: "string", description: "Filter elements by text content (alias for text)." },
          nth: { type: "integer", description: "Select the nth matching element (0-based, negative counts from end)." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Maximum number of matches to return details for." },
          highlight: { type: "boolean", default: true, description: "Whether to show a ripple on the selected element." },
        },
        additionalProperties: false,
      },
    },

    // ── Next-Gen Features: Social Scraper, SoM Overlay & Playwright Parity ──

    {
      name: "web_som_overlay",
      description: "Set-of-Marks (SoM) visual overlay: renders numbered badge pins (1, 2, 3...) on all interactive DOM elements (buttons, links, inputs). Eliminates selector guessing for visual AI models like Claude Computer Use / GPT-4o.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 10, maximum: 150, default: 60, description: "Maximum badges to render." },
          color: { type: "string", default: "#EF4444", description: "Badge background hex color." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_remove_overlay",
      description: "Removes all Set-of-Marks numbered badge overlays rendered on the page, restoring clean DOM appearance.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_assert",
      description: "Playwright-grade smart assertions with auto-retry: asserts visible, not_visible, has_text, has_value, has_count, matches_url, or matches_title.",
      inputSchema: {
        type: "object",
        required: ["condition"],
        properties: {
          condition: { type: "string", enum: ["visible", "not_visible", "has_text", "has_value", "has_count", "matches_url", "matches_title"], description: "Assertion condition to verify." },
          selector: { type: "string", description: "Target CSS selector." },
          text: { type: "string", description: "Expected text substring." },
          value: { type: "string", description: "Expected input value." },
          count: { type: "integer", description: "Expected matching element count." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_scrape",
      description: "Authenticated live social media data extractor: leverages user's existing logged-in browser session to extract handles, stats, feeds, and notifications without requiring passwords or API keys.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["twitter", "x", "github", "linkedin", "facebook", "reddit", "all"], default: "all", description: "Platform to scrape." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 25000, description: "Per-platform load timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_post",
      description: "Authenticated social media publisher: composes and publishes posts directly on Twitter/X or LinkedIn using the active logged-in browser session and human-like typing.",
      inputSchema: {
        type: "object",
        required: ["platform", "text"],
        properties: {
          platform: { type: "string", enum: ["twitter", "x", "linkedin"], description: "Target social network." },
          text: { type: "string", description: "Content text to publish." },
          submit: { type: "boolean", default: false, description: "If true, clicks the final post/tweet button. If false, drafts without publishing." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_tab_pool",
      description: "Multi-tab background worker pool: create, list, and close parallel background tabs grouped in Chrome for concurrent AI operations.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["create", "list", "close"], description: "Pool action." },
          urls: { type: "array", items: { type: "string" }, description: "List of URLs for create action." },
          tabIds: { type: "array", items: { type: "integer" }, description: "List of tab IDs for close action." },
          title: { type: "string", default: "Agent Tab Pool", description: "Tab group title." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_storage_state",
      description: "Playwright-compatible storage export/import: exports or imports cookies and localStorage in canonical Playwright storageState JSON format.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["export", "import"], description: "Storage state action." },
          storageState: { type: "object", description: "Playwright storage state object for import action." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_route",
      description: "Playwright page.route() dynamic network interception: fulfill with custom response, continue with modified headers/payload, or abort requests via CDP Fetch.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["route", "unroute", "clear", "list"], default: "route", description: "Routing action." },
          urlPattern: { type: "string", default: "*", description: "URL pattern to intercept (glob or substring)." },
          mode: { type: "string", enum: ["fulfill", "continue", "abort"], default: "fulfill", description: "Route handling mode." },
          headers: { type: "array", items: { type: "object" }, description: "Modified headers for continue mode." },
          postData: { type: "string", description: "Modified request body string for continue mode." },
          response: { type: "object", description: "Custom response for fulfill mode: { status, headers, body }." },
          errorReason: { type: "string", enum: ["Failed", "Aborted", "TimedOut", "ConnectionRefused"], default: "Failed", description: "Failure reason for abort mode." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_dialog_rule",
      description: "Proactive JavaScript dialog auto-answer rule: configures automatic acceptance, dismissal, or prompt responses for alerts and confirms via CDP Page domain.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["accept", "dismiss", "prompt", "clear"], default: "accept", description: "Dialog rule action." },
          promptText: { type: "string", description: "Optional text response for window.prompt dialogs." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_coverage",
      description: "Playwright page.coverage JS and CSS code coverage tracking: records exact bytes used vs dead code across all scripts on the page using CDP Profiler.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["start", "stop", "get"], description: "Coverage tracking action." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_set_geolocation",
      description: "Playwright context.setGeolocation: overrides browser latitude, longitude, and accuracy via CDP Emulation.setGeolocationOverride and navigator.geolocation proxy.",
      inputSchema: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Latitude in degrees (-90 to 90)." },
          longitude: { type: "number", description: "Longitude in degrees (-180 to 180)." },
          accuracy: { type: "number", default: 100, description: "Accuracy in meters." },
          clear: { type: "boolean", default: false, description: "If true, clears geolocation override." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_throttle_network",
      description: "Playwright network throttling: simulates Offline, Slow 3G, Fast 3G, or custom latency and throughput conditions via CDP Network.emulateNetworkConditions.",
      inputSchema: {
        type: "object",
        properties: {
          preset: { type: "string", enum: ["offline", "slow3g", "fast3g", "none", "online"], description: "Standard network simulation preset." },
          offline: { type: "boolean", description: "True to simulate offline mode." },
          latency: { type: "number", description: "Additional latency in milliseconds." },
          downloadThroughput: { type: "number", description: "Max download throughput in bytes/sec (-1 for unlimited)." },
          uploadThroughput: { type: "number", description: "Max upload throughput in bytes/sec (-1 for unlimited)." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_set_color_scheme",
      description: "Playwright page.emulateMedia({ colorScheme }): overrides CSS prefers-color-scheme media feature (dark, light, or no-preference) via CDP Emulation.",
      inputSchema: {
        type: "object",
        properties: {
          colorScheme: { type: "string", enum: ["dark", "light", "no-preference"], default: "dark", description: "Desired color scheme." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_clipboard",
      description: "Playwright clipboard access: reads from or writes text to the page/system clipboard via navigator.clipboard and execCommand fallback.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["read", "write"], description: "Clipboard action." },
          text: { type: "string", description: "Text to write into clipboard for 'write' action." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_markdown_extract",
      description: "ChatGPT / SearchGPT semantic reader view: strips ads, tracking scripts, and navbars; converts article/body into clean GitHub-flavored markdown with metadata for token-efficient LLM consumption.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_matrix",
      description: "Real-browser authenticated identity matrix: scans user's active cookies and open tabs across X/Twitter, GitHub, LinkedIn, Facebook, Instagram, Reddit, Google, and WordPress without requiring credentials.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Optional custom domain to inspect." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_sync",
      description: "Authenticated background data synchronizer: extracts structured feeds, notifications, or search results directly from the user's logged-in session without user disruption.",
      inputSchema: {
        type: "object",
        required: ["platform"],
        properties: {
          platform: { type: "string", enum: ["x", "twitter", "github", "reddit", "linkedin"], description: "Target social network." },
          task: { type: "string", enum: ["feed", "notifications", "bookmarks", "search", "trending"], default: "feed", description: "Data extraction task." },
          query: { type: "string", description: "Search query for 'search' task." },
          subreddit: { type: "string", description: "Subreddit name for Reddit platform." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "Maximum items to extract." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_multi_tab_sync",
      description: "Parallel multi-tab batch extraction pipeline: runs background tasks in native Chrome Tab Groups without disturbing the user's active window and returns aggregated results.",
      inputSchema: {
        type: "object",
        required: ["tasks"],
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              required: ["url"],
              properties: {
                url: { type: "string", description: "Target web URL." },
                extract: { type: "string", enum: ["markdown", "schema", "eval"], default: "markdown", description: "Extraction mode." },
                schema: { type: "object", description: "Key-to-selector mapping for schema mode." },
                expression: { type: "string", description: "JavaScript expression for eval mode." },
              },
            },
            description: "List of extraction tasks to run in parallel.",
          },
          concurrency: { type: "integer", minimum: 1, maximum: 6, default: 3, description: "Max parallel worker tabs." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 25000, description: "Per-tab timeout." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_for_response",
      description: "Playwright page.waitForResponse(): intercepts and captures network response body matching a URL pattern/glob and optional status code via CDP Network events.",
      inputSchema: {
        type: "object",
        required: ["urlPattern"],
        properties: {
          urlPattern: { type: "string", description: "URL substring or regex pattern to wait for." },
          status: { type: "integer", description: "Optional HTTP status code to match (e.g. 200)." },
          method: { type: "string", description: "Optional HTTP method to match (e.g. POST, GET)." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 60000, default: 15000, description: "Max wait timeout in ms." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_wait_for_request",
      description: "Playwright page.waitForRequest(): waits until a network request matching a URL pattern/glob is dispatched and captures its headers and postData.",
      inputSchema: {
        type: "object",
        required: ["urlPattern"],
        properties: {
          urlPattern: { type: "string", description: "URL substring or regex pattern to wait for." },
          method: { type: "string", description: "Optional HTTP method (e.g. POST, GET)." },
          timeoutMs: { type: "integer", minimum: 1000, maximum: 60000, default: 15000, description: "Max wait timeout in ms." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_websocket_traffic",
      description: "Monitors and inspects incoming and outgoing WebSocket frames (chat, crypto, live notifications) on the active tab via CDP Network events.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "get", "stop"], default: "get", description: "WebSocket tracking action." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_human_type",
      description: "Bypasses anti-bot typing detection (Akamai, DataDome, Cloudflare, reCAPTCHA v3) using Gaussian-distributed human keystroke intervals, realistic dwell times, and natural hesitation pauses.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string", description: "Text to type into focused element." },
          selector: { type: "string", description: "Optional selector to focus before typing." },
          wpm: { type: "integer", minimum: 20, maximum: 140, default: 75, description: "Target typing speed in Words Per Minute." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_human_scroll",
      description: "Smooth inertia trackpad/wheel scrolling using cubic Bézier ease-out deceleration across realistic micro-steps to evade bot detection.",
      inputSchema: {
        type: "object",
        properties: {
          deltaY: { type: "number", default: 400, description: "Vertical scroll distance in pixels." },
          deltaX: { type: "number", default: 0, description: "Horizontal scroll distance in pixels." },
          durationMs: { type: "integer", minimum: 100, maximum: 3000, default: 500, description: "Duration of the inertial scroll." },
          x: { type: "number", default: 400, description: "Mouse cursor X coordinate." },
          y: { type: "number", default: 400, description: "Mouse cursor Y coordinate." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
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
    {
      name: "web_keep_alive",
      description: "Prevents Chrome Memory Saver from freezing or discarding background worker tabs during long-running scraping, crawler, or data-sync pipelines.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["protect", "release"], default: "protect", description: "Keepalive action." },
          tabId: { type: "integer", description: "Optional background tab ID." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_feed_cluster",
      description: "One-shot multi-platform aggregated feed extraction: queries authenticated sessions (X/Twitter, GitHub, LinkedIn, Reddit) simultaneously in background tabs and returns unified chronological intelligence.",
      inputSchema: {
        type: "object",
        properties: {
          platforms: {
            type: "array",
            items: { type: "string" },
            description: "Target platforms (e.g. ['x', 'github', 'linkedin', 'reddit']). Omit to query all authenticated accounts.",
          },
          limit: { type: "integer", minimum: 1, maximum: 20, default: 5, description: "Max items per platform." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_dossier",
      description: "Deep authenticated profile inspection: extracts follower count, following count, bio, verified status, pinned items, and recent posts without requiring API keys.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["github", "x", "twitter", "linkedin", "reddit"], default: "github", description: "Target social network." },
          targetHandle: { type: "string", description: "Optional target username/handle. Omit to inspect the user's own authenticated profile." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 25000, description: "Timeout in ms." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_social_search",
      description: "Authenticated social search: queries X/Twitter, GitHub, or Reddit using the user's logged-in browser session and extracts clean structured results.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          platform: { type: "string", enum: ["github", "x", "twitter", "reddit"], default: "github", description: "Target network." },
          query: { type: "string", description: "Search query string." },
          limit: { type: "integer", minimum: 1, maximum: 30, default: 10, description: "Max search results." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 25000, description: "Timeout in ms." },
        },
        additionalProperties: false,
      },
    },
    ...agentWebToolDefinitions(),
    ...operatorWebToolDefinitions(),
  ];
}

// Agent-facing skills (MCP prompts) for the browser extension. Message
// builders live in prompts.ts; these definitions are what clients list.
export function webSkillDefinitions() {
  return [
    {
      name: "screensync_operator",
      description:
        "Master Operator Prompt for ScreenSync MCP: Senior cognitive OODA loop across both live Chrome browser tabs and live Android mobile devices. Includes zero-fail rich-text publishing, hardware CDP actions, autonomous DOM/visual verification, full-page scrolling screenshots, and cross-platform automation.",
      arguments: [
        { name: "task", description: "The web or mobile task to execute autonomously.", required: true },
      ],
    },
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
    {
      name: "web_social_publish",
      description:
        "Autonomous Social Publisher for web platforms (X/Twitter, LinkedIn, Facebook, Instagram, Reddit, Threads): conducts policy checks, pre-fills state via direct intent URLs or multi-layer ContentEditable input, clicks publish, and autonomously verifies timeline appearance and permalink without asking the user.",
      arguments: [
        { name: "platform", description: "Target social platform (e.g. 'X (Twitter)', 'LinkedIn', 'Facebook', 'Reddit').", required: true },
        { name: "content", description: "The full text content, hashtags, and links to publish.", required: true },
        { name: "mediaUrl", description: "Optional image or video URL to attach.", required: false },
      ],
    },
    {
      name: "web_autonomous_agent",
      description:
        "Complete OODA Loop Browser Agent (Observe, Orient, Decide, Act, Verify): navigates complex modern SPAs, handles dynamic overlays and cookie consent, auto-recovers from failures, and autonomously verifies all state transitions.",
      arguments: [
        { name: "task", description: "The complete user goal or multi-step workflow to execute.", required: true },
      ],
    },
  ];
}
