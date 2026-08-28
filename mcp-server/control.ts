import { exec } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./config.js";

const run = promisify(exec);

/**
 * Remote-control transport for the phone.
 *
 * Uses ADB `input` injection (works over USB *and* wireless ADB, which is how
 * the device is already paired). The agent sees the screen via ScreenSync's
 * MediaProjection frames and drives it via these tools — a full see + act loop.
 *
 * SAFETY: input injection can do anything a user can. It is gated behind the
 * same bearer token as every other /api route, and confined to `adb input`
 * / a small allow-list of shell verbs (no arbitrary shell passthrough).
 */

// Optional: pin a specific device (ADB transport id or serial) via env, so a
// multi-device host targets the right phone. Falls back to the single device.
const ADB_TARGET = process.env.SCREEN_SYNC_ADB_TARGET || "";
const ADB_BIN = process.env.SCREEN_SYNC_ADB_BIN || "adb";

function adbPrefix(): string {
  const bin = /\s/.test(ADB_BIN) ? `"${ADB_BIN}"` : ADB_BIN;
  if (!ADB_TARGET) return bin;
  // Numeric → transport id; otherwise treat as serial (quoted for safety —
  // wireless-ADB serials can contain spaces/parentheses).
  if (/^\d+$/.test(ADB_TARGET)) return `${bin} -t ${ADB_TARGET}`;
  return `${bin} -s "${ADB_TARGET}"`;
}

async function adb(args: string): Promise<string> {
  const cmd = `${adbPrefix()} ${args}`;
  const { stdout } = await run(cmd, { maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
  return stdout.trim();
}

/** Escapes a string for `adb shell input text` (spaces → %s, strip risky chars). */
function escapeInputText(text: string): string {
  return text
    .replace(/(["'`$\\;&|<>(){}])/g, "") // drop shell metacharacters
    .replace(/ /g, "%s");
}

export type DeviceInfo = {
  available: boolean;
  serial?: string;
  model?: string;
  androidVersion?: string;
  screen?: { width: number; height: number };
  error?: string;
};

/** Confirms an ADB device is reachable and returns its basic profile. */
export async function controlDeviceInfo(): Promise<DeviceInfo> {
  try {
    // `devices` is a global adb subcommand — must NOT carry -s/-t target flags.
    const bin = /\s/.test(ADB_BIN) ? `"${ADB_BIN}"` : ADB_BIN;
    const { stdout: devices } = await run(`${bin} devices`, { timeout: 15_000 });
    const online = devices
      .split("\n")
      .slice(1)
      .some((l) => l.trim().endsWith("device"));
    if (!online) return { available: false, error: "No ADB device is online." };

    const [model, release, sizeLine, serial] = await Promise.all([
      adb("shell getprop ro.product.model").catch(() => ""),
      adb("shell getprop ro.build.version.release").catch(() => ""),
      adb("shell wm size").catch(() => ""),
      adb("get-serialno").catch(() => ""),
    ]);
    const m = sizeLine.match(/(\d+)x(\d+)/);
    return {
      available: true,
      serial: serial || undefined,
      model: model || undefined,
      androidVersion: release || undefined,
      screen: m ? { width: Number(m[1]), height: Number(m[2]) } : undefined,
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/** Screen size cache for normalized-coordinate conversion. */
let _screen: { width: number; height: number } | null = null;
async function screenSize(): Promise<{ width: number; height: number }> {
  if (_screen) return _screen;
  const line = await adb("shell wm size");
  const m = line.match(/(\d+)x(\d+)/);
  _screen = m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1080, height: 2400 };
  return _screen;
}

/** Accepts either absolute px or normalized [0..1] coords (auto-detected). */
async function toPixels(x: number, y: number): Promise<[number, number]> {
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    const s = await screenSize();
    return [Math.round(x * s.width), Math.round(y * s.height)];
  }
  return [Math.round(x), Math.round(y)];
}

export async function tap(x: number, y: number): Promise<string> {
  const [px, py] = await toPixels(x, y);
  await adb(`shell input tap ${px} ${py}`);
  log("INFO", "control tap", { px, py });
  return `tapped (${px}, ${py})`;
}

export async function swipe(
  x1: number, y1: number, x2: number, y2: number, durationMs = 300,
): Promise<string> {
  const [ax, ay] = await toPixels(x1, y1);
  const [bx, by] = await toPixels(x2, y2);
  await adb(`shell input swipe ${ax} ${ay} ${bx} ${by} ${Math.round(durationMs)}`);
  log("INFO", "control swipe", { ax, ay, bx, by, durationMs });
  return `swiped (${ax},${ay}) → (${bx},${by}) in ${durationMs}ms`;
}

/** Directional scroll helper (screen-relative), a common agent action. */
export async function scroll(direction: "up" | "down" | "left" | "right", amount = 0.6): Promise<string> {
  const s = await screenSize();
  const cx = s.width / 2;
  const cy = s.height / 2;
  const dx = s.width * amount * 0.5;
  const dy = s.height * amount * 0.5;
  switch (direction) {
    // To scroll content DOWN you swipe UP, etc.
    case "down": return swipe(cx, cy + dy, cx, cy - dy, 300);
    case "up": return swipe(cx, cy - dy, cx, cy + dy, 300);
    case "left": return swipe(cx + dx, cy, cx - dx, cy, 300);
    case "right": return swipe(cx - dx, cy, cx + dx, cy, 300);
  }
}

export async function typeText(text: string): Promise<string> {
  const safe = escapeInputText(text);
  if (!safe) return "nothing to type after sanitizing input";
  await adb(`shell input text "${safe}"`);
  log("INFO", "control type", { length: text.length });
  return `typed ${text.length} chars`;
}

// Allow-listed hardware / navigation keys → Android keycodes.
const KEYS: Record<string, number> = {
  back: 4, home: 3, recents: 187, menu: 82, power: 26,
  enter: 66, tab: 61, delete: 67, escape: 111, space: 62,
  volume_up: 24, volume_down: 25, search: 84,
  dpad_up: 19, dpad_down: 20, dpad_left: 21, dpad_right: 22, dpad_center: 23,
};

export async function pressKey(key: string): Promise<string> {
  const code = KEYS[key.toLowerCase()];
  if (code === undefined) {
    throw new Error(`Unsupported key '${key}'. Allowed: ${Object.keys(KEYS).join(", ")}`);
  }
  await adb(`shell input keyevent ${code}`);
  log("INFO", "control key", { key, code });
  return `pressed ${key}`;
}

export async function longPress(x: number, y: number, durationMs = 700): Promise<string> {
  const [px, py] = await toPixels(x, y);
  await adb(`shell input swipe ${px} ${py} ${px} ${py} ${Math.round(durationMs)}`);
  log("INFO", "control longpress", { px, py, durationMs });
  return `long-pressed (${px}, ${py}) for ${durationMs}ms`;
}

/** Launches an app by package (optionally package/activity). */
export async function launchApp(pkg: string): Promise<string> {
  if (!/^[a-zA-Z0-9_.]+(\/[a-zA-Z0-9_.]+)?$/.test(pkg)) {
    throw new Error("Invalid package/activity name.");
  }
  if (pkg.includes("/")) {
    await adb(`shell am start -n ${pkg}`);
  } else {
    await adb(`shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  }
  log("INFO", "control launch", { pkg });
  return `launched ${pkg}`;
}

/**
 * Grabs a screenshot directly via ADB (independent of the phone app's
 * MediaProjection). Returns base64 PNG so an agent can see the live screen
 * even before the ScreenSync bubble is started.
 */
export async function screenshotNow(): Promise<{ base64: string; mimeType: "image/png" }> {
  const { stdout } = await run(`${adbPrefix()} exec-out screencap -p`, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15_000,
    encoding: "buffer",
  });
  const buf = stdout as unknown as Buffer;
  if (!buf || buf.length < 8 || !(buf[0] === 0x89 && buf[1] === 0x50)) {
    throw new Error("screencap did not return a PNG (is a device connected?).");
  }
  return { base64: buf.toString("base64"), mimeType: "image/png" };
}

// ────────────────────────────────────────────────────────────────────────
// Advanced control / inspection helpers (v2.6)
// ────────────────────────────────────────────────────────────────────────

export type UiNode = {
  text: string;
  desc: string;
  resourceId: string;
  className: string;
  clickable: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  center: { x: number; y: number };
};

/**
 * Dumps the on-screen UI hierarchy via `uiautomator` and returns a flat list
 * of meaningful nodes (text / content-desc / clickable) with pixel bounds and
 * centers. Lets an agent locate elements precisely instead of guessing
 * coordinates from a screenshot.
 */
export async function uiHierarchy(): Promise<UiNode[]> {
  // Dump to device, then read it back (stdout dump is unreliable on some OEMs).
  await adb("shell uiautomator dump /sdcard/screensync_ui.xml").catch(() => "");
  const xml = await adb("shell cat /sdcard/screensync_ui.xml");
  return parseUiAutomatorXml(xml);
}

function parseUiAutomatorXml(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  const nodeRegex = /<node\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const attr = (name: string): string => {
      const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
      return m ? m[1] : "";
    };
    const text = attr("text");
    const desc = attr("content-desc");
    const clickable = attr("clickable") === "true";
    // Skip empty, non-interactive noise nodes.
    if (!text && !desc && !clickable) continue;
    const boundsRaw = attr("bounds"); // format: [x1,y1][x2,y2]
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(boundsRaw);
    if (!b) continue;
    const x1 = Number(b[1]), y1 = Number(b[2]), x2 = Number(b[3]), y2 = Number(b[4]);
    nodes.push({
      text,
      desc,
      resourceId: attr("resource-id"),
      className: attr("class"),
      clickable,
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }
  return nodes;
}

/**
 * Finds the first on-screen element whose text or content-desc matches
 * `query` (case-insensitive, substring) and taps its center. Returns the
 * matched node so the agent knows exactly what it hit.
 */
export async function tapText(query: string, exact = false): Promise<{ tapped: UiNode }> {
  const node = await findNode(query, exact);
  if (!node) throw new Error(`No on-screen element matching "${query}". Try get_ui_hierarchy to list what's visible.`);
  await adb(`shell input tap ${node.center.x} ${node.center.y}`);
  log("INFO", "control tapText", { query, x: node.center.x, y: node.center.y });
  return { tapped: node };
}

async function findNode(query: string, exact: boolean): Promise<UiNode | null> {
  const q = query.toLowerCase();
  const nodes = await uiHierarchy();
  const scored = nodes.filter((n) => {
    const hay = `${n.text} ${n.desc}`.toLowerCase();
    return exact ? (n.text.toLowerCase() === q || n.desc.toLowerCase() === q) : hay.includes(q);
  });
  // Prefer clickable matches, then the smallest (most specific) element.
  scored.sort((a, b) => {
    if (a.clickable !== b.clickable) return a.clickable ? -1 : 1;
    const areaA = (a.bounds.x2 - a.bounds.x1) * (a.bounds.y2 - a.bounds.y1);
    const areaB = (b.bounds.x2 - b.bounds.x1) * (b.bounds.y2 - b.bounds.y1);
    return areaA - areaB;
  });
  return scored[0] ?? null;
}

/**
 * Scrolls in `direction` up to `maxSwipes` times until an element matching
 * `query` appears on screen. Returns whether it was found and how many
 * swipes it took.
 */
export async function swipeUntil(
  query: string,
  direction: "up" | "down" | "left" | "right" = "down",
  maxSwipes = 8,
): Promise<{ found: boolean; swipes: number; node: UiNode | null }> {
  for (let i = 0; i <= maxSwipes; i++) {
    const node = await findNode(query, false);
    if (node) return { found: true, swipes: i, node };
    if (i < maxSwipes) {
      await scroll(direction, 0.7);
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return { found: false, swipes: maxSwipes, node: null };
}

/** Opens a URL in the device's default browser. */
export async function openUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error("openUrl requires an http(s) URL.");
  const safe = url.replace(/(["'`$\\;&|<>(){}])/g, "");
  await adb(`shell am start -a android.intent.action.VIEW -d "${safe}"`);
  log("INFO", "control openUrl", { url: safe });
  return `opened ${safe}`;
}

/**
 * Captures two screenshots with `delayMs` between them (optionally running
 * no action in between — the agent acts via other tools) and reports a
 * coarse pixel-difference ratio so it can tell whether the UI changed.
 * Both frames are returned as inline images for visual before/after.
 */
export async function compareFrames(delayMs = 1200): Promise<{
  changedRatio: number;
  before: string;
  after: string;
  mimeType: "image/png";
}> {
  const a = await screenshotNow();
  await new Promise((r) => setTimeout(r, Math.max(0, Math.min(delayMs, 10_000))));
  const b = await screenshotNow();
  const changedRatio = coarseDiffRatio(
    Buffer.from(a.base64, "base64"),
    Buffer.from(b.base64, "base64"),
  );
  return { changedRatio, before: a.base64, after: b.base64, mimeType: "image/png" };
}

/**
 * Very cheap change signal: compares the two PNG byte buffers by length and
 * a sampled byte delta. Not a real image diff (they're compressed), but a
 * reliable "did anything change?" heuristic without an image library.
 */
function coarseDiffRatio(a: Buffer, b: Buffer): number {
  if (a.length === 0 || b.length === 0) return 1;
  const lenDelta = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  // Sample up to 4096 evenly-spaced bytes from the shorter buffer.
  const n = Math.min(a.length, b.length);
  const samples = Math.min(4096, n);
  const step = Math.max(1, Math.floor(n / samples));
  let diff = 0, count = 0;
  for (let i = 0; i < n; i += step) {
    if (a[i] !== b[i]) diff++;
    count++;
  }
  const byteDelta = count === 0 ? 0 : diff / count;
  // Weight length change heavily (compressed size shifts with real change).
  return Math.min(1, lenDelta * 0.6 + byteDelta * 0.4);
}

/**
 * Reads recent logcat lines, optionally filtered to a package's PID and/or a
 * text grep. Great for surfacing Flutter/Dart errors and crashes.
 */
export async function getLogcat(opts: { pkg?: string; grep?: string; lines?: number } = {}): Promise<string> {
  const lines = Math.max(10, Math.min(opts.lines ?? 200, 2000));
  let pidFilter = "";
  if (opts.pkg && /^[a-zA-Z0-9_.]+$/.test(opts.pkg)) {
    const pid = (await adb(`shell pidof ${opts.pkg}`).catch(() => "")).trim().split(/\s+/)[0];
    if (pid) pidFilter = `--pid=${pid}`;
  }
  // -d dumps and exits; -t limits to the most recent N lines.
  const raw = await adb(`shell logcat -d -t ${lines} ${pidFilter}`).catch(() => "");
  if (opts.grep) {
    const g = opts.grep.toLowerCase();
    return raw
      .split("\n")
      .filter((l) => l.toLowerCase().includes(g))
      .join("\n") || "(no lines matched the filter)";
  }
  return raw || "(logcat empty)";
}

/**
 * Records a short screen clip on-device (screenrecord) and pulls it back as
 * base64 mp4. Capped duration so it never blocks the agent for long.
 */
export async function recordScreen(seconds = 5): Promise<{ base64: string; mimeType: "video/mp4"; seconds: number }> {
  const dur = Math.max(1, Math.min(seconds, 15));
  const remote = "/sdcard/screensync_rec.mp4";
  // screenrecord blocks for the duration; add a small buffer to the timeout.
  await run(`${adbPrefix()} shell screenrecord --time-limit ${dur} --bit-rate 4000000 ${remote}`, {
    maxBuffer: 8 * 1024 * 1024,
    timeout: (dur + 8) * 1000,
  });
  const { stdout } = await run(`${adbPrefix()} exec-out cat ${remote}`, {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 20_000,
    encoding: "buffer",
  });
  await adb(`shell rm -f ${remote}`).catch(() => "");
  const buf = stdout as unknown as Buffer;
  log("INFO", "control recordScreen", { seconds: dur, bytes: buf.length });
  return { base64: buf.toString("base64"), mimeType: "video/mp4", seconds: dur };
}
