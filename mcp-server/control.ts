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

/**
 * A typed refusal raised BEFORE the phone is acted on (at most it was read, e.g. the app list behind an
 * AMBIGUOUS launch); `code` says why. runControlAction() turns it into
 * {success:false, code, retryable:false, ...details, error}.
 */
export class ControlInputError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, detail: string, readonly details: Record<string, unknown> = {}) {
    super(`${code}: ${detail}`);
    this.name = "ControlInputError";
  }
}

/**
 * Quotes one argument for the DEVICE's sh: adb joins `adb shell` arguments with spaces and runs the line
 * through it. Inside single quotes nothing is special, so only ' itself needs care ('\'').
 */
export function quoteForDeviceShell(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * The `input text` arguments that type `text` exactly, each quoted for the device's sh. `input text`
 * reads "%s" as a space, so spaces travel as %s, and a literal "%s" is split across two calls (each call
 * is decoded on its own, so a trailing % stays a %). Only printable ASCII can be typed this way; anything
 * else is a ControlInputError, never silently dropped.
 */
export function inputTextArgs(text: string): string[] {
  const codes = [...text].map((c) => c.codePointAt(0)!);
  const unicode = codes.filter((c) => c > 0x7f).length;
  if (unicode) {
    throw new ControlInputError(
      "UNICODE_NOT_SUPPORTED",
      `Unicode typing is not supported yet: control_type types printable ASCII only, and this text has ${unicode} non-ASCII character(s). Nothing was typed.`,
      { count: unicode },
    );
  }
  const control = codes.filter((c) => c < 0x20 || c === 0x7f).length;
  if (control) {
    throw new ControlInputError(
      "CONTROL_CHARACTERS_NOT_SUPPORTED",
      `control_type types printable ASCII only, and this text has ${control} control character(s) (newline, tab, ...). Type the parts separately and press control_key enter or tab between them. Nothing was typed.`,
      { count: control },
    );
  }
  const chunks: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "s" && text[i - 1] === "%") {
      chunks.push(current);
      current = "";
    }
    current += text[i];
  }
  if (current) chunks.push(current);
  return chunks.map((chunk) => quoteForDeviceShell(chunk.replace(/ /g, "%s")));
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

/**
 * Taps once, or twice when `count` is 2 (a double tap). The double tap is ONE device shell invocation,
 * `input tap X Y && input tap X Y`, so no adb round trip sits between the taps; every element but `&&` is a
 * whole number. Each `input tap` still starts its own process on the phone, so a slow phone can miss
 * Android's double-tap window: verify the result.
 */
export async function tap(x: number, y: number, count = 1): Promise<string> {
  if (count !== 1 && count !== 2) {
    throw new ControlInputError("INVALID_TAP_COUNT", `control_tap count must be 1 or 2, not ${String(count)}. Nothing was tapped.`);
  }
  const [px, py] = await toPixels(x, y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    throw new ControlInputError("INVALID_COORDINATES", "control_tap needs finite numeric x and y. Nothing was tapped.");
  }
  const point = [String(px), String(py)];
  if (count === 1) {
    await adb(["shell", "input", "tap", ...point]);
    log("INFO", "control tap", { px, py });
    return `tapped (${px}, ${py})`;
  }
  // adb joins these with spaces and the device's sh runs the line.
  await adb(["shell", "input", "tap", ...point, "&&", "input", "tap", ...point]);
  log("INFO", "control double tap", { px, py });
  return `double-tapped (${px}, ${py})`;
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

/** Types `text` exactly (printable ASCII) into the focused field. The text itself is never logged. */
export async function typeText(text: string): Promise<string> {
  const args = inputTextArgs(text);
  if (!args.length) return "nothing to type: the text is empty";
  for (const [i, arg] of args.entries()) {
    // One argv element: no host shell sees it, and the quoting above is for the device's own sh.
    await adb(["shell", "input", "text", arg]).catch((error: unknown) => {
      // adb's error message quotes the command line; keep the typed text out of it (and the hub log).
      const part = args.length > 1 ? ` on part ${i + 1} of ${args.length}` : "";
      throw new Error(`input text failed${part} (${text.length} chars): ${String(error).split(arg).join("'<text>'")}`);
    });
  }
  log("INFO", "control type", { length: text.length, calls: args.length });
  return `typed ${text.length} chars`;
}

// Allow-listed hardware / navigation / editing keys → Android keycodes.
const KEYS: Record<string, number> = {
  back: 4, home: 3, recents: 187, menu: 82, power: 26,
  enter: 66, tab: 61, delete: 67, escape: 111, space: 62,
  volume_up: 24, volume_down: 25, search: 84,
  dpad_up: 19, dpad_down: 20, dpad_left: 21, dpad_right: 22, dpad_center: 23,
  paste: 279, move_end: 123,
};

// Keys pressed together through `input keycombination`, which Android 13 (API 33) added.
const KEY_COMBOS: Record<string, number[]> = { select_all: [113, 29] }; // ctrl_left + a

/** Every key name pressKey() accepts. */
const KEY_NAMES =[...Object.keys(KEYS), ...Object.keys(KEY_COMBOS)];

export async function pressKey(key: string): Promise<string> {
  const name = key.toLowerCase();
  if (KEY_COMBOS[name]) return pressCombo(name, KEY_COMBOS[name]);
  const code = KEYS[name];
  if (code === undefined) {
    throw new Error(`Unsupported key '${key}'. Allowed: ${KEY_NAMES.join(", ")}`);
  }
  await adb(["shell", "input", "keyevent", String(code)]);
  log("INFO", "control key", { key, code });
  return `pressed ${key}`;
}

/**
 * Presses a key combination with `input keycombination`. Android 12 and older have no such command (and an
 * old `input` prints its usage yet exits 0), so the API level is read first and an older phone gets the
 * typed KEY_COMBINATION_NOT_SUPPORTED with the fallback, instead of a silent no-op.
 */
async function pressCombo(name: string, codes: number[]): Promise<string> {
  const sdk = Number.parseInt(await adb(["shell", "getprop", "ro.build.version.sdk"]).catch(() => ""), 10);
  const unsupported = (seen: string) =>
    new ControlInputError(
      "KEY_COMBINATION_NOT_SUPPORTED",
      `${name} needs input keycombination (Android 13, API 33, or later); ${seen}. Fallback: long-press the text field, then control_tap_text "Select all".`,
      { key: name, ...(Number.isFinite(sdk) ? { sdk } : {}) },
    );
  if (Number.isFinite(sdk) && sdk < 33) throw unsupported(`this phone is API ${sdk}`);
  const out = await adb(["shell", "input", "keycombination", ...codes.map(String)]);
  if (/unknown command|error/i.test(out)) throw unsupported("the phone's input command rejected it");
  log("INFO", "control key", { key: name, codes });
  return `pressed ${name}`;
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

/**
 * Opens an http(s) URL in the device's default browser. The URL is parsed (new URL) and sent whole, as
 * the parser normalises it (what a browser loads: nothing stripped, & and ? kept), in one argument quoted
 * for the device's sh. Only the host and the length are logged, and an adb failure names only those too: a
 * query string can carry a token, and the caller logs a failed tool's error.
 */
export async function openUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    throw new ControlInputError("INVALID_URL", "control_open_url needs an absolute http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ControlInputError("INVALID_URL", `control_open_url opens http(s) URLs only, not ${parsed.protocol}`);
  }
  const href = parsed.href;
  const quoted = quoteForDeviceShell(href);
  await adb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", quoted]).catch((error: unknown) => {
    // adb's message quotes the command line, and `am` may echo the intent's data: keep the URL out of both.
    let message = String(error).split(quoted).join("'<url>'").split(href).join("<url>");
    const tail = parsed.search + parsed.hash;
    if (tail) message = message.split(tail).join("<query>");
    throw new Error(`am start failed for ${parsed.host} (${href.length} chars): ${message}`);
  });
  log("INFO", "control openUrl", { host: parsed.host, length: href.length });
  return `opened ${href}`;
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
