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
  ];
}
