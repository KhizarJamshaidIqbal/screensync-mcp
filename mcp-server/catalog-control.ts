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
        "Taps the phone screen. Coordinates may be absolute pixels OR normalized [0..1] (auto-detected). count: 2 double-taps: both taps run back to back in one shell on the phone (no adb round trip between them), but each still starts its own input process, so on a slow phone verify the result (compare_frames). Use control_screenshot first to locate the target.",
      inputSchema: {
        type: "object",
        required: ["x", "y"],
        properties: {
          x: { type: "number", description: "X (pixels, or 0..1 fraction of width)." },
          y: { type: "number", description: "Y (pixels, or 0..1 fraction of height)." },
          count: { type: "integer", enum: [1, 2], default: 1, description: "2 double-taps the point." },
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
      description:
        "Types text into the currently focused field, exactly as given: every printable ASCII character is kept (quotes, & ? $ ; % and spaces included). Unicode typing is not supported yet: non-ASCII text returns code UNICODE_NOT_SUPPORTED with the count of affected characters, and newlines or tabs return CONTROL_CHARACTERS_NOT_SUPPORTED (type the parts and press control_key enter/tab between them). Nothing is typed when it refuses.",
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
        "Presses a hardware/navigation/editing key: back, home, recents, menu, enter, tab, delete, escape, space, search, power, volume_up, volume_down, dpad_up/down/left/right/center, paste (the clipboard into the focused field), move_end (cursor to the end of the field), select_all (ctrl+a via input keycombination, Android 13+; older Android returns KEY_COMBINATION_NOT_SUPPORTED: long-press the field and control_tap_text 'Select all' instead).",
      inputSchema: {
        type: "object",
        required: ["key"],
        properties: { key: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "control_launch_app",
      description:
        "Launches an app by package name (e.g. com.android.settings) or package/activity. Without the exact package, pass query: a case-insensitive substring of the PACKAGE name (not the home-screen label: Gmail is com.google.android.gm), matched against the launcher apps. One match launches it; several return code AMBIGUOUS with the candidates (it never guesses: pass the one you mean as package); none returns NOT_FOUND. list: true returns the launcher apps' package names instead of launching (with query, only the matches). thirdPartyOnly: true narrows query and list to user-installed apps. On an older Android without the launcher query the list is the user-installed apps only (source: third-party). Give package, or query / list.",
      inputSchema: {
        type: "object",
        properties: {
          package: { type: "string", maxLength: 200, description: "Exact package, or package/activity." },
          query: { type: "string", maxLength: 100, description: "Case-insensitive substring of the package name, e.g. 'whatsapp'." },
          list: { type: "boolean", default: false, description: "Return the launcher apps' package names; launch nothing." },
          thirdPartyOnly: { type: "boolean", default: false, description: "With query or list: user-installed apps only." },
        },
        additionalProperties: false,
      },
    },

    // ── Advanced control / inspection (v2.6) ──
    {
      name: "get_ui_hierarchy",
      description:
        "Returns the on-screen UI elements via uiautomator. Each node: text, desc, resourceId, className, clickable, pixel bounds and center, plus state: the flags that apply (disabled, checkable, checked, focused, scrollable, longClickable, password, selected; absent when none). fields picks keys instead (any node key, or state); fields ['all'] returns every key: each flag as a boolean, package, index, depth and parent (index of the nearest listed ancestor, null at the top). Default view: nodes with text, a description or a click, plus scroll containers, EditText fields and toggles; all:true lists every node (large: cut it with fields or maxDepth). Filters combine; format 'tree' nests children. A failed dump is retried once, then returns code UI_DUMP_FAILED (retryable), never an older screen's tree. Use this to locate elements PRECISELY instead of guessing tap coordinates from a screenshot.",
      inputSchema: {
        type: "object",
        properties: {
          onlyClickable: { type: "boolean", default: false, description: "Return only clickable elements." },
          filter: { type: "string", description: "Case-insensitive substring to filter node text/desc." },
          all: { type: "boolean", default: false, description: "Every node, not just the default view." },
          enabled: { type: "boolean", description: "true: only enabled nodes; false: only disabled ones. Omit for both." },
          checked: { type: "boolean", description: "true: only checked nodes (switches, checkboxes); false: only unchecked ones." },
          scrollable: { type: "boolean", description: "true: only scroll containers; false: no scroll containers." },
          className: { type: "string", maxLength: 200, description: "Case-insensitive substring of the class, e.g. 'Switch' or 'EditText'." },
          region: {
            type: "object",
            description: "Screen rectangle in pixels, or 0..1 fractions when all four values are in 0..1.",
            required: ["x1", "y1", "x2", "y2"],
            properties: {
              x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" },
              mode: { type: "string", enum: ["intersect", "inside"], default: "intersect", description: "intersect: the node overlaps the rectangle; inside: it lies wholly in it." },
            },
            additionalProperties: false,
          },
          maxDepth: { type: "integer", minimum: 0, maximum: 200, description: "Only nodes at most this deep (the root is 0)." },
          fields: {
            type: "array",
            uniqueItems: true,
            description: "Keys per node instead of the default ones, e.g. ['text','center','state']; ['all'] returns every key.",
            items: {
              type: "string",
              enum: [
                "text", "desc", "resourceId", "className", "clickable", "bounds", "center", "enabled", "checkable", "checked",
                "focusable", "focused", "scrollable", "longClickable", "password", "selected", "package", "index", "depth", "parent",
                "state", "all",
              ],
            },
          },
          format: { type: "string", enum: ["flat", "tree"], default: "flat", description: "flat: a list with depth and parent; tree: nested children (no parent key)." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_tap_text",
      description:
        "Taps the on-screen element whose visible text or content-description matches the query (no coordinates needed). Prefers clickable + most-specific match; index picks the Nth match in hierarchy order instead. Disabled elements are skipped unless enabled:false. Returns the tapped node and the number of matches. Use this for reliable UI navigation.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: 200, description: "Text/label to tap, e.g. 'Login' or 'Add to cart'." },
          exact: { type: "boolean", default: false, description: "Require an exact (not substring) match." },
          index: { type: "integer", minimum: 0, maximum: 500, description: "Tap the Nth match (0-based, hierarchy order) instead of the best one." },
          className: { type: "string", maxLength: 200, description: "Only elements whose class contains this, e.g. 'Button'." },
          enabled: { type: "boolean", default: true, description: "false targets a disabled element instead of an enabled one." },
          clickableOnly: { type: "boolean", default: false, description: "Only elements that are clickable themselves." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_swipe_until",
      description:
        "Scrolls in a direction until an element matching the query becomes visible (or maxSwipes is reached). Matches as control_tap_text does, so a disabled match is skipped unless enabled:false. Returns whether it was found, how many swipes it took, and the matched node.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: 200 },
          direction: { type: "string", enum: ["up", "down", "left", "right"], default: "down" },
          maxSwipes: { type: "integer", minimum: 1, maximum: 20, default: 8 },
          className: { type: "string", maxLength: 200, description: "Only elements whose class contains this." },
          enabled: { type: "boolean", default: true, description: "false looks for a disabled element instead." },
          clickableOnly: { type: "boolean", default: false, description: "Only elements that are clickable themselves." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "control_open_url",
      description:
        "Opens an http(s) URL in the device's default browser, whole: the query string (? and &) and fragment are kept. Any other scheme or a malformed URL returns code INVALID_URL. Handy for testing a live website on the phone.",
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
