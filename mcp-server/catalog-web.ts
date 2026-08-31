// Web bridge tool definitions (browser access for AI agents). Kept separate
// from catalog.ts so the shared catalog stays under the file-size budget.
// These run the user's real browser tabs through the ScreenSync browser
// extension, mirroring the phone control surface. They require the extension
// to be paired to this hub with Web access enabled.

export function webToolDefinitions() {
  return [
    {
      name: "web_status",
      description:
        "Reports whether the ScreenSync browser extension is connected and Web access is enabled, plus the currently active browser tab. Always call this before any web_* action.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "web_screenshot",
      description:
        "Captures the currently active browser tab as an inline image (what the user is actually looking at). Requires the extension connected with Web access enabled.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
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
  ];
}

// Agent-facing skills (MCP prompts) for the browser extension. Message
// builders live in prompts.ts; these definitions are what clients list.
export function webSkillDefinitions() {
  return [
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
  ];
}
