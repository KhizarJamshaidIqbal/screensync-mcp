// Operator & Harvester tool definitions — Playwright parity, modern storage,
// authenticated multi-browser harvesting, live mutation streaming, and session vault.
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

export function operatorWebToolDefinitions(): WebToolDef[] {
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
      name: "web_authenticated_harvest",
      description:
        "THE real-user authenticated social & web intelligence harvester: uses the user's ALREADY LOGGED-IN browser sessions (X/Twitter, LinkedIn, GitHub, Reddit, Facebook, Instagram, YouTube, Threads, or custom) to scrape live feeds, profile metrics, notifications, and search results. Supports intelligent tab reuse, human scrolling, and structured data extraction.",
      inputSchema: {
        type: "object",
        required: ["platform"],
        properties: {
          platform: { type: "string", enum: ["x", "twitter", "linkedin", "github", "reddit", "facebook", "instagram", "youtube", "threads", "generic"], description: "Target social or web platform." },
          task: { type: "string", enum: ["feed", "profile", "notifications", "search", "bookmarks", "trending", "popular"], default: "feed", description: "Data to extract." },
          url: { type: "string", description: "Custom URL override." },
          query: { type: "string", description: "Search query when task=search." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Maximum items to harvest." },
          scrollPages: { type: "integer", minimum: 0, maximum: 10, default: 2, description: "Number of smooth scroll pages to trigger infinite feed loading." },
          useExistingTab: { type: "boolean", default: true, description: "Reuse an already-open tab if found (avoids opening new tabs and anti-bot flags)." },
          keepTab: { type: "boolean", default: false, description: "Leave the tab open after extraction." },
          selectors: { type: "object", description: "Custom CSS selectors for generic platforms ({itemSelector, titleSelector, linkSelector})." },
          __browser: { type: "string", description: "Target a specific connected browser (name or install id)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_parallel_harvest",
      description:
        "Multi-target parallel authenticated harvester: executes multiple harvesting tasks concurrently across tabs or browsers, groups them in dedicated tab groups, and aggregates findings into a unified intelligence report saved on the hub.",
      inputSchema: {
        type: "object",
        required: ["targets"],
        properties: {
          targets: {
            type: "array",
            items: {
              type: "object",
              required: ["platform"],
              properties: {
                platform: { type: "string" },
                task: { type: "string" },
                url: { type: "string" },
                limit: { type: "integer" },
                scrollPages: { type: "integer" },
              },
            },
            description: "List of platform harvest targets to run in parallel.",
          },
          concurrency: { type: "integer", minimum: 1, maximum: 6, default: 3, description: "Parallel tab concurrency." },
          timeoutMs: { type: "integer", minimum: 10000, maximum: 120000, default: 60000 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_session_vault",
      description:
        "Persistent hub-side session vault & cross-browser synchronization: captures full login states (cookies + localStorage + sessionStorage) to disk (DATA_DIR/vault/<domain>.json), restores them into any browser, lists saved vaults, or syncs live sessions between browsers.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["save", "restore", "list", "delete", "sync"], description: "Vault lifecycle operation." },
          domain: { type: "string", description: "Domain to vault or restore (e.g. 'linkedin.com', 'x.com')." },
          name: { type: "string", description: "Optional descriptive name for the saved vault." },
          from: { type: "string", description: "Source browser name/id when action=sync." },
          to: { type: "string", description: "Target browser name/id when action=sync." },
          includeStorage: { type: "boolean", default: true, description: "Include localStorage and sessionStorage." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_live_stream_sync",
      description:
        "Real-time DOM mutation streaming: attaches a MutationObserver to a live tab (e.g. live tweets, chats, feed updates), captures newly appeared items without reloading, and streams them for AI consumption.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["start", "poll", "stop"], description: "start: begin watching; poll: get newly buffered items; stop: detach." },
          selector: { type: "string", default: "article, [role=\"article\"], .tweet, .post, .message", description: "Selector for items to watch." },
          tabId: { type: "integer", description: "Target tab ID." },
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
      name: "web_smart_fill",
      description:
        "Real-browser intelligent form auto-filler: auto-matches form inputs by labels, placeholders, aria-labels, and names, types with human cadence, and dispatches native events so React/Vue/Angular forms properly register changes.",
      inputSchema: {
        type: "object",
        required: ["fields"],
        properties: {
          fields: { type: "object", description: "Dictionary of fields to fill, e.g. {email: '...', name: '...', message: '...'}" },
          tabId: { type: "integer", description: "Optional background tab ID." },
          __browser: { type: "string", description: "Target a specific connected browser." },
        },
        additionalProperties: false,
      },
    },
  ];
}
