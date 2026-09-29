// The "Next-Gen Features" run of web tool definitions: Set-of-Marks overlays, assertions, tab pools, routes,
// dialog rules, coverage, geolocation, network throttling, colour scheme, clipboard, markdown extraction,
// multi-tab sync, request/response waits and WebSocket traffic. Split out of catalog-web.ts (repo rule: no
// source file over 500 lines) and spread back into webToolDefinitions() at its old position, so the tool list
// and its order are unchanged.

import type { WebToolDef } from "./catalog-web-agent-core.js";

export function nextGenWebToolDefinitions(): WebToolDef[] {
  return [
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
          action: { type: "string", enum: ["accept", "dismiss", "prompt", "clear"], default: "dismiss", description: "Dialog rule action (default: dismiss)." },
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
  ];
}
