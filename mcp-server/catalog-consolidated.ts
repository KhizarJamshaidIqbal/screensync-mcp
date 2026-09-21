// ScreenSync Consolidated Meta-Tooling
// Wraps the granular catalogue in a handful of action-routed meta-tools, for smaller LLMs that choke on
// large tool schemas. Activated via the TOOL_MODE=consolidated environment variable.
//
// No tool count is typed here: this header once carried one, and it fell far behind the catalogue.
// `web_mind` is BUILT from the cognitive catalogues, so a new cognitive tool is reachable the moment it
// is declared, and a test asserts that the map and the catalogues agree.

import { buildCatalog, toolDefinitions as granularToolDefinitions } from "./catalog.js";
import { cognitiveToolDefinitions } from "./catalog-cognitive.js";
import { lifespanToolDefinitions } from "./catalog-lifespan.js";
import { adolescentToolDefinitions } from "./catalog-adolescent.js";
import { dynamicsToolDefinitions } from "./catalog-dynamics.js";
import { transcendentalToolDefinitions } from "./catalog-transcendental.js";

/**
 * Every cognitive tool, in catalogue order. `web_recall` becomes the action `recall` and
 * `web_cognitive_stage` becomes `stage`: the meta-tool is already "mind", so the prefixes say nothing.
 */
function mindActions(): Record<string, string> {
  const tools = [...cognitiveToolDefinitions(), ...lifespanToolDefinitions(), ...adolescentToolDefinitions(), ...dynamicsToolDefinitions(), ...transcendentalToolDefinitions()];
  // `help` is answered by get_mcp_catalog: the exact schema of one tool, on demand.
  const map: Record<string, string> = { help: "get_mcp_catalog" };
  for (const { name } of tools) {
    const action = name.replace(/^web_/, "").replace(/^cognitive_/, "");
    if (map[action]) throw new Error(`web_mind: "${map[action]}" and "${name}" would share the action "${action}"`);
    map[action] = name;
  }
  return map;
}

// Meta-tool action -> granular tool name mapping
const ACTION_MAP: Record<string, Record<string, string>> = {
  web_session: {
    status: "web_status",
    browsers: "web_status",
    extension_diagnostics: "web_extension_diagnostics",
    extension_reload: "web_extension_reload",
    agent_window: "web_agent_window",
  },
  web_page: {
    navigate: "web_navigate",
    back: "web_run_code",
    forward: "web_run_code",
    reload: "web_reload",
    wait: "web_wait_for",
    close: "web_tab",
    pdf: "web_pdf",
    mhtml: "web_mhtml",
  },
  web_inspect: {
    observe: "web_page_observe",
    digest: "web_page_digest",
    snapshot: "web_aria_snapshot",
    screenshot: "web_screenshot",
    screenshot_read: "web_screenshot_read",
    html: "web_content",
    table: "web_table_extract",
    scrape: "web_scrape_schema",
    console: "web_console",
    hierarchy: "web_hierarchy",
    reader: "web_reader_mode",
    markdown: "web_markdown_extract",
    diff: "web_pixel_diff",
    bounding_box: "web_bounding_box",
    computed_style: "web_computed_style",
    som: "web_som_overlay",
  },
  web_interact: {
    click: "web_click",
    fill: "web_fill",
    type: "web_type",
    check: "web_check",
    select: "web_select",
    hover: "web_hover",
    press: "web_key",
    scroll: "web_scroll_to",
    focus: "web_focus",
    mouse: "web_mouse",
    drag_drop: "web_drag_and_drop",
    run_code: "web_run_code",
    add_script: "web_add_script_tag",
    add_style: "web_add_style_tag",
  },
  web_tabs: {
    list: "web_tab",
    create: "web_navigate",
    select: "web_tab",
    close: "web_tab",
    group: "web_tab_group",
    ungroup: "web_tab_group",
    fanout: "web_fanout",
    window: "web_window",
  },
  web_assist: {
    resize: "web_resize",
    emulate_media: "web_emulate_media",
    device_emulate: "web_device_emulate",
    set_user_agent: "web_set_user_agent",
    request_help: "web_request_help",
    takeover: "web_takeover",
    clock_set: "web_clock_set",
    clock_clear: "web_clock_clear",
    clock_fast_forward: "web_clock_fast_forward",
    cache_control: "web_cache_control",
    network_auth: "web_network_auth",
  },
  web_evidence: {
    har_record: "web_har_record",
    video_record: "web_video_record",
    trace_record: "web_trace_record",
    visual_baseline: "web_visual_baseline",
    events: "web_events",
    expect: "web_expect",
    history: "web_history",
    bookmarks: "web_bookmarks",
    indexeddb: "web_indexeddb",
    cache_storage: "web_cache_storage",
  },
  mobile_control: {
    tap: "control_tap",
    swipe: "control_swipe",
    type: "control_type",
    screenshot: "get_latest_screenshot",
    status: "get_device_status",
    key: "control_key",
    launch: "control_launch_app",
    scroll: "control_scroll",
    ui_hierarchy: "get_ui_hierarchy",
  },
  // Built, not typed: see mindActions().
  web_mind: mindActions(),
};

export function consolidatedToolDefinitions() {
  return [
    {
      name: "web_session",
      description:
        "Manage browser sessions. Actions: status (extension & browser status), browsers (list connected browsers), extension_diagnostics (health check), extension_reload (reload extension), agent_window (create/close isolated agent window).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_session),
            description: "The session action to perform.",
          },
          args: {
            type: "object",
            description: "Arguments passed to the underlying tool.",
            additionalProperties: true,
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_page",
      description:
        "Navigate and manage the current page. Actions: navigate (go to URL, newTab option), back, forward, reload, wait (wait for selector/load), close (close tab), pdf (save as PDF), mhtml (save as MHTML archive).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_page),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_inspect",
      description:
        "Inspect page content. Actions: observe (VOM non-mutating perception with occlusion & pagination), digest (DOM-stamped interactive element digest), snapshot (ARIA accessibility tree), screenshot (capture image, longPage option for tall pages), screenshot_read (read tiled screenshot chunk), html (raw page HTML), table (extract table data), scrape (structured schema extraction), console (read console logs), hierarchy (DOM hierarchy), reader (clean article text), markdown (page as markdown), diff (compare two pages), bounding_box (element geometry), computed_style (CSS properties), som (visual numbered badges overlay).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_inspect),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_interact",
      description:
        "Interact with page elements. Actions: click (click element by selector/ref), fill (form fill by selector/role/label), type (keyboard text entry), check (toggle checkbox), select (pick dropdown option), hover, press (keyboard key), scroll (scroll to element), focus, mouse (raw mouse events), drag_drop (drag and drop), run_code (execute JS), add_script (inject script tag), add_style (inject style tag).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_interact),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_tabs",
      description:
        "Manage browser tabs. Actions: list (all tabs), create (new tab), select (switch to tab), close (close tab), group (group tabs), ungroup, fanout (run tool across all browsers), window (window management).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_tabs),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_assist",
      description:
        "Browser assistance tools. Actions: resize (change viewport), emulate_media (print/screen/color scheme), device_emulate (mobile device simulation), set_user_agent, request_help (in-page human help overlay with target highlighting), takeover (pause for human), clock_set/clock_clear/clock_fast_forward (fake timers), cache_control (enable/disable/clear cache), network_auth (HTTP authentication).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_assist),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_evidence",
      description:
        "Evidence gathering and testing. Actions: har_record (HTTP Archive recording), video_record (WebM screen recording), trace_record (Chrome performance trace), visual_baseline (screenshot comparison with heatmaps), events (SSE event stream tail), expect (Playwright-style polling assertion), history (browser history), bookmarks, indexeddb (inspect IndexedDB), cache_storage (inspect CacheStorage).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_evidence),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "mobile_control",
      description:
        "Control the connected Android device. Actions: tap (tap coordinates/text), swipe, type (enter text), screenshot (latest screen capture), status (device info), key (press hardware key), launch (open app), scroll, ui_hierarchy (accessibility tree).",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.mobile_control),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    {
      name: "web_mind",
      description:
        "ScreenSync's cognitive memory: what the hub has learned about sites, and how it grows. The loop: recall (before acting on a domain) -> act, then check the result with web_evidence expect -> learn (record a playbook, pitfall or fact) -> consolidate. stage shows a domain's earned level and, with args {action:'next'}, what to do next. Every other action is an advanced cognitive tool. Call help with args {action:'<name>'} for the exact arguments of any action, or with no args for every action in one line each.",
      inputSchema: {
        type: "object" as const,
        properties: {
          action: {
            type: "string",
            enum: Object.keys(ACTION_MAP.web_mind),
          },
          args: { type: "object", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  ];
}

/**
 * Resolve a consolidated meta-tool call to the underlying granular tool name and args.
 */
export function resolveConsolidatedCall(
  metaToolName: string,
  params: { action: string; args?: Record<string, unknown> }
): { toolName: string; args: Record<string, unknown> } | { error: string } {
  const map = ACTION_MAP[metaToolName];
  if (!map) {
    // A granular name reaches here when a client calls a tool the mode does not list. Say where it went.
    const via = viaOf(metaToolName);
    return { error: `Unknown meta-tool: ${metaToolName}.${via ? ` In this mode it is ${via.tool} with action "${via.action}".` : ""}` };
  }

  const granularName = map[params.action];
  if (!granularName) {
    return {
      error: `Unknown action '${params.action}' for ${metaToolName}. Valid: ${Object.keys(map).join(", ")}`,
    };
  }

  // For tab actions that need the action passed through
  const args = { ...(params.args || {}) };
  if (metaToolName === "web_tabs" && ["list", "select", "close"].includes(params.action)) {
    args.action = args.action || params.action;
  }
  if (metaToolName === "web_page") {
    if (params.action === "back") args.code = args.code || "history.back()";
    if (params.action === "forward") args.code = args.code || "history.forward()";
  }
  if (metaToolName === "web_mind" && params.action === "help") {
    // The target is an action name ("learn") or a granular tool name ("web_learn"); with neither, the
    // overview. catalogFor is the one place that knows how to look either up.
    args.tool = String(args.action ?? args.tool ?? "web_mind").trim();
    delete args.action;
  }

  return { toolName: granularName, args };
}

/**
 * Check if the server is in consolidated tool mode.
 */
export function isConsolidatedMode(): boolean {
  return (process.env.TOOL_MODE || "").toLowerCase() === "consolidated";
}

/**
 * Get the appropriate tool list based on current mode.
 */
export function getToolsForMode() {
  if (isConsolidatedMode()) {
    return consolidatedToolDefinitions();
  }
  return granularToolDefinitions();
}

/** The meta-tool and action that reach a granular tool in this mode, or null when none does. */
function viaOf(granular: string): { tool: string; action: string } | null {
  for (const [tool, actions] of Object.entries(ACTION_MAP)) {
    for (const [action, name] of Object.entries(actions)) {
      if (name === granular && !(tool === "web_mind" && action === "help")) return { tool, action };
    }
  }
  return null;
}

/**
 * The opening of a description, enough to tell what an action is for: one sentence, or two when the
 * first is too short to say anything ("Cognitive cue-dependent memory recall.").
 */
const oneLine = (text: string | undefined): string => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  let line = "";
  // Split where punctuation is followed by whitespace - so "Architecture 5.0)." is not cut at the 5 - but
  // not after an abbreviation ("e.g. x.com").
  for (const sentence of flat.split(/(?<!\b(?:e\.g|i\.e|etc|vs)\.)(?<=[.!?])\s+/).slice(0, 2)) {
    line = line ? `${line} ${sentence}` : sentence;
    if (line.length >= 40) break;
  }
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
};

/**
 * `get_mcp_catalog`, optionally for ONE tool. The meta-tools wrap granular tools whose schemas they
 * deliberately do not list - that is the point of the mode - so an agent needs a way to ask for one exact
 * schema when it needs it. This is it, and it works in the default mode too: one definition instead of
 * the whole catalogue. Asking for a meta-tool returns every one of its actions in a line each.
 */
export function catalogFor(args?: { tool?: unknown } | null) {
  const wanted = typeof args?.tool === "string" ? args.tool.trim() : "";
  if (!wanted) return buildCatalog();

  const granular = granularToolDefinitions();
  const meta = consolidatedToolDefinitions().find((t) => t.name === wanted);
  if (meta) {
    const actions: Record<string, string> = Object.fromEntries(Object.entries(ACTION_MAP[meta.name]).map(([action, name]) => [action, oneLine(granular.find((t) => t.name === name)?.description)]));
    if (meta.name === "web_mind") actions.help = "This list. With args {action:'<name>'}: that action's exact schema.";
    return { success: true, tool: meta, actions };
  }

  const name = wanted !== "help" && ACTION_MAP.web_mind[wanted] ? ACTION_MAP.web_mind[wanted] : wanted;
  const def = granular.find((t) => t.name === name);
  if (!def) {
    const near = granular.map((t) => t.name).filter((n) => n.includes(wanted.toLowerCase())).slice(0, 8);
    return { success: false, error: `No tool named "${wanted}".`, ...(near.length ? { didYouMean: near } : {}) };
  }
  return { success: true, tool: def, ...(isConsolidatedMode() ? { reachedVia: viaOf(def.name) } : {}) };
}
