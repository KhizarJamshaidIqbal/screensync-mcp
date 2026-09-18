// Inspector & Parity tool definitions — Playwright parity and modern storage.
// Kept in a dedicated file to satisfy the 500-line budget rule.

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

export function inspectWebToolDefinitions(): WebToolDef[] {
  return [
    {
      name: "web_content",
      description:
        "Playwright page.content() parity: returns the full HTML string of the active document (including <!DOCTYPE>) or outerHTML of a specific selector/ref. Supports clean:true to strip scripts, styles, comments, and huge data-URIs.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref from web_get_by / web_aria_snapshot." },
          clean: { type: "boolean", default: false, description: "Strip <script>, <style>, comments, and base64 bloat for clean LLM reading." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_bounding_box",
      description:
        "Playwright locator.boundingBox() parity: returns precise element coordinates, dimensions, viewport status, and absolute page offsets (x, y, width, height, top, right, bottom, left, pageX, pageY, inViewport). Draws a subtle visual ripple.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref from web_get_by / web_aria_snapshot." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_computed_style",
      description:
        "Inspects computed CSS properties on an element (DevTools Styles panel parity): display, visibility, opacity, position, zIndex, colors, fonts, margins, transforms, etc.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref." },
          properties: { type: "array", items: { type: "string" }, description: "Specific CSS property names to inspect. Omit for standard layout/visual styles." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_add_script_tag",
      description:
        "Playwright page.addScriptTag() parity: injects a custom JavaScript file (url) or inline code snippet (content) into the live page.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Script URL to load." },
          content: { type: "string", description: "Raw JavaScript code to execute." },
          type: { type: "string", default: "text/javascript", description: "Script type (e.g. 'module')." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_add_style_tag",
      description:
        "Playwright page.addStyleTag() parity: injects a custom CSS stylesheet (url) or inline style block (content) into the live page.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Stylesheet URL to link." },
          content: { type: "string", description: "Raw CSS styles to inject." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_tab_group",
      description:
        "Chrome Tab Groups API management: groups, labels, color-codes, and collapses tabs to keep complex multi-tab agent workflows neat and organized.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["create", "add", "remove", "update", "list"], description: "Tab group operation." },
          tabIds: { type: "array", items: { type: "integer" }, description: "Tab IDs to group or ungroup." },
          tabId: { type: "integer", description: "Single tab ID shortcut." },
          groupId: { type: "integer", description: "Existing group ID." },
          title: { type: "string", description: "Group label (e.g. 'ScreenSync Harvest')." },
          color: { type: "string", enum: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"], description: "Group badge color." },
          collapsed: { type: "boolean", description: "Collapse or expand the group." },
          windowId: { type: "integer", description: "Filter groups by window ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_indexeddb",
      description:
        "Inspects and extracts data from IndexedDB databases on the target origin (DevTools Application panel parity). Crucial for modern SPAs, PWAs, messaging apps, and offline data caches.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["databases", "schema", "dump", "query"], description: "databases: list DBs; schema: object stores & indexes; dump: extract records; query: filtered records." },
          database: { type: "string", description: "Database name." },
          store: { type: "string", description: "Object store name." },
          indexName: { type: "string", description: "Optional index to query." },
          key: { type: "string", description: "Exact primary key lookup." },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "Maximum records to return." },
          offset: { type: "integer", minimum: 0, default: 0, description: "Records to skip." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_cache_storage",
      description:
        "Inspects Service Worker CacheStorage caches (caches.keys(), request matching, cached assets) for offline and PWA analysis.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["list", "keys", "match"], description: "list: cache names; keys: URLs in cache; match: inspect cached response." },
          cache: { type: "string", description: "Cache name." },
          url: { type: "string", description: "URL to match." },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_reader_mode",
      description:
        "Safari/Firefox Reader Mode parity: strips ads, navigation bars, cookie banners, tracking scripts, and converts the core article/page into clean, structured Markdown with title, byline, publishDate, readingTime, and wordCount.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_page_digest",
      description:
        "AI-browser parity (Claude/ChatGPT/Comet mode): compact, token-bounded accessibility-first representation of the page with interactive elements, headings, landmarks, forms, and open tab summary.",
      inputSchema: {
        type: "object",
        properties: {
          maxNodes: { type: "integer", minimum: 20, maximum: 300, default: 80, description: "Maximum interactive elements to return." },
          includeForms: { type: "boolean", default: true, description: "Include forms breakdown with field names and values." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_actionable",
      description:
        "Playwright auto-waiting & actionability inspector: checks if an element is attached, visible, stable, enabled, and receives pointer events before acting.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: locatorNote },
          ref: { type: "integer", description: "data-ss-id ref." },
          timeoutMs: { type: "integer", minimum: 500, maximum: 15000, default: 3000, description: "Max wait timeout in ms." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_audit_log",
      description:
        "Queries or exports the bounded privacy-preserving audit ring of web tool invocations in the user's browser.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "clear", "export"], default: "get", description: "Audit log action." },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "Max entries to return." },
          tool: { type: "string", description: "Filter by tool name." },
          origin: { type: "string", description: "Filter by target origin." },
          since: { type: "string", description: "Filter by ISO timestamp since." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_popup_wait",
      description:
        "Playwright expect_popup / page.waitForEvent('popup') parity: waits for a popup tab to be opened (via window.open() or target=\"_blank\") by the current tab or any tab.",
      inputSchema: {
        type: "object",
        properties: {
          openerTabId: { type: "integer", description: "Tab ID that triggered the popup (defaults to active tab)." },
          timeoutMs: { type: "integer", minimum: 500, maximum: 30000, default: 5000, description: "Max wait timeout in ms." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_takeover",
      description:
        "AI-browser takeover / hand-off engine: pauses the agent and requests user intervention for human authentication, 2FA, or CAPTCHA challenges. Resumes cleanly when the user confirms.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", enum: ["login", "2fa", "captcha", "payment", "custom"], default: "login", description: "Reason for requesting user takeover." },
          message: { type: "string", description: "Instructions or explanation shown to the user on the dashboard/popup." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 600000, default: 300000, description: "Timeout in ms (up to 10 min)." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_site_memory",
      description:
        "Site memory and learned selectors: manages persistent origin-scoped resilient selectors with success telemetry and auto-healing fallbacks across website redesigns.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "record", "heal", "clear"], default: "get", description: "Memory action." },
          origin: { type: "string", description: "Target website origin or domain." },
          alias: { type: "string", description: "Logical name of the element (e.g. 'search_input', 'submit_btn')." },
          selector: { type: "string", description: "Resilient Playwright selector to remember or record." },
          fallbackSelector: { type: "string", description: "Alternative fallback selector when healing." },
          role: { type: "string", description: "ARIA role for semantic fallback." },
          name: { type: "string", description: "Accessible name for semantic fallback." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_test_run",
      description:
        "Playwright test-runner & CI reporter parity (P8): executes named test suites or flows with configurable auto-retries, emitting structured JSON and standard JUnit XML reports for CI/CD.",
      inputSchema: {
        type: "object",
        properties: {
          suite: { type: "object", description: "Full test suite definition object with { name, tests: [...] }." },
          tests: { type: "array", items: { type: "object" }, description: "Array of test cases with { name, flow/steps, retries }." },
          flow: { type: "string", description: "Shortcut: name of a saved flow to run as a single test." },
          name: { type: "string", description: "Suite or test name." },
          retries: { type: "integer", minimum: 0, maximum: 5, default: 0, description: "Max retry attempts per failed test case." },
          format: { type: "string", enum: ["json", "junit", "both"], default: "both", description: "Report output format." },
          stepTimeoutMs: { type: "integer", minimum: 5000, maximum: 60000, default: 45000 },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_handle",
      description:
        "Playwright evaluateHandle & exposeFunction parity (P10): manages an in-memory JS/DOM handle registry across multi-step browser scripts and binds callable functions on window.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["create", "eval", "get", "dispose", "list", "exposeFunction"], description: "Handle lifecycle or function exposure action." },
          selector: { type: "string", description: locatorNote },
          code: { type: "string", description: "JavaScript expression or function to evaluate." },
          handleId: { type: "string", description: "Opaque handle ID (handle_*) returned by create." },
          name: { type: "string", description: "Global function name on window for action: 'exposeFunction'." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_service_worker",
      description:
        "Service Worker inspection & lifecycle via CDP (P12): lists registered background workers per origin, inspects worker target details, attaches, or stops worker execution.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["list", "attach", "stop", "unregister"], description: "Service worker operation." },
          origin: { type: "string", description: "Filter workers by website origin (defaults to active tab origin)." },
          targetId: { type: "string", description: "CDP target ID to attach." },
          versionId: { type: "string", description: "Worker version ID to stop." },
          scopeURL: { type: "string", description: "Registration scope URL to unregister." },
          keepAttached: { type: "boolean", description: "Keep CDP session attached after operation." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_page_observe",
      description:
        "Non-mutating CDP-only page perception (VOM / Visual Object Model): joins Chrome's Accessibility Tree with DOM Snapshot geometry without injecting or modifying DOM attributes. Computes physical occlusion, detects modal blocking layers, and supports token-bounded cursor pagination.",
      inputSchema: {
        type: "object",
        properties: {
          maxTokens: { type: "integer", minimum: 500, maximum: 32000, default: 4000, description: "Maximum token budget for returned observation tree." },
          cursor: { type: "string", description: "Continuation cursor (e.g. 'node:145') to paginate through large pages." },
          includeOccluded: { type: "boolean", default: false, description: "Include elements visually covered by modals or overlays." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_screenshot_read",
      description:
        "Reads a specific tile chunk from a previously captured tiled long screenshot. Used in conjunction with web_full_screenshot (longPage: true) to inspect multi-tile vertical captures.",
      inputSchema: {
        type: "object",
        required: ["captureId"],
        properties: {
          captureId: { type: "string", description: "The captureId returned by web_full_screenshot when longPage: true." },
          tileIndex: { type: "integer", minimum: 0, default: 0, description: "Zero-based tile index to retrieve." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
  ];
}
