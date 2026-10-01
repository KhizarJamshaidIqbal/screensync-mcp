// Phone control (control_*), the ADB inspection tools (get_ui_hierarchy, compare_frames, wait_for_frame,
// get_logcat, record_screen) and the OS plane (os_*). Split out of catalog.ts for the 500-line rule;
// catalog.ts spreads them back at their original position, so the published tool order is unchanged.
// Every tool declared here is answered by runControlAction() in mcp-control.ts (test/control_adb.test.ts
// checks that both lists match).

export function controlToolDefinitions() {
  return [
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

    {
      name: "os_mouse_click",
      description: "Clicks the OS mouse at the specified absolute pixel coordinates using PyAutoGUI. Use this when the browser sandbox blocks web_click (e.g. chrome:// extensions).",
      inputSchema: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "os_type",
      description: "Types text at the OS level using PyAutoGUI. Use this when the browser sandbox blocks web_type.",
      inputSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "os_hotkey",
      description: "Presses a keyboard shortcut at the OS level using PyAutoGUI (e.g. ['ctrl', 'r']).",
      inputSchema: {
        type: "object",
        required: ["keys"],
        properties: {
          keys: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
  ];
}
