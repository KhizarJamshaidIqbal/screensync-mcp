// Playwright-parity web tool definitions: device emulation, uploads, drag and drop, load states and crawling,
// then paste/clear/highlight (Phase 2) and history, waits, key combos, mouse, touch, cookies, permissions,
// timezone, downloads and find (Phase 3). Split out of catalog-web.ts (repo rule: no source file over 500
// lines) and spread back into webToolDefinitions() at its old position, so the tool list and its order are
// unchanged.

import type { WebToolDef } from "./catalog-web-agent-core.js";

export function parityWebToolDefinitions(): WebToolDef[] {
  return [
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
          color: { type: "string", description: "Border and glow color (defaults to #8B5CF6)." },
          noScroll: { type: "boolean", default: false, description: "Do not auto-scroll element into view if true." },
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
  ];
}
