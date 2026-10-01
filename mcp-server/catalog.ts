import { AUTH_TOKEN, DATA_DIR, HTTP_HOST, HTTP_PORT } from "./config.js";
import { controlToolDefinitions } from "./catalog-control.js";
import { webSkillDefinitions, webToolDefinitions } from "./catalog-web.js";
import { cognitiveToolDefinitions } from "./catalog-cognitive.js";
import { lifespanToolDefinitions } from "./catalog-lifespan.js";
import { adolescentToolDefinitions } from "./catalog-adolescent.js";
import { dynamicsToolDefinitions } from "./catalog-dynamics.js";
import { transcendentalToolDefinitions } from "./catalog-transcendental.js";
export { catalogFor, consolidatedToolDefinitions, isConsolidatedMode, getToolsForMode, resolveConsolidatedCall } from "./catalog-consolidated.js";
import { getToolsForMode } from "./catalog-consolidated.js";

// Single source of truth for everything the MCP server exposes. The MCP
// protocol handlers, the HTTP /api/mcp/catalog endpoint and the new
// `get_mcp_catalog` tool all read from here so agents and the Flutter app
// always see the same catalog.

export const SERVER_NAME = "screensync-mcp-server";
export const SERVER_VERSION = "3.3.0";
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
      description: "Reports whether the phone is streaming: connected = a frame arrived in the last 60s, phoneOnline = the app is linked to the hub, state = streaming | linked_no_frames | no_phone, plus latest frame age, device metadata and retained frame count.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
      {
        name: "check_app_update",
        description: "Reports the newest published Android build (version name and code, byte size, SHA-256, build time) and whether it is newer than the versionCode you pass in. Read-only by design: an agent can see that an update exists, but only the device owner can install it.",
        inputSchema: {
          type: "object",
          properties: {
            versionCode: { type: "integer", minimum: 0, description: "The installed build versionCode, so the hub can say whether an update is available." },
          },
          additionalProperties: false,
        },
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
        "Returns the complete ScreenSync MCP catalog: every tool, prompt (skill), resource, plus connection settings and a recommended usage order. Call this first after connecting to discover all capabilities. Pass tool to get just that one tool's full definition (or, for a consolidated meta-tool, each of its actions in a line).",
      inputSchema: { type: "object", properties: { tool: { type: "string", description: "A tool name (or consolidated action) to describe instead of returning everything." } }, additionalProperties: false },
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

    ...controlToolDefinitions(),
    ...webToolDefinitions(),
    ...cognitiveToolDefinitions(),
    ...lifespanToolDefinitions(),
    ...adolescentToolDefinitions(),
    ...dynamicsToolDefinitions(),
    ...transcendentalToolDefinitions(),
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
    {
      name: "mobile_social_publish",
      description: "Guides the agent to autonomously publish social posts via native Android apps (Twitter/X, LinkedIn, Instagram, Reddit) with live visual + hierarchy verification.",
      arguments: [
        { name: "app", description: "Target mobile app name, e.g. 'Twitter / X', 'LinkedIn', 'Instagram', 'Reddit'.", required: true },
        { name: "content", description: "Full text content, hashtags, and links to publish.", required: true },
      ],
    },
    {
      name: "mobile_autonomous_agent",
      description: "Complete OODA Loop Mobile Agent (Observe, Orient, Decide, Act, Verify): drives native Android apps with vision + hierarchy + ADB control.",
      arguments: [
        { name: "task", description: "The complete mobile task or user goal to execute.", required: true },
      ],
    },

    ...webSkillDefinitions(),
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
      "Read get_skills (this) first, then get_device_status (for phone) and web_status (for browser).",
      "Master Operator Protocol: Adopt the cognitive OODA loop (Observe -> Orient -> Decide -> Act -> Verify). Never ask the user to verify manually; always verify via DOM & screenshots.",
      "To SHOW images in preview, return the MCP image content directly in your reply (do not paste file paths/links).",
      "Be FAST and concise: prefer get_recent_screenshots for 'latest N images' in ONE call.",
      "Use get_latest_screenshot for a single full-res frame + metadata.",
      "After inspecting mobile screens, call publish_inspection (bug regions) and optionally publish_patch (git fix).",
      "For the user's BROWSER: call web_status first, then web_screenshot / web_hierarchy to see the live tab, and web_click / web_type / web_navigate / web_scroll to act.",
      "Web bridge safety: if web_status reports offline or disabled, STOP and ask the user to enable 'Web access for AI agents' in the extension dashboard — never loop web_* calls.",
      "Playwright-Grade & CDP Tools: web_full_screenshot (full-page scrolling capture), web_pdf, web_cdp_click, web_cdp_type (genuine hardware clicks & keystrokes for SPAs), web_eval, web_console, web_network, web_dialog, web_storage, web_perf, web_tabs, web_tab, web_wait_for, web_key, web_hover, web_select, web_watch, web_extension_reload.",
      "For autonomous workflows use the bundled skills: screensync_operator, web_autonomous_agent, mobile_autonomous_agent, web_social_publish, mobile_social_publish, web_visual_qa, web_debug_session, web_perf_audit, web_form_autofill, web_watch_flow, web_multitab_workflow.",
    ],
    tools: toolDefinitions().map((t) => ({ name: t.name, purpose: (t.description || "").split(".")[0] })),
    quickRecipes: [
      { ask: "operate browser and phone with full cognitive autonomy", use: "screensync_operator { task: '...' }" },
      { ask: "show me the latest 2 reference images", use: "get_recent_screenshots { limit: 2 }" },
      { ask: "why is my mobile UI broken?", use: "get_latest_screenshot -> inspect -> publish_inspection" },
      { ask: "capture full-page webpage screenshot", use: "web_full_screenshot" },
      { ask: "what am I looking at in my browser?", use: "web_status -> web_screenshot" },
      { ask: "fill and submit this form safely", use: "web_hierarchy -> web_type -> web_click -> web_screenshot" },
      { ask: "debug web issue with console & network logs", use: "web_debug_session" },
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
        "GET  /api/web/watch/:id/frames  streamed web_watch frames (live channel: SSE web_frame)",
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
    tools: getToolsForMode(),
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
