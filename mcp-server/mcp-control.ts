// Handlers for the tools declared in catalog-control.ts: phone control (control_*), the ADB inspection
// tools (get_ui_hierarchy, compare_frames, wait_for_frame, get_logcat, record_screen) and the OS plane
// (os_*). Split out of mcp.ts so the phone path can be tested without an MCP server and reused by the
// HTTP hub.
//
// runControlAction() returns a neutral ControlResult ({data, images}); toMcpContent() renders it as the
// MCP content array the tools have always returned. A handler that throws is left to the caller, which
// turns it into the usual {success:false, error} reply. liveScreenOrFrame() answers the consolidated
// mobile_control `screenshot`, which falls back to the bubble's frame when ADB cannot grab the screen.
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  compareFrames,
  ControlInputError,
  controlDeviceInfo,
  getLogcat,
  longPress,
  openUrl,
  pressKey,
  recordScreen,
  screenshotNow,
  scroll,
  swipe,
  tap,
  typeText,
} from "./control.js";
import { log } from "./config.js";
import { runLaunchApp } from "./control-apps.js";
import { readMatchArgs, readUiArgs, shapeUiNodes, swipeUntil, tapText, uiHierarchy, UiDumpError } from "./control-ui.js";
import { isOsControlEnabled } from "./os-control.js";
import { latestFrame } from "./storage.js";

type Args = Record<string, unknown> | undefined;

/** Inline media: a PNG frame, or the mp4 clip from record_screen. */
export type ControlImage = { data: string; mimeType: string };

export type ControlResult = {
  /** The JSON payload, rendered as one text block. Absent for an image-only reply (control_screenshot). */
  data?: unknown;
  /** Media placed after the text block, in order. */
  images?: ControlImage[];
  isError?: boolean;
};

type McpContent = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;

/** Renders a ControlResult as MCP tool content, in exactly the shapes these tools returned before the split. */
export function toMcpContent(result: ControlResult): { content: McpContent; isError?: boolean } {
  const content: McpContent = [];
  if (result.data !== undefined) content.push({ type: "text", text: JSON.stringify(result.data, null, 2) });
  for (const image of result.images ?? []) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  // A reply with media never carried isError; a text-only reply always did (false or true).
  if (result.images?.length && !result.isError) return { content };
  return { content, isError: result.isError ?? false };
}

const ok = (detail: unknown): ControlResult => ({ data: { success: true, detail } });
const fail = (data: Record<string, unknown>): ControlResult => ({ data: { success: false, ...data }, isError: true });

/**
 * OS-level control (os_mouse_click / os_type / os_hotkey) moves the real mouse and types real keys
 * anywhere on the machine, outside any browser tab, so it sits outside both the web-access toggle and
 * the per-origin action grants. It is therefore OFF unless the operator opts in explicitly on the
 * machine that runs the hub (isOsControlEnabled). See docs: SCREENSYNC_ALLOW_OS_CONTROL.
 */
const OS_CONTROL_DISABLED = fail({
  enabled: false,
  error:
    "OS-level control is disabled. It drives the real mouse and keyboard outside the browser, so it is off by default. Set SCREENSYNC_ALLOW_OS_CONTROL=1 on the hub host and restart the hub to enable it.",
});

const HANDLERS: Record<string, (args: Args) => Promise<ControlResult>> = {
  // ── Remote control (gesture / input) ──
  control_status: async () => ({ data: await controlDeviceInfo() }),
  control_screenshot: async () => {
    const shot = await screenshotNow();
    return { images: [{ data: shot.base64, mimeType: shot.mimeType }] };
  },
  control_tap: async (args) => {
    const a = args as { x: number; y: number; count?: number };
    return ok(await tap(a.x, a.y, a.count));
  },
  control_long_press: async (args) => {
    const a = args as { x: number; y: number; durationMs?: number };
    return ok(await longPress(a.x, a.y, a.durationMs));
  },
  control_swipe: async (args) => {
    const a = args as { x1: number; y1: number; x2: number; y2: number; durationMs?: number };
    return ok(await swipe(a.x1, a.y1, a.x2, a.y2, a.durationMs));
  },
  control_scroll: async (args) => {
    const a = args as { direction: "up" | "down" | "left" | "right"; amount?: number };
    return ok(await scroll(a.direction, a.amount));
  },
  control_type: async (args) => {
    const a = args as { text: string };
    return ok(await typeText(a.text));
  },
  control_key: async (args) => {
    const a = args as { key: string };
    return ok(await pressKey(a.key));
  },
  control_launch_app: async (args) => ({ data: { success: true, ...(await runLaunchApp(args)) } }),

  // ── Advanced control / inspection (v2.6) ──
  get_ui_hierarchy: async (args) => {
    const { query, fields, format } = readUiArgs(args);
    return { data: { success: true, ...shapeUiNodes(await uiHierarchy(query), { fields, format }) } };
  },
  control_tap_text: async (args) => {
    const a = args as { query: string };
    return ok(await tapText(a.query, readMatchArgs(args)));
  },
  control_swipe_until: async (args) => {
    const a = args as { query: string; direction?: "up" | "down" | "left" | "right"; maxSwipes?: number };
    return ok(await swipeUntil(a.query, a.direction ?? "down", a.maxSwipes ?? 8, readMatchArgs(args)));
  },
  control_open_url: async (args) => {
    const a = args as { url: string };
    return ok(await openUrl(a.url));
  },
  compare_frames: async (args) => {
    const a = args as { delayMs?: number } | undefined;
    const r = await compareFrames(a?.delayMs ?? 1200);
    return {
      data: { changedRatio: r.changedRatio, changed: r.changedRatio > 0.02 },
      images: [{ data: r.before, mimeType: r.mimeType }, { data: r.after, mimeType: r.mimeType }],
    };
  },
  wait_for_frame: async (args) => {
    const a = args as { timeoutMs?: number } | undefined;
    const timeoutMs = Math.max(1000, Math.min(a?.timeoutMs ?? 30000, 120000));
    const startLatest = (await latestFrame())?.receivedAt ?? "";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const now = await latestFrame();
      if (now && now.receivedAt !== startLatest) {
        const bytes = await readFile(now.filePath);
        return {
          data: { success: true, receivedAt: now.receivedAt, frame: now },
          images: [{ data: bytes.toString("base64"), mimeType: now.mimeType }],
        };
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return fail({ error: "No new frame arrived before timeout. Ask the user to tap the floating bubble." });
  },
  get_logcat: async (args) => {
    const a = args as { pkg?: string; grep?: string; lines?: number } | undefined;
    const text = await getLogcat({ pkg: a?.pkg, grep: a?.grep, lines: a?.lines });
    return { data: { success: true, logcat: text } };
  },
  record_screen: async (args) => {
    const a = args as { seconds?: number } | undefined;
    const clip = await recordScreen(a?.seconds ?? 5);
    return { data: { success: true, seconds: clip.seconds }, images: [{ data: clip.base64, mimeType: clip.mimeType }] };
  },

  // ── OS plane (PyAutoGUI on the hub host), off unless the operator opts in ──
  os_mouse_click: async (args) => {
    if (!isOsControlEnabled()) return OS_CONTROL_DISABLED;
    const a = args as { x: number; y: number };
    const x = Math.round(Number(a.x));
    const y = Math.round(Number(a.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return fail({ error: "os_mouse_click requires finite numeric x and y." });
    }
    execSync(`python -c "import ctypes, pyautogui; h = ctypes.windll.user32.OpenDesktopW('Default', 0, False, 0x01FF); h and ctypes.windll.user32.SetThreadDesktop(h); pyautogui.click(${x}, ${y})"`);
    return ok(`Clicked at ${x}, ${y}`);
  },
  os_type: async (args) => {
    if (!isOsControlEnabled()) return OS_CONTROL_DISABLED;
    const a = args as { text: string };
    const text = String(a.text ?? "");
    if (!text.length) {
      return fail({ error: "os_type requires text." });
    }
    // Text travels as a base64 argv argument — no shell metacharacter can break out.
    const b64 = Buffer.from(text, "utf8").toString("base64");
    execSync(`python -c "import ctypes, base64, sys, pyautogui; h = ctypes.windll.user32.OpenDesktopW('Default', 0, False, 0x01FF); h and ctypes.windll.user32.SetThreadDesktop(h); pyautogui.typewrite(base64.b64decode(sys.argv[1]).decode('utf-8'))" ${b64}`);
    return ok(`Typed ${text.length} characters`);
  },
  os_hotkey: async (args) => {
    if (!isOsControlEnabled()) return OS_CONTROL_DISABLED;
    const a = args as { keys: string[] };
    const keys = (a.keys || []).map((k) => String(k).trim().toLowerCase());
    const allowed = /^(f([1-9]|1\d|2[0-4])|[a-z0-9]|up|down|left|right|space|tab|enter|return|esc|escape|backspace|delete|del|home|end|pageup|pagedown|insert|win|windows|command|option|printscreen)$/;
    if (!keys.length || !keys.every((k) => allowed.test(k))) {
      return fail({ error: `os_hotkey keys must be simple key names (letters, digits, f1-f24, modifiers, navigation keys). Got: ${(a.keys || []).join(", ")}` });
    }
    const keysStr = keys.map((k) => `'${k}'`).join(", ");
    execSync(`python -c "import ctypes, pyautogui; h = ctypes.windll.user32.OpenDesktopW('Default', 0, False, 0x01FF); h and ctypes.windll.user32.SetThreadDesktop(h); pyautogui.hotkey(${keysStr})"`);
    return ok(`Pressed hotkey ${keys.join("+")}`);
  },
};

/**
 * mobile_control `screenshot` (consolidated mode): the live screen over ADB, and when ADB cannot grab it (no
 * adb binary, no device, unauthorized) the bubble's latest upload instead, marked `live: false` with its age.
 * Before that action meant the live grab it returned the bubble's frame, so a phone that streams through the
 * bubble without ADB keeps getting an image. Either way the reply is an image and then one text block, as
 * get_latest_screenshot's is; includeMetadata: false drops the live reply's text, never the fallback's note.
 * With neither a live screen nor a frame it is code NO_SCREEN, which names the `frame` action.
 */
export async function liveScreenOrFrame(args: Args): Promise<{ content: McpContent; isError?: boolean }> {
  const includeMetadata = args?.includeMetadata !== false;
  let liveError: string;
  try {
    const shot = await screenshotNow();
    const image = { type: "image" as const, data: shot.base64, mimeType: shot.mimeType };
    if (!includeMetadata) return { content: [image] };
    const meta = { source: "adb", live: true, capturedAt: new Date().toISOString(), mimeType: shot.mimeType };
    return { content: [image, { type: "text", text: JSON.stringify(meta, null, 2) }] };
  } catch (error) {
    liveError = String(error).replace(/\s+/g, " ").trim().slice(0, 300);
  }
  const frame = await latestFrame();
  if (!frame) {
    return toMcpContent(fail({
      code: "NO_SCREEN",
      retryable: false,
      liveError,
      error:
        "No screen to return: the live grab over ADB failed and the bubble has not uploaded a frame. Connect the phone over ADB (control_status says why it is unreachable), or start capture on the phone and tap the floating bubble; mobile_control action \"frame\" then returns that upload.",
    }));
  }
  log("WARN", "mobile_control screenshot: no live screen over ADB, returning the bubble frame", { error: liveError });
  const bytes = await readFile(frame.filePath);
  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(frame.receivedAt)) / 1000));
  const note = `Not live: ADB could not grab the screen, so this is the bubble's latest upload (what mobile_control action "frame" returns), received ${ageSeconds}s ago. The phone may have moved on: tap the bubble for a fresh one.`;
  const meta = { ...(includeMetadata ? frame : {}), source: "bubble", live: false, ageSeconds, liveError, note };
  return {
    content: [
      { type: "image", data: bytes.toString("base64"), mimeType: frame.mimeType },
      { type: "text", text: JSON.stringify(meta, null, 2) },
    ],
  };
}

/** True for every tool runControlAction() answers (the tools declared in catalog-control.ts). */
export function isControlTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HANDLERS, name);
}

/** The tool names runControlAction() answers, in declaration order. */
export function controlActionNames(): string[] {
  return Object.keys(HANDLERS);
}

/**
 * Runs one phone, ADB-inspection or OS-plane tool. An unknown name is an error result, and so are a UI dump
 * that failed twice (code UI_DUMP_FAILED, retryable) and an input the phone cannot take (ControlInputError:
 * UNICODE_NOT_SUPPORTED, INVALID_URL, AMBIGUOUS, NOT_FOUND, ...; not retryable). Anything else the action
 * throws is left to the caller.
 */
export async function runControlAction(name: string, args?: Record<string, unknown>): Promise<ControlResult> {
  if (!isControlTool(name)) return fail({ error: `Unknown tool: ${name}` });
  try {
    return await HANDLERS[name](args);
  } catch (error) {
    if (error instanceof UiDumpError) return fail({ code: error.code, retryable: error.retryable, error: error.message });
    if (error instanceof ControlInputError) {
      return fail({ code: error.code, retryable: error.retryable, ...error.details, error: error.message });
    }
    throw error;
  }
}
