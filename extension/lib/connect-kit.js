import { MDNS_TYPE } from './constants.js';

// Master Connect Kit & Prompt Bundle: Hand this to any AI agent (Claude Code,
// Claude Desktop, Antigravity, Cursor, Cline, Roo Code, etc.) and it connects
// in the fastest way, auto-wires configs, and adopts the complete /screensync-operator protocol.
export function buildConnectKit({ hubUrl, token, stdioNote = '', usage = [] }) {
  const stdioConfig = `{
  "mcpServers": {
    "screensync": {
      "command": "node",
      "args": ["<HUB_DIR>/screensync-hub.js"],
      "env": { "SCREEN_SYNC_TOKEN": "${token}" }
    }
  }
}`;

  return `ScreenSync MCP — Master Operator & Connect Kit
=====================================================
Hand this directly to any AI agent (Claude Code, Claude Desktop, Antigravity, Cursor, Cline, Roo Code, or any MCP client).
The agent will configure itself, connect to the ScreenSync hub, and operate with the master autonomous protocol.

─────────────────────────────────────────────────────
1. INSTANT AGENT CONFIGURATION (Choose your client)
─────────────────────────────────────────────────────

▶ CLAUDE CODE — save as .mcp.json in your project root:
${stdioConfig}

▶ CLAUDE DESKTOP — merge into claude_desktop_config.json:
${stdioConfig}
${stdioNote}

▶ CURSOR / ANTIGRAVITY / CLINE / ROO CODE — JSON config:
{
  "screensync": {
    "command": "node",
    "args": ["<HUB_DIR>/screensync-hub.js"],
    "env": { "SCREEN_SYNC_TOKEN": "${token}" }
  }
}

▶ DIRECT HTTP / SSE (Zero local Node setup needed):
Base URL: ${hubUrl}
Bearer Token: ${token}
Key Endpoints:
  GET  /api/mcp/catalog        Full tool, prompt, and skill catalog
  GET  /api/device/status      Phone connection, screen bounds, battery
  GET  /api/screens/latest     Latest Android screen as base64 image
  POST /api/web/tool           Execute web_* tool through the Chrome extension
  GET  /api/web/status         Browser bridge presence + active tab
  GET  /api/inspections/latest Published UI bug regions
  GET  /api/patches/latest     Published git fixes for one-tap apply
mDNS Discovery: ${MDNS_TYPE} (Auto-discovery on local Wi-Fi / LAN)

─────────────────────────────────────────────────────
2. MASTER AUTONOMOUS COGNITIVE PROTOCOL (/screensync-operator)
─────────────────────────────────────────────────────
When driving ScreenSync, always execute the OODA Loop:
1. OBSERVE:
   • For BROWSER: Call web_status first, then web_hierarchy (structured DOM) and web_screenshot.
   • For PHONE: Call get_device_status first, then get_ui_hierarchy and get_latest_screenshot.
2. ORIENT:
   • Detect modals (div[role="dialog"]), overlays, cookie banners, login walls, or permissions.
   • Identify dynamic frameworks (React, Lexical, Quill, Draft.js, Flutter Canvas).
3. DECIDE:
   • Choose shortest reliable path: Intent URL > in-page form > deep nested menus.
   • Locate elements by hierarchy text/index instead of fragile guessed selectors.
4. ACT:
   • Browser: web_click (with visual halo), web_type (rich-text aware), web_navigate, web_scroll.
   • Genuine Hardware Input: web_cdp_click, web_cdp_type for anti-bot / rich-text editors.
   • Full-Length Capture: web_full_screenshot (CDP scrolling capture), web_pdf.
   • Mobile: control_tap_text, control_type, control_swipe, control_launch_app.
5. AUTONOMOUS VERIFICATION (MANDATORY):
   • NEVER ask the user to "check manually" or "see if it worked".
   • Wait 2-3s for mutations, read web_hierarchy / control_screenshot, verify timestamp and state transition.

─────────────────────────────────────────────────────
3. COMPLETE TOOL SUITE (27+ Tools)
─────────────────────────────────────────────────────
🌐 BROWSER WEB TOOLS (Real Chrome tabs via ScreenSync extension):
  • web_status          Check bridge presence & active tab info
  • web_screenshot      High-res capture of visible viewport
  • web_full_screenshot Full-page scrolling screenshot beyond viewport (CDP)
  • web_pdf             Export active tab as PDF (CDP)
  • web_hierarchy       DOM structure + interactive elements + sensitive field masking
  • web_click           Click element by text / index / selector (with neon laser halo)
  • web_type            Type into inputs & contenteditable editors (with neon halo)
  • web_paste           Instant clipboard injection for long text / markdown
  • web_clear           Clear input or rich text area completely
  • web_highlight       Draw pulsing neon border around target element
  • web_hover           Hover element to trigger dropdowns / tooltips
  • web_select          Select option in native <select> dropdowns
  • web_key             Simulate keyboard events (Enter, Tab, Esc, Arrows)
  • web_eval            Evaluate JS expression in page context & return JSON
  • web_console         Read real-time console logs, errors & unhandled rejections
  • web_network         Track fetch / XHR requests, status codes & durations
  • web_dialog          Read and auto-handle alert / confirm / prompt dialogs
  • web_storage         Inspect & modify localStorage, sessionStorage, cookies
  • web_perf            Core Web Vitals (FCP, LCP, CLS) & slowest resources
  • web_wait_for        Wait for selector or text before proceeding
  • web_navigate        Navigate active tab or open new tab (in AI Tab Group)
  • web_tabs / web_tab  List open tabs, switch active tab, or close tabs
  • web_watch           Real-time 500ms multi-frame capture with change detection
  • web_cdp_click       Hardware-level trusted mouse click via Chrome DevTools Protocol
  • web_cdp_type        Hardware-level trusted keyboard input via CDP
  • web_extension_reload Programmatically hot-reload the unpacked extension

📱 ANDROID MOBILE TOOLS (Real Android phone via ScreenSync app & ADB):
  • get_device_status     Connection status, screen size, battery, orientation
  • get_latest_screenshot High-res screenshot from phone MediaProjection
  • get_ui_hierarchy      Accessibility node tree with bounds, text, clickable states
  • control_tap           Hardware ADB touch at exact (x, y) coordinates
  • control_tap_text      Tap element by matching visible text
  • control_type          Type text into focused Android input field
  • control_swipe         Vertical or horizontal drag / swipe gesture
  • control_swipe_until   Scroll repeatedly until target text or element appears
  • control_launch_app    Launch app by package name (e.g. com.twitter.android)
  • control_open_url      Open URL or deep link directly in mobile browser
  • compare_frames        Visual pixel diffing between two captured frames
  • wait_for_frame        Wait for screen animation / transition to settle
  • get_logcat            Filter and stream Android system logs for crashes / errors
  • publish_inspection    Overlay AI bug inspection regions on phone screen
  • publish_patch         Publish unified git diff for one-tap apply

─────────────────────────────────────────────────────
4. PRE-BUNDLED AUTONOMOUS SKILLS & PROMPTS
─────────────────────────────────────────────────────
Ask your agent to run any of these bundled prompt skills:
  • screensync_operator     Master cognitive pilot across both browser and phone
  • web_autonomous_agent    Execute any complex multi-step web task end-to-end
  • mobile_autonomous_agent Execute any complex multi-step Android task end-to-end
  • web_social_publish      Zero-fail social publisher for X, LinkedIn, Facebook, Reddit
  • mobile_social_publish   Native app social publisher for Android
  • web_visual_qa           Full visual & responsiveness audit with proof
  • web_perf_audit          Core Web Vitals & performance optimization audit
  • web_debug_session       Live console/network debugging with root-cause report
  • web_form_autofill       Safe multi-step form filling with visual verification
  • web_watch_flow          Frame-by-frame video narration of dynamic UI transitions
  • web_multitab_workflow   Multi-tab parallel comparison & workflow execution
  • accessibility_audit     WCAG AA audit of mobile or web screens
  • reproduce_bug           Step-by-step bug reproduction with diff proof

─────────────────────────────────────────────────────
AFTER CONNECTING
─────────────────────────────────────────────────────
1. Call get_mcp_catalog to confirm tool synchronization.
2. Call get_device_status (for phone) and web_status (for browser).
3. Start operating autonomously!
`;
}

// One-paste autonomous setup: hand it to any MCP-capable agent (Claude Code,
// Antigravity, Qoder, Cursor, Cline…) and it connects, configures, and operates
// with zero manual setup.
export function buildAgentSetupPrompt({ hubUrl, token }) {
  return `You are now operating with ScreenSync MCP — the unified AI bridge for my live Android phone and live Chrome browser tabs.
Hub URL: ${hubUrl}
Pairing Token: ${token}

Your mission is to operate autonomously as a master senior operator using the /screensync-operator cognitive protocol:
1. ALWAYS OBSERVE FIRST: Call web_status for the browser or get_device_status for the phone before executing actions.
2. NEVER GUESS: Use web_hierarchy or get_ui_hierarchy to obtain exact element bounds, selectors, and indexes.
3. PREFER RELIABLE PATHS: Use direct compose/intent URLs for social publishing, genuine CDP hardware clicks/types (web_cdp_click, web_cdp_type) for rich editors, and full-page screenshots (web_full_screenshot) for audits.
4. MANDATORY AUTONOMOUS VERIFICATION: Never ask me to verify. Always check DOM state, timestamps, and captured screenshots to prove success before completing a task.
5. ADVANCED CAPABILITIES READY: Full-page CDP screenshots, PDF exports, real-time laser halos, sensitive credential masking, tab grouping, performance audits, and console/network debugging.

Confirm connectivity now by calling web_status and get_device_status, then report readiness!`;
}

// 1-Click troubleshooting prompt for AI agents to automatically fix hub connection failures
export function buildHubTroubleshootPrompt({ hubUrl, error, os = 'auto' }) {
  return `You are fixing a ScreenSync Hub connection issue on this computer.
Target Hub: ${hubUrl}
Detected Platform: ${os}
Error Encountered: "${error || 'Connection failed'}"

MISSION: Diagnose port availability, resolve any conflict or missing daemon, launch the ScreenSync Hub, and confirm healthy operation.

ACTION STEPS:
1. CHECK PORT AVAILABILITY & CONFLICTS:
   - On macOS / Linux: Run \`lsof -i :3000\` to check which process is listening.
     If an unrelated process (e.g. Next.js, Node dev server, Python, Docker) is holding port 3000, either free it or start the hub on port 3001 using \`SCREEN_SYNC_PORT=3001 ./start-hub.sh 3001\`.
   - On Windows: Run \`netstat -ano | findstr :3000\`. If occupied, either terminate the process or run \`start-hub.bat 3001\`.
2. LOCATE SCREENSYNC HUB FOLDER:
   - Search for the unzipped hub directory (e.g. ~/Downloads/screensync-hub or current repo mcp-server/).
   - Ensure "start-hub.bat", "start-hub.sh", or "dist/index.js" is present.
3. PREPARE DEPENDENCIES:
   - Inside the hub directory, if "node_modules" is missing, run: \`npm install --omit=dev\`
4. START THE HUB DAEMON:
   - On macOS / Linux: Run \`sh start-hub.sh\` (or \`SCREEN_SYNC_PORT=3001 ./start-hub.sh 3001\`)
   - On Windows: Run \`start-hub.bat\` (or \`start-hub.bat 3001\`)
5. VERIFY HEALTH:
   - Run: \`curl -s http://127.0.0.1:3000/health\` (or port 3001)
     Expected JSON response: {"ok":true,"service":"screensync-hub",...}
   - Verify identity: service must strictly equal "screensync-hub".
6. REPORT SUCCESS:
   - Once healthy, report the running port to the user so they can click 'Connect & Continue' in their Chrome extension!`;
}

