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

  return null;
}
