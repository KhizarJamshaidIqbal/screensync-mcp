// Screen state (control-state.ts): screen on, lock screen, focused app and rotation from dumpsys, and the
// advisory warnings control_screenshot carries. The parsers run on recorded dumpsys excerpts (Android 16
// emulator), an edited locked copy and a synthetic older spelling; the tools run with a scripted adb fake.
// No phone is touched.

import "./_isolate-data-dir.js";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { setAdbRunner } from "../control-adb.js";
import { looksBlank, parsePowerState, parseWindowState, screenshotWarnings, screenState } from "../control-state.js";
import { controlHttpBody } from "../hub-control.js";
import { runControlAction, toMcpContent } from "../mcp-control.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/adb/${name}`, import.meta.url)), "utf-8");

function chunk(type: string, payload: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + payload.length);
  return out;
}

/** An 8-bit RGBA PNG whose rows come from `row(y)` (without the filter byte). */
function png(width: number, height: number, row: (y: number) => Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), row(y)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// The screen-off frame screencap returned on the emulator was 15.6 KB for 1080x2400; a black one deflates to ~10 KB.
const BLACK = png(1080, 2400, () => Buffer.alloc(1080 * 4));
const NOISY = png(400, 400, () => randomBytes(400 * 4));

type Phone = { power?: string; window?: string; shot?: Buffer; online?: boolean };

/** A scripted phone; returns the adb commands it saw (without the -s/-t target flags). */
function fakePhone(p: Phone): string[] {
  const calls: string[] = [];
  setAdbRunner(async (_bin, argv) => {
    const bare = argv[0] === "-s" || argv[0] === "-t" ? argv.slice(2) : argv;
    const cmd = bare.join(" ");
    calls.push(cmd);
    const reply = (s: string) => Buffer.from(s, "utf8");
    if (cmd === "devices") return reply(p.online === false ? "List of devices attached\n\n" : "List of devices attached\nemulator-5554\tdevice\n\n");
    if (cmd === "shell getprop ro.product.model") return reply("sdk_gphone64_x86_64\n");
    if (cmd === "shell getprop ro.build.version.release") return reply("16\n");
    if (cmd === "shell wm size") return reply(fixture("wm_size.txt"));
    if (cmd === "get-serialno") return reply("emulator-5554\n");
    if (cmd === "exec-out screencap -p") return p.shot ?? NOISY;
    if (cmd === "shell dumpsys power" && p.power !== undefined) return reply(p.power);
    if (cmd === "shell dumpsys window" && p.window !== undefined) return reply(p.window);
    throw new Error(`unexpected adb call: ${cmd}`);
  });
  return calls;
}

afterEach(() => setAdbRunner(null));

test("dumpsys power: Awake and Dreaming are on, Asleep and Dozing are off, and the display line is the fallback", () => {
  assert.deepEqual(parsePowerState(fixture("dumpsys_power_awake.txt")), { screenOn: true, wakefulness: "Awake" });
  assert.deepEqual(parsePowerState(fixture("dumpsys_power_asleep.txt")), { screenOn: false, wakefulness: "Asleep" });
  assert.deepEqual(parsePowerState("  mWakefulness=Dozing\n"), { screenOn: false, wakefulness: "Dozing" });
  assert.deepEqual(parsePowerState("  mWakefulness=Dreaming\n"), { screenOn: true, wakefulness: "Dreaming" });
  assert.deepEqual(parsePowerState(fixture("dumpsys_power_display_off.txt")), { screenOn: false });
  assert.deepEqual(parsePowerState("  mWakefulness=Hibernating\n"), { wakefulness: "Hibernating" }, "an unknown state is reported, not guessed");
  assert.deepEqual(parsePowerState(""), {});
});

test("dumpsys window: lock screen, focused app and rotation, recorded on an Android 16 emulator", () => {
  assert.deepEqual(parseWindowState(fixture("dumpsys_window_unlocked.txt")), {
    locked: false, secure: false, foreground: { package: "com.screensync.mcp", activity: "com.screensync.mcp.MainActivity" }, rotation: 0,
  });
  // Screen off: nothing has focus (mCurrentFocus=null), so the focused activity record names the app.
  assert.deepEqual(parseWindowState(fixture("dumpsys_window_off.txt")), {
    locked: false, secure: false, foreground: { package: "com.screensync.mcp", activity: "com.screensync.mcp.MainActivity" }, rotation: 0,
  });
  // Locked: the notification shade has focus, and the app is the one behind the lock screen.
  assert.deepEqual(parseWindowState(fixture("dumpsys_window_locked.txt")), {
    locked: true, secure: true, foreground: { package: "com.screensync.mcp", activity: "com.screensync.mcp.MainActivity" }, rotation: 0,
  });
});

test("the older spelling: mShowingLockscreen, an AppWindowToken focus and mCurrentRotation; unknown fields stay out", () => {
  assert.deepEqual(parseWindowState(fixture("dumpsys_window_legacy_locked.txt")), {
    locked: true, foreground: { package: "com.android.launcher3", activity: "com.android.launcher3.Launcher" }, rotation: 1,
  });
  assert.deepEqual(parseWindowState(""), {}, "nothing readable: every field is unknown, none is guessed");
  // DisplayRotation's mRotation is the display; the sensor's mCurrentRotation=ROTATION_0 and the config's
  // mRotation=ROTATION_0 must not override a landscape display.
  const landscape = fixture("dumpsys_window_unlocked.txt").replace("mRotation=0 mDeferred", "mRotation=1 mDeferred");
  assert.equal(parseWindowState(landscape).rotation, 1);
});

test("screenState reads dumpsys power and window through the adb runner, and a failed dumpsys only drops its fields", async () => {
  const calls = fakePhone({ power: fixture("dumpsys_power_awake.txt"), window: fixture("dumpsys_window_unlocked.txt") });
  assert.deepEqual(await screenState(), {
    screenOn: true, wakefulness: "Awake", locked: false, secure: false,
    foreground: { package: "com.screensync.mcp", activity: "com.screensync.mcp.MainActivity" }, rotation: 0,
  });
  assert.deepEqual(calls.sort(), ["shell dumpsys power", "shell dumpsys window"]);

  fakePhone({ power: fixture("dumpsys_power_asleep.txt") }); // dumpsys window fails
  assert.deepEqual(await screenState(), { screenOn: false, wakefulness: "Asleep" });
});

test("control_status adds the screen state to the device profile, and skips dumpsys when no device is online", async () => {
  fakePhone({ power: fixture("dumpsys_power_awake.txt"), window: fixture("dumpsys_window_locked.txt") });
  const status = await runControlAction("control_status", {});
  assert.deepEqual(status.data, {
    available: true, serial: "emulator-5554", model: "sdk_gphone64_x86_64", androidVersion: "16", screen: { width: 1080, height: 2400 },
    screenOn: true, wakefulness: "Awake", locked: true, secure: true,
    foreground: { package: "com.screensync.mcp", activity: "com.screensync.mcp.MainActivity" }, rotation: 0,
  });

  const calls = fakePhone({ online: false, power: "", window: "" });
  assert.deepEqual((await runControlAction("control_status", {})).data, { available: false, error: "No ADB device is online." });
  assert.equal(calls.some((c) => c.startsWith("shell dumpsys")), false);
});

test("control_screenshot: an awake, unlocked, detailed screen keeps the image-only reply", async () => {
  fakePhone({ power: fixture("dumpsys_power_awake.txt"), window: fixture("dumpsys_window_unlocked.txt"), shot: NOISY });
  const shot = toMcpContent(await runControlAction("control_screenshot", {}));
  assert.deepEqual(shot, { content: [{ type: "image", data: NOISY.toString("base64"), mimeType: "image/png" }] });
});

test("control_screenshot: screen off and a black frame warn in a text block before the image, which is still returned", async () => {
  fakePhone({ power: fixture("dumpsys_power_asleep.txt"), window: fixture("dumpsys_window_off.txt"), shot: BLACK });
  const result = await runControlAction("control_screenshot", {});
  const data = result.data as { success: boolean; warnings: Array<{ code: string; message: string }> };
  assert.equal(data.success, true);
  assert.deepEqual(data.warnings.map((w) => w.code), ["SCREEN_OFF", "LIKELY_BLANK_OR_SECURE"]);
  assert.match(data.warnings[0].message, /Asleep/);

  const mcp = toMcpContent(result);
  assert.deepEqual(mcp.content.map((c) => c.type), ["text", "image"]);
  assert.equal("isError" in mcp, false, "a warning is advice, not an error");
  // Over HTTP the route keeps {success, imageDataUrl} and gains the warnings.
  const body = controlHttpBody("control_screenshot", result);
  assert.equal(body.success, true);
  assert.equal(body.imageDataUrl, `data:image/png;base64,${BLACK.toString("base64")}`);
  assert.deepEqual((body.warnings as Array<{ code: string }>).map((w) => w.code), ["SCREEN_OFF", "LIKELY_BLANK_OR_SECURE"]);
});

test("control_screenshot: the lock screen warns LOCKED, says a PIN is needed, and never suggests unlocking it", async () => {
  fakePhone({ power: fixture("dumpsys_power_awake.txt"), window: fixture("dumpsys_window_locked.txt"), shot: NOISY });
  const data = (await runControlAction("control_screenshot", {})).data as { warnings: Array<{ code: string; message: string }> };
  assert.deepEqual(data.warnings.map((w) => w.code), ["LOCKED"]);
  assert.match(data.warnings[0].message, /PIN, pattern or password/);
  assert.match(data.warnings[0].message, /never try to unlock/);
});

test("looksBlank: a flat frame is blank, a detailed one is not, and an unreadable buffer is never flagged", () => {
  assert.equal(looksBlank(BLACK), true, `${BLACK.length} bytes for 1080x2400`);
  assert.equal(looksBlank(NOISY), false);
  assert.equal(looksBlank(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])), false, "a truncated PNG has no size to judge");
  assert.equal(looksBlank(Buffer.from("not an image")), false);
  assert.deepEqual(screenshotWarnings({}, NOISY), [], "an unknown state warns about nothing");
});
