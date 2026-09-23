// Playwright-grade core agent tools — assertions, DOM queries, emulation
// Kept in a dedicated file so catalog-web-agent.ts stays under the 500-line budget.

export type WebToolDef = {
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

export function agentCoreWebToolDefinitions(): WebToolDef[] {
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
          offset: { type: "integer", minimum: 0, default: 0, description: "Skip this many snapshot lines, to read a long page in parts. A cut-short snapshot returns truncated:true and nextOffset; pass it here for the next part. [index=N] refs keep their numbering on every part." },
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
          openDetails: { type: "boolean", default: false, description: "Open closed <details> around the tables for the read, then close them again. Without it, text in a closed <details> is still read (from textContent), and columnVisible shows which columns a person can see." },
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
        "Playwright fill(): instantly sets an input/textarea/contenteditable value with proper input+change events (no keystroke emulation). Faster and more reliable than web_type for long text.",
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
          inline: { type: "string", enum: ["start", "center", "end", "nearest"], default: "nearest", description: "Horizontal alignment for element scroll." },
          ifNeeded: { type: "boolean", default: false, description: "Playwright scrollIntoViewIfNeeded parity: only scroll if the element is not already within viewport boundaries." },
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
      name: "web_request_help",
      description:
        "Pauses agent execution and displays an in-page Shadow DOM overlay for the user with target element glowing highlight, countdown timer, desktop OS notification, and optional automatic completion criteria (URL change, element appeared/gone, form submitted).",
      inputSchema: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", description: "Human instruction explaining what verification or action is required." },
          targetSelector: { type: "string", description: "Optional CSS selector or locator of the element to highlight with glowing border." },
          tabId: { type: "integer", description: "Optional background tab ID." },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 600000, default: 120000, description: "Timeout before auto-cancelling if human does not respond." },
          completionCriteria: {
            type: "object",
            description: "Auto-resume conditions evaluated every 500ms while overlay is active.",
            properties: {
              startUrl: { type: "string", description: "If provided, auto-resumes when location.href differs from startUrl." },
              selectorGone: { type: "string", description: "Auto-resumes when this selector disappears from the page (e.g. CAPTCHA modal closed)." },
              selectorAppeared: { type: "string", description: "Auto-resumes when this selector appears on the page (e.g. success dashboard loaded)." },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_request_access",
      description:
        "Ask the user for access to a site you are not allowed to read or act on (\"Read/Action access not granted for origin X\"). The extension puts the request in front of them in a focused window, on the toolbar badge and in the popup: they answer Deny, Allow once (read + act for 15 minutes) or Always allow this site (a saved read + act grant, the same as the dashboard's Add Grant; not the cookie grant). Only a person can answer; nothing you send approves it, and you must never try to click the window. Waits up to waitMs (max 30s) and returns status allowed_once / allowed_always / already_allowed, or pending: the request is still waiting, so call this again with the url it returns (it never opens a second request). One window is shown at a time and at most 3 requests may wait (ACCESS_BUSY beyond that). A decline, or the user closing the window, returns USER_DECLINED and the site cannot be asked for again for 10 minutes; an unanswered request blocks re-asking for 5 minutes. Then ask the user in chat instead. Only http(s) sites; with no url, the active tab of the user's browser window.",
      inputSchema: {
        type: "object",
        required: ["reason"],
        properties: {
          reason: { type: "string", description: "One sentence the user will read: what you need this site for (max 240 characters)." },
          url: { type: "string", description: "The site or page to ask for (http/https). Defaults to the tab the call targets." },
          tabId: { type: "integer", description: "Optional tab whose site to ask for, when url is not given." },
          waitMs: { type: "integer", minimum: 0, maximum: 30000, default: 30000, description: "How long to wait for the answer before returning status pending." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_agent_window",
      description:
        "Manages an isolated browser window with an amber breathing viewport border for agent tasks. Keeps automated work segregated from user personal windows. Accessing tabs outside the agent window triggers in-page borrowing approval.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["create", "close", "status", "borrow", "return"], description: "Agent window lifecycle or tab borrowing action." },
          targetTabId: { type: "integer", description: "Tab ID for borrow/return actions." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
  ];
}
