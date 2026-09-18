// Prompt (skill) message builders for the MCP server. Kept out of mcp.ts so
// both files stay under the 500-line budget; phone skills moved here verbatim
// and web-extension skills live beside them.

export type PromptResult = {
  description: string;
  messages: [{ role: "user"; content: { type: "text"; text: string } }];
};

const userMsg = (text: string, description: string): PromptResult => ({
  description,
  messages: [{ role: "user", content: { type: "text", text } }],
});

export function promptMessage(name: string, args: Record<string, string>): PromptResult | null {
  if (name === "screensync_operator") {
    const task = args.task || "Autonomously operate ScreenSync across web browser tabs and mobile phone";
    return userMsg(
      [
        `You are the ScreenSync Master Operator. Execute this mission with 100% autonomy: ${task}.`,
        "",
        "── THE GOLDEN RULE: COGNITIVE OODA LOOP ──",
        "1. OBSERVE: web_page_observe (zero-mutation VOM with occlusion & cursor pagination) / web_hierarchy / get_ui_hierarchy + web_screenshot (longPage for feeds) / get_latest_screenshot.",
        "2. ORIENT: Detect modals, popups, cookie banners, contenteditable containers, or system permission dialogs.",
        "3. DECIDE: Select the fastest zero-fail path (intent URL > in-page typing; hierarchy-driven text tap > coordinate guess; web_request_help for CAPTCHA/2FA).",
        "4. ACT: Multi-layer input events, genuine CDP hardware clicks/keystrokes, ADB touch/type/swipe.",
        "5. VERIFY (MANDATORY): Never ask the user to verify. Read DOM, confirm timestamp, extract permalinks, capture visual proof.",
        "",
        "── COMPREHENSIVE TOOL REFERENCE ──",
        "• Browser Web Tools: web_status, web_page_observe, web_screenshot, web_screenshot_read, web_full_screenshot, web_pdf, web_hierarchy, web_click, web_type, web_paste, web_clear, web_highlight, web_hover, web_select, web_key, web_eval, web_console, web_network, web_dialog, web_storage, web_perf, web_wait_for, web_navigate, web_tabs, web_tab, web_watch, web_request_help, web_agent_window, web_cdp_click, web_cdp_type, web_extension_reload.",
        "• Android Mobile Tools: get_device_status, get_latest_screenshot, get_ui_hierarchy, control_tap, control_tap_text, control_type, control_swipe, control_swipe_until, control_launch_app, control_open_url, compare_frames, wait_for_frame, get_logcat, publish_inspection, publish_patch.",
      ].join("\n"),
      "ScreenSync Master Operator with full OODA loop protocol across web and mobile",
    );
  }

  if (name === "inspect_latest_mobile_screen") {
    const focus = args.focus || "layout, rendering, accessibility, and interaction defects";
    return userMsg(
      `Use get_device_status, then get_latest_screenshot. Inspect the actual image for ${focus}. Report evidence, severity, likely Flutter cause, and a concrete fix. Ask for another bubble capture to verify the fix.`,
      "Inspect the latest captured mobile screen",
    );
  }

  if (name === "autonomous_ui_test") {
    const target = args.target || "the current screen";
    const goal = args.goal || "find any layout, rendering, or interaction defects";
    return userMsg(
      [
        `You are driving a real Android phone via ScreenSync. Autonomously UI-test: ${target}.`,
        `Goal: ${goal}.`,
        "",
        "Loop:",
        "1. Open the target (control_launch_app for a package, or control_open_url for a URL).",
        "2. control_screenshot to SEE the screen; get_ui_hierarchy to know what's tappable.",
        "3. Inspect the image for defects (overflow, clipping, contrast, spacing, broken images).",
        "4. Navigate with control_tap_text / control_swipe_until (never guess coordinates — use the hierarchy).",
        "5. After each action, use compare_frames to confirm the UI changed as expected.",
        "6. Check get_logcat (grep 'exception'/'error') for runtime errors after risky actions.",
        "Report a concise findings list with severity + evidence. Stop when the goal is met or no new screens remain.",
      ].join("\n"),
      "Autonomous UI test driver",
    );
  }

  if (name === "reproduce_bug") {
    const steps = args.steps || "(no steps provided)";
    const expected = args.expected ? `Expected behaviour: ${args.expected}.` : "";
    return userMsg(
      [
        "Reproduce this bug on the live phone via ScreenSync, documenting each step.",
        `Steps:\n${steps}`,
        expected,
        "",
        "For EACH step: control_screenshot before, perform the action (prefer control_tap_text), then compare_frames after.",
        "After the final step, call get_logcat (grep 'exception') to capture any stack trace.",
        "Report: what actually happened vs expected, the exact step where it diverged, the screenshot evidence, and the logcat lines. Then propose a likely root cause and a fix (publish_patch if you can).",
      ].join("\n"),
      "Reproduce a bug step-by-step",
    );
  }

  if (name === "accessibility_audit") {
    const standard = args.standard || "WCAG AA";
    return userMsg(
      [
        `Audit the current phone screen for accessibility against ${standard}.`,
        "1. control_screenshot to see it; get_ui_hierarchy for element sizes and labels.",
        "2. Flag tap targets smaller than 48x48dp (use the node bounds).",
        "3. Flag low text/background contrast from the image.",
        "4. Flag interactive elements with empty text AND empty content-desc (missing labels for screen readers).",
        "5. Note any text likely to clip when the user scales font size up.",
        "Report each issue with the element, its bounds, severity, and a concrete fix. Use publish_inspection to overlay the regions on the phone.",
      ].join("\n"),
      "Accessibility audit of the current screen",
    );
  }

  if (name === "web_see_and_report") {
    const focus = args.focus || "what the page is, its state, and anything noteworthy";
    return userMsg(
      [
        "Look at the user's LIVE browser tab through the ScreenSync extension and report what you see.",
        `Focus: ${focus}.`,
        "",
        "1. web_status — confirm the bridge is online and Web access is enabled. If not, STOP and ask the user to enable 'Web access for AI agents' in the extension dashboard.",
        "2. web_screenshot — see the tab exactly as the user does; include the image in your reply.",
        "3. web_hierarchy — read the page text and interactive elements for precise detail.",
        "Summarize in plain words: page title/URL, what is on it, its current state, and anything relevant to the focus.",
      ].join("\n"),
      "See and describe the user's live browser tab",
    );
  }

  if (name === "web_form_autofill") {
    const goal = args.goal || "fill and submit the form on the active tab";
    const data = args.data ? `Data to use:\n${args.data}` : "Ask the user for any values you cannot infer.";
    return userMsg(
      [
        `Fill and submit a web form in the user's real browser. Goal: ${goal}.`,
        data,
        "",
        "1. web_status — stop and ask the user to enable Web access if disabled.",
        "2. web_hierarchy — list every input/select/button with its index; never guess selectors.",
        "3. web_type per field using index or selector; use web_click for checkboxes/buttons.",
        "4. web_click the submit button, then web_screenshot to confirm the result page/state.",
        "Report what was filled, what the page showed after submit, and the final screenshot.",
      ].join("\n"),
      "Fill and submit a web form safely",
    );
  }

  if (name === "web_visual_qa") {
    const url = args.url || "(no URL provided — audit the current active tab)";
    const focus = args.focus || "layout, broken UI, readability, and obvious accessibility issues";
    return userMsg(
      [
        `Audit a page in the user's REAL browser (not a headless one). Target: ${url}.`,
        `Focus: ${focus}.`,
        "",
        "1. web_status — confirm the bridge; if offline/disabled, ask the user to enable Web access.",
        "2. web_navigate to the URL (unless auditing the current tab).",
        "3. web_screenshot + web_hierarchy at the top; then web_scroll down and screenshot each viewport until the bottom.",
        "4. Inspect every image for defects: overflow, clipped text, broken images, contrast, tap-target size, horizontal scroll on narrow widths.",
        "Report a prioritized findings list with severity, evidence (screenshot + element), and a concrete fix for each.",
      ].join("\n"),
      "Visual QA of a page in the real browser",
    );
  }

  if (name === "web_reproduce_issue") {
    const steps = args.steps || "(no steps provided)";
    const expected = args.expected ? `Expected behaviour: ${args.expected}.` : "";
    return userMsg(
      [
        "Reproduce a reported web issue step-by-step in the user's real browser, capturing evidence.",
        `Steps:\n${steps}`,
        expected,
        "",
        "For EACH step: web_hierarchy to locate the element, web_click/web_type to act, web_screenshot after to verify the page changed as the step implies.",
        "After the final step, compare the last screenshot with the expected behaviour and name the exact step where reality diverged.",
        "Report: divergence step, evidence screenshots, likely cause, and a suggested fix.",
      ].join("\n"),
      "Reproduce a web issue with evidence",
    );
  }

  if (name === "web_debug_session") {
    const steps = args.steps || "(no steps provided)";
    const symptom = args.symptom ? `Reported symptom: ${args.symptom}.` : "";
    return userMsg(
      [
        "Run a full debug session in the user's real browser, collecting evidence while you act.",
        `Steps:\n${steps}`,
        symptom,
        "",
        "1. web_status — stop and ask the user to enable 'Web access for AI agents' if offline/disabled.",
        "2. web_console { clear: true } and web_network { clear: true } — start from clean buffers (hooks install automatically).",
        "3. Perform each step with web_click / web_type / web_navigate; use web_hierarchy indexes to locate elements.",
        "4. After the steps: web_console (look for errors/pageerrors), web_network (look for status >= 400 or errors), web_dialog (any intercepted dialogs), web_screenshot (final state).",
        "Correlate the evidence with the symptom. Report: findings ordered by likelihood, the exact console/network lines as proof, likely root cause, and a suggested fix.",
      ].join("\n"),
      "Debug a web issue with console/network/dialog evidence",
    );
  }

  if (name === "web_watch_flow") {
    const action = args.action || "observe the page";
    const duration = args.durationMs || "6000";
    return userMsg(
      [
        "Watch the user's live browser tab like a realtime video while performing an action.",
        `Action to perform: ${action}. Watch window: ${duration}ms.`,
        "",
        "1. web_status — stop and ask the user to enable 'Web access for AI agents' if offline/disabled.",
        `2. web_watch { durationMs: ${duration} } is ONE blocking call — so FIRST start the observation, THEN act: call web_watch with the full duration, and note that the browser keeps running; if the action must happen mid-watch, split it: web_watch (short baseline), then the action (web_click/web_type/web_scroll), then web_watch again to capture the aftermath. Never skip the final watch of the consequence.`,
        "3. Analyze EVERY returned frame in order like a video review: describe what changes between consecutive frames, timing of transitions (frame.ts offsets), and whether the visual result matches the action's intent.",
        "4. If something looks off, re-watch with web_watch or take web_screenshot for full resolution.",
        "Report a frame-by-frame narration plus a verdict: did the page behave as expected?",
      ].join("\n"),
      "Realtime frame-by-frame observation of a live action",
    );
  }

  if (name === "web_perf_audit") {
    const url = args.url || "(no URL provided — audit the current active tab)";
    return userMsg(
      [
        `Performance-audit a page in the user's REAL browser. Target: ${url}.`,
        "",
        "1. web_status — stop and ask the user to enable Web access if offline/disabled.",
        "2. web_navigate to the URL (fresh load gives honest metrics).",
        "3. web_perf — read DOMContentLoaded/load/FCP/LCP, CLS, resource count, and the 5 slowest resources.",
        "4. web_screenshot — see the rendered result.",
        "5. Judge against Core Web Vitals budgets (LCP < 2500ms, CLS < 0.1) and the slowest-resources list.",
        "Report: metric table vs budget, the 3 highest-impact optimizations (each tied to a specific slow resource or metric), and an overall grade.",
      ].join("\n"),
      "Performance audit of a page in the real browser",
    );
  }

  if (name === "web_multitab_workflow") {
    const urls = args.urls || "(no URLs provided)";
    const goal = args.goal || "complete the task across the tabs";
    return userMsg(
      [
        "Work across multiple tabs in the user's real browser.",
        `Tabs to open: ${urls}. Goal: ${goal}.`,
        "",
        "1. web_status — stop and ask the user to enable Web access if offline/disabled.",
        "2. web_tab { action: 'open', url } for each URL; web_tabs to get every tabId.",
        "3. For each tab in turn: web_tab { action: 'switch', tabId }, then act (web_hierarchy + web_click/web_type) — actions always target the ACTIVE tab, so switch before every action.",
        "4. Checkpoint with web_screenshot after meaningful progress in each tab.",
        "5. When done, web_tabs to confirm the final tab state; close scratch tabs with web_tab { action: 'close' } only if the user expects cleanup.",
        "Report per-tab outcomes and the final state, with screenshots as evidence.",
      ].join("\n"),
      "Multi-tab workflow in the real browser",
    );
  }

  if (name === "web_social_publish") {
    const platform = args.platform || "X (Twitter)";
    const content = args.content || "(no content specified)";
    const media = args.mediaUrl ? `Media attached: ${args.mediaUrl}` : "No media attached.";
    return userMsg(
      [
        `You are the ScreenSync Autonomous Social Publisher. Publish a post to ${platform} with 100% reliability.`,
        `Content to publish:\n${content}`,
        media,
        "",
        "── CRITICAL PLATFORM RULES & PRE-FLIGHT AUDIT ──",
        "1. Policy & Character Limit Audit:",
        "   - X/Twitter: 280 chars max (free) or up to 25k (premium); max 4-6 hashtags; links count as 23 chars; no spam/all-caps triggers.",
        "   - LinkedIn: 3000 chars max; top 3-5 relevant industry hashtags; professional tone; clean line spacing.",
        "   - Facebook: 63,206 chars max; concise engaging hook + call to action; clean link preview.",
        "   - Instagram / Threads: 2200 chars (IG) / 500 chars (Threads); 3-5 targeted hashtags at end.",
        "   - Reddit: Max 300 chars for title; markdown supported in body; observe subreddit-specific rules.",
        "",
        "── EXECUTION PROTOCOL (ZERO-FAIL PATTERN) ──",
        "2. web_status — Confirm web bridge is online and active.",
        "3. PREFERRED PATH — Web Intent / Direct Composer URL:",
        "   - For X/Twitter: Navigate directly to https://x.com/intent/tweet?text=<URL_ENCODED_TEXT> (pre-populates Lexical state cleanly).",
        "   - For LinkedIn: Navigate to https://www.linkedin.com/feed/ or open share dialog.",
        "   - For Reddit: Navigate to https://www.reddit.com/r/<subreddit>/submit.",
        "4. FALLBACK PATH — In-Page Rich-Text Composition:",
        "   - If navigating to in-page compose (e.g. x.com/compose/post):",
        "     a. web_hierarchy — Find active input or dialog modal (div[role='dialog']).",
        "     b. web_type { selector, text } — Dispatches multi-layer beforeinput + insertText + InputEvent for React/Lexical/Draft.js.",
        "     c. If draft saved in dialog, click draft to load into active editor.",
        "5. Submit Post:",
        "   - Locate active 'Post' / 'Tweet' / 'Publish' button using web_hierarchy (ensure button is not disabled).",
        "   - web_click the Post button.",
        "",
        "── AUTONOMOUS VERIFICATION (MANDATORY — NEVER ASK USER) ──",
        "6. Do NOT ask the user to verify! Verify it yourself:",
        "   - Wait 3 seconds, then web_navigate to user's profile timeline (e.g. https://x.com/<user>).",
        "   - web_hierarchy — Read page text; confirm the post appears at the top with timestamp ('now', 'Xs', '1m') and post counter incremented.",
        "   - Locate and extract the exact direct status permalink (e.g. /status/<id>).",
        "   - Capture web_screenshot as immutable proof.",
        "7. Report: Final status, exact published permalink, verified timestamp, and live confirmation snippet.",
      ].join("\n"),
      "Autonomous social media publisher for web platforms",
    );
  }

  if (name === "mobile_social_publish") {
    const appName = args.app || "Twitter / X";
    const content = args.content || "(no content specified)";
    return userMsg(
      [
        `You are the ScreenSync Mobile Social Publisher. Publish a post to ${appName} on the live Android phone.`,
        `Content to publish:\n${content}`,
        "",
        "── MOBILE EXECUTION PROTOCOL ──",
        "1. get_device_status — Verify phone is connected and awake.",
        "2. Launch target app:",
        "   - X/Twitter: control_launch_app { package: 'com.twitter.android' }",
        "   - LinkedIn: control_launch_app { package: 'com.linkedin.android' }",
        "   - Instagram: control_launch_app { package: 'com.instagram.android' }",
        "   - Reddit: control_launch_app { package: 'com.reddit.frontpage' }",
        "3. Observe & Locate Compose Element:",
        "   - control_screenshot + get_ui_hierarchy — Find Floating Action Button (FAB) or compose icon ('Tweet', 'Post', '+', 'Create').",
        "   - control_tap_text or control_tap on the compose button.",
        "4. Input Content:",
        "   - wait_for_frame to confirm editor screen opened.",
        "   - get_ui_hierarchy to locate the text area node.",
        "   - control_type { text: content } into the active editor.",
        "5. Submit Post:",
        "   - get_ui_hierarchy to locate the 'Post' / 'Tweet' / 'Share' top-right button.",
        "   - control_tap_text { text: 'Post' } or control_tap on button bounds.",
        "",
        "── AUTONOMOUS VERIFICATION ──",
        "6. Do NOT ask user to verify: wait 3 seconds, control_screenshot to confirm feed refresh with the new post, and compare_frames to verify published state.",
        "Report: Target app, action sequence, verified timestamp, and final screenshot confirmation.",
      ].join("\n"),
      "Autonomous social media publisher for Android mobile apps",
    );
  }

  if (name === "web_autonomous_agent") {
    const task = args.task || "complete the requested browser task";
    return userMsg(
      [
        `You are the ScreenSync Autonomous Web Agent. Execute this browser task end-to-end: ${task}.`,
        "",
        "── COGNITIVE OODA LOOP (Observe → Orient → Decide → Act → Verify) ──",
        "1. OBSERVE:",
        "   - web_status — check bridge connection and active tab.",
        "   - web_hierarchy — read DOM structure, element tags, coordinates, text, and hrefs.",
        "   - web_screenshot — visually inspect layout, modals, overlays, and dialogs.",
        "2. ORIENT:",
        "   - Check for obstacles: Cookie consent banners, login gates, CAPTCHAs, modal dialogs (div[role='dialog']), or empty states.",
        "   - Check active framework: React/Vue/Angular/Svelte (needs synthetic input events).",
        "3. DECIDE:",
        "   - Choose the shortest reliable path: direct deep link / query URL over clicking 10 menu levels.",
        "   - Select precise element selector or index from web_hierarchy.",
        "4. ACT:",
        "   - If input: web_type (uses multi-layer insertText + InputEvent for React/Lexical/Draft.js).",
        "   - If button/link: web_click (scrolls into view and clicks).",
        "   - If key shortcut: web_key (dispatches keyboard events).",
        "5. VERIFY (MANDATORY):",
        "   - NEVER assume an action succeeded. Always call web_hierarchy or web_screenshot after acting.",
        "   - If the state did not change as expected, retry with alternative selector, coordinate tap, or direct navigation.",
        "   - Stop only when objective is 100% verified.",
      ].join("\n"),
      "Autonomous general-purpose web browser agent with full OODA loop",
    );
  }

  if (name === "mobile_autonomous_agent") {
    const task = args.task || "complete the requested mobile task";
    return userMsg(
      [
        `You are the ScreenSync Autonomous Mobile Agent. Execute this Android task end-to-end: ${task}.`,
        "",
        "── COGNITIVE OODA LOOP FOR ANDROID ──",
        "1. OBSERVE:",
        "   - get_device_status — check connection, battery, orientation.",
        "   - get_ui_hierarchy — inspect accessibility node tree, resource-ids, bounds, text, and clickable attributes.",
        "   - control_screenshot — inspect visual frame for custom canvas/Flutter UI elements.",
        "2. ORIENT:",
        "   - Identify current app/package and screen state.",
        "   - Check for system dialogs (permissions, ANR, updates).",
        "3. DECIDE:",
        "   - Use control_launch_app or control_open_url for direct navigation.",
        "   - Prefer control_tap_text when node text is clear; use control_tap with center bounds coordinates for custom widgets.",
        "4. ACT:",
        "   - control_tap, control_type, control_swipe, control_key.",
        "5. VERIFY (MANDATORY):",
        "   - compare_frames or wait_for_frame to confirm visual state transition.",
        "   - Check get_logcat for runtime errors if unexpected behavior occurs.",
        "   - Stop only when objective is 100% verified.",
      ].join("\n"),
      "Autonomous general-purpose mobile agent with full OODA loop",
    );
  }

  return null;
}
