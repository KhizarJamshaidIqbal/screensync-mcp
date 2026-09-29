// Web bridge tool definitions (browser access for AI agents). Kept separate
// from catalog.ts so the shared catalog stays under the file-size budget.
// These run the user's real browser tabs through the ScreenSync browser
// extension, mirroring the phone control surface. They require the extension
// to be paired to this hub with Web access enabled.
// Most definitions live in sibling catalog-web-*.ts files (the 500-line rule), each spread back here at its
// original position so the tool list keeps its order.
import { advancedWebToolDefinitions } from "./catalog-web-advanced.js";
import { agentWebToolDefinitions } from "./catalog-web-agent.js";
import { captureWebToolDefinitions, compareCaptureWebToolDefinitions, screencastWebToolDefinitions } from "./catalog-web-capture.js";
import { inspectWebToolDefinitions } from "./catalog-web-inspect.js";
import { nextGenWebToolDefinitions } from "./catalog-web-nextgen.js";
import { parityWebToolDefinitions } from "./catalog-web-parity.js";

export function webToolDefinitions() {
  return [
    {
      name: "web_status",
      description:
        "Reports whether the ScreenSync browser extension is connected and Web access is enabled, plus the currently active browser tab. Top-level activeTab, lastSeenAt, targetInstanceId and targetProfile (email, else profile name) describe the browser the next web_* call without routing hints goes to (selectedProfile, else the focused window, else the latest heartbeat); those four are null when selectedProfile matches no connected browser. browsers[] lists every instance with its own activeTab. Always call this before any web_* action.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_extension_reload",
      description: "Triggers a programmatic hot reload of the unpacked ScreenSync Chrome extension from disk.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_extension_dashboard",
      description:
        "Opens the full ScreenSync dashboard in a new browser tab (the same page the side panel embeds). Use this when the user needs the dashboard but the side panel cannot be opened.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_extension_side_panel",
      description:
        "Attempts to open the Chrome side panel. Chrome only allows this from a real user gesture, so an agent call cannot force it open; the result states that plainly and tells the caller to ask the user to click. Never reports a false success.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_extension_settings",
      description:
        "Reads the extension's settings: hub URL, onboarding state, whether agent web access is enabled, theme, whether a pairing token is configured, and how many origin grants exist. Read-only by design - the web-access gate cannot be switched through MCP.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_consent",
      description:
        "Reports the origin consent record the user has granted (per-origin read/act/cookie flags) plus the extraction budget. Read-only: grants are managed by the user on the dashboard's Web Access tab and cannot be changed through MCP.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list"], default: "list", description: "Only 'list' is supported." },
          origin: { type: "string", description: "Origin whose grant should be reported." },
        },
        additionalProperties: false,
      },
    },
    ...captureWebToolDefinitions(), // web_screenshot, web_full_screenshot, web_pdf (catalog-web-capture.ts)
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
    ...advancedWebToolDefinitions(), // web_eval ... web_network_mock (catalog-web-advanced.ts)
    ...compareCaptureWebToolDefinitions(), // web_pixel_diff, web_element_screenshot (catalog-web-capture.ts)
    ...parityWebToolDefinitions(), // web_emulate ... web_find (catalog-web-parity.ts)
    ...nextGenWebToolDefinitions(), // web_som_overlay ... web_websocket_traffic (catalog-web-nextgen.ts)
    ...screencastWebToolDefinitions(), // web_screencast (catalog-web-capture.ts)
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
    ...agentWebToolDefinitions(),
    ...inspectWebToolDefinitions(),
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
