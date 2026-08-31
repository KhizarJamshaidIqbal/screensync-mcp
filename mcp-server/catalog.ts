import { AUTH_TOKEN, DATA_DIR, HTTP_HOST, HTTP_PORT } from "./config.js";
import { webToolDefinitions } from "./catalog-web.js";

// Single source of truth for everything the MCP server exposes. The MCP
// protocol handlers, the HTTP /api/mcp/catalog endpoint and the new
// `get_mcp_catalog` tool all read from here so agents and the Flutter app
// always see the same catalog.

export const SERVER_NAME = "screensync-mcp-server";
export const SERVER_VERSION = "2.7.0";
export const MDNS_TYPE = "_screensync-hub._tcp";

export function toolDefinitions() {
  return [
    {
      name: "get_latest_screenshot",
      description:
        "Returns the latest real Android MediaProjection screenshot as MCP image content plus capture metadata. Use this before diagnosing the currently visible mobile UI.",
      inputSchema: {
        type: "object",
        properties: { includeMetadata: { type: "boolean", description: "Include capture metadata text.", default: true } },
        additionalProperties: false,
      },
    },
    {
      name: "list_recent_screens",
      description: "Lists recent captured mobile screens without returning their large image payloads.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 20, default: 5, description: "Maximum frames to list." } },
        additionalProperties: false,
      },
    },
    {
      name: "get_device_status",
      description: "Reports ScreenSync transport status, latest frame age, device metadata, and retained frame count.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "publish_inspection",
      description: "Publishes UI bug regions found by Claude's visual analysis so the Flutter app can overlay them as a heatmap. Call this after inspecting a screenshot.",
      inputSchema: {
        type: "object",
        required: ["bugs", "summary"],
        properties: {
          bugs: {
            type: "array",
            description: "Array of detected bug regions with normalized [0..1] coordinates.",
            items: {
              type: "object",
              required: ["id", "label", "x", "y", "w", "h", "severity"],
              properties: {
                id: { type: "string" },
                label: { type: "string", maxLength: 120 },
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
                w: { type: "number", minimum: 0, maximum: 1 },
                h: { type: "number", minimum: 0, maximum: 1 },
                severity: { type: "string", enum: ["error", "warning", "info"] },
              },
            },
          },
          summary: { type: "string", maxLength: 500, description: "Short human-readable summary of findings." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "publish_patch",
      description: "Publishes a git patch that fixes the identified UI bugs so the developer can apply it with one click in the Flutter app.",
      inputSchema: {
        type: "object",
        required: ["patch", "description"],
        properties: {
          patch: { type: "string", maxLength: 200_000, description: "Unified diff output from git diff." },
          description: { type: "string", maxLength: 300 },
          filesTouched: { type: "array", items: { type: "string" }, description: "Dart files modified by this patch." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_mcp_catalog",
      description:
        "Returns the complete ScreenSync MCP catalog: every tool, prompt (skill), resource, plus connection settings and a recommended usage order. Call this first after connecting to discover all capabilities.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_skills",
      description:
        "FAST self-description. Returns concise usage rules + skills so any client (Claude/Antigravity/ChatGPT/Codex) instantly understands how to use ScreenSync and present results well. Read this FIRST.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_recent_screenshots",
      description:
        "Returns the N most recent phone screenshots AS INLINE IMAGE CONTENT (fast multi-image preview) plus compact metadata. Use for 'show me the latest N reference images' in one call.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 6, default: 2, description: "How many recent screenshots to return as images." },
          includeMetadata: { type: "boolean", default: true, description: "Include a compact metadata list." },
        },
        additionalProperties: false,
      },
    },

    // ── Remote control (gesture / input) tools ──
    {
      name: "control_status",
      description:
        "Reports whether live remote control is available (an ADB device is reachable) plus the device model, Android version and screen size. Call before any control_* action.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "control_screenshot",
      description:
        "Grabs the phone screen RIGHT NOW via ADB and returns it as an inline image — independent of the floating bubble. Use this to SEE the live screen before/after acting, closing the see→act loop.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "control_tap",
      description:
        "Taps the phone screen. Coordinates may be absolute pixels OR normalized [0..1] (auto-detected). Use control_screenshot first to locate the target.",
      inputSchema: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "number", description: "X (pixels, or 0..1 fraction of width)." },
          y: { type: "number", description: "Y (pixels, or 0..1 fraction of height)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_long_press",
      description: "Long-presses a point (default 700ms). Coordinates absolute px or normalized [0..1].",
      inputSchema: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "number" }, y: { type: "number" },
          durationMs: { type: "integer", minimum: 200, maximum: 5000, default: 700 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_swipe",
      description: "Swipes/drags from (x1,y1) to (x2,y2). Coordinates absolute px or normalized [0..1].",
      inputSchema: {
        type: "object",
        required: ["x1", "y1", "x2", "y2"],
        properties: {
          x1: { type: "number" }, y1: { type: "number" },
          x2: { type: "number" }, y2: { type: "number" },
          durationMs: { type: "integer", minimum: 50, maximum: 5000, default: 300 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_scroll",
      description: "Scrolls the screen in a direction (content moves that way).",
      inputSchema: {
        type: "object",
        required: ["direction"],
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "number", minimum: 0.1, maximum: 1, default: 0.6, description: "Fraction of screen to travel." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_type",
      description: "Types text into the currently focused field. Shell metacharacters are stripped for safety.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: { text: { type: "string", maxLength: 1000 } },
        additionalProperties: false,
      },
    },
    {
      name: "control_key",
      description:
        "Presses a hardware/navigation key: back, home, recents, menu, enter, tab, delete, escape, space, search, power, volume_up, volume_down, dpad_up/down/left/right/center.",
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "control_launch_app",
      description: "Launches an app by package name (e.g. com.android.settings) or package/activity.",
      inputSchema: {
        type: "object",
        required: ["package"],
        properties: { package: { type: "string", maxLength: 200 } },
        additionalProperties: false,
      },
    },

    // ── Advanced control / inspection (v2.6) ──
    {
      name: "get_ui_hierarchy",
      description:
        "Returns the on-screen UI element tree (text, content-desc, resource-id, class, clickable flag, pixel bounds and center) via uiautomator. Use this to locate elements PRECISELY instead of guessing tap coordinates from a screenshot.",
      inputSchema: {
        type: "object",
        properties: {
          onlyClickable: { type: "boolean", default: false, description: "Return only clickable elements." },
          filter: { type: "string", description: "Case-insensitive substring to filter node text/desc." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_tap_text",
      description:
        "Taps the on-screen element whose visible text or content-description matches the query (no coordinates needed). Prefers clickable + most-specific match. Use this for reliable UI navigation.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: 200, description: "Text/label to tap, e.g. 'Login' or 'Add to cart'." },
          exact: { type: "boolean", default: false, description: "Require an exact (not substring) match." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_swipe_until",
      description:
        "Scrolls in a direction until an element matching the query becomes visible (or maxSwipes is reached). Returns whether it was found, how many swipes it took, and the matched node.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: 200 },
          direction: { type: "string", enum: ["up", "down", "left", "right"], default: "down" },
          maxSwipes: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_open_url",
      description: "Opens an http(s) URL in the device's default browser. Handy for testing a live website on the phone.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string", maxLength: 2000 } },
        additionalProperties: false,
      },
    },
    {
      name: "compare_frames",
      description:
        "Captures a before + after screenshot with a delay between them and returns a coarse changedRatio (0..1) PLUS both images inline. Use after an action to verify whether the UI actually changed.",
      inputSchema: {
        type: "object",
        properties: { delayMs: { type: "integer", minimum: 0, maximum: 10000, default: 1200 } },
        additionalProperties: false,
      },
    },
    {
      name: "wait_for_frame",
      description:
        "Waits until a NEW ScreenSync bubble frame arrives (newer than the latest at call time) or times out. Use after asking the user to tap the floating bubble, so you inspect the fresh capture rather than a stale one.",
      inputSchema: {
        type: "object",
        properties: { timeoutMs: { type: "integer", minimum: 1000, maximum: 120000, default: 30000 } },
        additionalProperties: false,
      },
    },
    {
      name: "get_logcat",
      description:
        "Returns recent Android logcat lines, optionally filtered to an app package's process and/or a text grep. Use to surface Flutter/Dart runtime errors, exceptions and crashes.",
      inputSchema: {
        type: "object",
        properties: {
          pkg: { type: "string", maxLength: 200, description: "App package to filter to its PID, e.g. com.screensync.mcp." },
          grep: { type: "string", maxLength: 200, description: "Case-insensitive substring filter (e.g. 'exception')." },
          lines: { type: "integer", minimum: 10, maximum: 2000, default: 200 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "record_screen",
      description:
        "Records a short screen clip (1–15s) via screenrecord and returns it as an inline mp4. Use to capture an interaction flow or an intermittent visual glitch.",
      inputSchema: {
        type: "object",
        properties: { seconds: { type: "integer", minimum: 1, maximum: 15, default: 5 } },
        additionalProperties: false,
      },
    },

    ...webToolDefinitions(),
  ];
}

export function promptDefinitions() {
  return [
    {
      name: "inspect_latest_mobile_screen",
      description: "Guides an AI agent to inspect the latest ScreenSync frame for Flutter UI defects.",
      arguments: [
        { name: "focus", description: "Optional diagnostic focus, such as overflow or accessibility.", required: false },
      ],
    },
    {
      name: "autonomous_ui_test",
      description: "Drives the agent to autonomously open an app/screen, navigate it, and inspect every screen for defects using live control + vision.",
      arguments: [
        { name: "target", description: "App package, URL, or screen to test (e.g. com.myapp or https://mysite.com).", required: true },
        { name: "goal", description: "Optional test goal, e.g. 'complete checkout' or 'audit the onboarding flow'.", required: false },
      ],
    },
    {
      name: "reproduce_bug",
      description: "Guides the agent to reproduce a bug by following steps, capturing before/after frames and logcat at each step.",
      arguments: [
        { name: "steps", description: "Repro steps, e.g. '1. open cart 2. tap checkout 3. enter card'.", required: true },
        { name: "expected", description: "What should happen (so the agent can spot the deviation).", required: false },
      ],
    },
    {
      name: "accessibility_audit",
      description: "Guides the agent to audit the current screen for accessibility issues: tap-target size, contrast, missing labels, text scaling.",
      arguments: [
        { name: "standard", description: "Optional standard to check against, e.g. WCAG AA.", required: false },
      ],
    },
  ];
}

export function resourceDefinitions() {
  return [
    {
      uri: "screensync://status",
      name: "ScreenSync connection status",
      description: "Current mobile capture connection and latest frame metadata.",
      mimeType: "application/json",
    },
    {
      uri: "screensync://workflow",
      name: "ScreenSync AI testing workflow",
      description: "Instructions for autonomous screenshot-based mobile diagnosis.",
      mimeType: "text/markdown",
    },
    {
      uri: "screensync://skills",
      name: "ScreenSync skills + usage rules",
      description: "Concise rules + skills. Read first for fast, well-presented results.",
      mimeType: "text/markdown",
    },
  ];
}

/// Concise skills + rules returned by the get_skills tool and the
/// screensync://skills resource. Read FIRST by any connected client.
export function getSkillsContent() {
  return {
    about:
      "ScreenSync streams real Android screenshots from a phone to this MCP server, AND bridges your real browser tabs through the ScreenSync extension. You inspect phone screens visually, drive the phone via control_*, and see/act on the user's live browser via web_*.",
    rules: [
      "Read get_skills (this) first, then get_device_status to confirm a fresh frame.",
      "To SHOW images in preview, return the MCP image content directly in your reply (do not paste file paths/links).",
      "Be FAST and concise: prefer get_recent_screenshots for 'latest N images' in ONE call.",
      "Use get_latest_screenshot for a single full-res frame + metadata.",
      "After inspecting, call publish_inspection (bug regions) and optionally publish_patch (git fix).",
      "For the user's BROWSER: call web_status first, then web_screenshot / web_hierarchy to see the live tab, and web_click / web_type / web_navigate / web_scroll to act.",
    ],
    tools: toolDefinitions().map((t) => ({ name: t.name, purpose: t.description.split(".")[0] })),
    quickRecipes: [
      { ask: "show me the latest 2 reference images", use: "get_recent_screenshots { limit: 2 }" },
      { ask: "why is my UI broken?", use: "get_latest_screenshot -> inspect -> publish_inspection" },
      { ask: "is the phone connected?", use: "get_device_status" },
      { ask: "what am I looking at in my browser?", use: "web_status -> web_screenshot" },
      { ask: "fill this web form for me", use: "web_hierarchy -> web_type -> web_click" },
    ],
  };
}

export function connectionInfo() {
  return {
    transport: "stdio",
    stdio: {
      command: "node",
      args: ["<SCREENSYNC_MCP_DIR>/dist/index.js"],
      env: { SCREEN_SYNC_TOKEN: AUTH_TOKEN },
      note: "Replace <SCREENSYNC_MCP_DIR> with the absolute path of the mcp-server folder on this machine.",
    },
    httpHub: {
      baseUrl: `http://${HTTP_HOST === "0.0.0.0" ? "<LAN-IP-OF-THIS-MACHINE>" : HTTP_HOST}:${HTTP_PORT}`,
      bearerToken: AUTH_TOKEN,
      endpoints: [
        "GET  /health",
        "POST /api/screens/upload",
        "GET  /api/screens/latest",
        "GET  /api/device/status",
        "GET  /api/inspections/latest",
        "GET  /api/patches/latest",
        "GET  /api/mcp/catalog",
        "POST /api/web/tool           run a web_* tool through the browser extension",
        "GET  /api/web/status         web-bridge presence + active tab",
      ],
    },
    discovery: { mdnsType: MDNS_TYPE, note: "The hub advertises itself via mDNS; the Flutter app auto-discovers it on the same LAN." },
    dataDir: DATA_DIR,
  };
}

export function buildCatalog() {
  return {
    server: { name: SERVER_NAME, version: SERVER_VERSION },
    connection: connectionInfo(),
    tools: toolDefinitions(),
    prompts: promptDefinitions(),
    resources: resourceDefinitions(),
    recommendedUsage: [
      "1. get_device_status — confirm a fresh phone frame exists.",
      "2. get_latest_screenshot — inspect the raw image (vision, no OCR).",
      "3. publish_inspection — send bug regions back to the phone heatmap.",
      "4. publish_patch — send a git patch for one-tap apply.",
      "5. web_status -> web_screenshot / web_hierarchy — see the user's live browser tab (needs the extension with Web access enabled).",
      "6. web_click / web_type / web_navigate / web_scroll — act on the browser like the user would.",
      "7. get_mcp_catalog — re-read this catalog anytime for full capability discovery.",
    ],
  };
}
