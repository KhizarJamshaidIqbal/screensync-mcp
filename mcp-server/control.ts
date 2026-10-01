import { log } from "./config.js";
import { adb, adbBuffer, parseWmSize, resolveTarget, screenSize, type ScreenSize } from "./control-adb.js";

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
 *
 * Every adb call goes through adb()/adbBuffer() in control-adb.ts as an argv
 * array (execFile, no host shell). SCREEN_SYNC_ADB_TARGET optionally pins a
 * device (transport id or serial) so a multi-device host targets the right phone.
 */

/** Escapes a string for `adb shell input text` (spaces → %s, strip risky chars). */
export function escapeInputText(text: string): string {
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
    // `devices` is a global adb subcommand, so resolveTarget() runs it without -s/-t target flags.
    // With several online it pins the ip:port serial over an mDNS alias for the same phone; without
    // that every later adb call dies on "more than one device/emulator".
    const { serials } = await resolveTarget();
    if (!serials.length) return { available: false, error: "No ADB device is online." };

    const [model, release, sizeLine, serial] = await Promise.all([
      adb(["shell", "getprop", "ro.product.model"]).catch(() => ""),
      adb(["shell", "getprop", "ro.build.version.release"]).catch(() => ""),
      adb(["shell", "wm", "size"]).catch(() => ""),
      adb(["get-serialno"]).catch(() => ""),
    ]);
    return {
      available: true,
      serial: serial || undefined,
      model: model || undefined,
      androidVersion: release || undefined,
      screen: parseWmSize(sizeLine) ?? undefined,
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * The fraction heuristic: a point is a [0..1] fraction of the screen only when BOTH x and y lie in
 * 0..1, so (1, 1) is the bottom-right corner while (0.5, 500) is read as pixels.
 */
export function isFractionPoint(x: number, y: number): boolean {
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

/** Maps a point to whole device pixels: a fraction point scales by `screen`, anything else is rounded. */
export function mapPoint(x: number, y: number, screen: ScreenSize): [number, number] {
  if (isFractionPoint(x, y)) return [Math.round(x * screen.width), Math.round(y * screen.height)];
  return [Math.round(x), Math.round(y)];
}

/** Accepts either absolute px or normalized [0..1] coords (auto-detected). */
async function toPixels(x: number, y: number): Promise<[number, number]> {
  // `wm size` is only read (once, then cached) for a fraction point.
  if (!isFractionPoint(x, y)) return [Math.round(x), Math.round(y)];
  return mapPoint(x, y, await screenSize());
}

export async function tap(x: number, y: number): Promise<string> {
  const [px, py] = await toPixels(x, y);
  await adb(["shell", "input", "tap", String(px), String(py)]);
  log("INFO", "control tap", { px, py });
  return `tapped (${px}, ${py})`;
}

export async function swipe(
  x1: number, y1: number, x2: number, y2: number, durationMs = 300,
): Promise<string> {
  const [ax, ay] = await toPixels(x1, y1);
  const [bx, by] = await toPixels(x2, y2);
  await adb(["shell", "input", "swipe", String(ax), String(ay), String(bx), String(by), String(Math.round(durationMs))]);
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
  // One argv element: no host shell sees it. The device's sh still does, hence escapeInputText().
  await adb(["shell", "input", "text", safe]);
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
  await adb(["shell", "input", "keyevent", String(code)]);
  log("INFO", "control key", { key, code });
  return `pressed ${key}`;
}

export async function longPress(x: number, y: number, durationMs = 700): Promise<string> {
  const [px, py] = await toPixels(x, y);
  await adb(["shell", "input", "swipe", String(px), String(py), String(px), String(py), String(Math.round(durationMs))]);
  log("INFO", "control longpress", { px, py, durationMs });
  return `long-pressed (${px}, ${py}) for ${durationMs}ms`;
}

/** Launches an app by package (optionally package/activity). */
export async function launchApp(pkg: string): Promise<string> {
  if (!/^[a-zA-Z0-9_.]+(\/[a-zA-Z0-9_.]+)?$/.test(pkg)) {
    throw new Error("Invalid package/activity name.");
  }
  if (pkg.includes("/")) {
    await adb(["shell", "am", "start", "-n", pkg]);
  } else {
    await adb(["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
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
  const buf = await adbBuffer(["exec-out", "screencap", "-p"]);
  if (!buf || buf.length < 8 || !(buf[0] === 0x89 && buf[1] === 0x50)) {
    throw new Error("screencap did not return a PNG (is a device connected?).");
  }
  return { base64: buf.toString("base64"), mimeType: "image/png" };
}

// ────────────────────────────────────────────────────────────────────────
// Advanced control / inspection helpers (v2.6). The UI tree (get_ui_hierarchy, tapText, swipeUntil)
// lives in control-ui.ts.
// ────────────────────────────────────────────────────────────────────────

/** Opens a URL in the device's default browser. */
export async function openUrl(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error("openUrl requires an http(s) URL.");
  const safe = url.replace(/(["'`$\\;&|<>(){}])/g, "");
  await adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", safe]);
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
  const pidFilter: string[] = [];
  if (opts.pkg && /^[a-zA-Z0-9_.]+$/.test(opts.pkg)) {
    const pid = (await adb(["shell", "pidof", opts.pkg]).catch(() => "")).trim().split(/\s+/)[0];
    if (pid) pidFilter.push(`--pid=${pid}`);
  }
  // -d dumps and exits; -t limits to the most recent N lines.
  const raw = await adb(["shell", "logcat", "-d", "-t", String(lines), ...pidFilter]).catch(() => "");
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
  await adb(["shell", "screenrecord", "--time-limit", String(dur), "--bit-rate", "4000000", remote], {
    maxBuffer: 8 * 1024 * 1024,
    timeoutMs: (dur + 8) * 1000,
  });
  const buf = await adbBuffer(["exec-out", "cat", remote], {
    maxBuffer: 128 * 1024 * 1024,
    timeoutMs: 20_000,
  });
  await adb(["shell", "rm", "-f", remote]).catch(() => "");
  log("INFO", "control recordScreen", { seconds: dur, bytes: buf.length });
  return { base64: buf.toString("base64"), mimeType: "video/mp4", seconds: dur };
}
