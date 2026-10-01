// The phone control path end to end, from runControlAction() down to the adb argv, with a scripted fake
// installed through setAdbRunner(). No adb binary runs and no phone is touched; the one test that uses
// the real execFile runner points SCREEN_SYNC_ADB_BIN at node itself, so it can prove that argv reaches
// the child process verbatim without any host shell in between.

import "./_isolate-data-dir.js";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adb, setAdbRunner, type AdbRunOptions } from "../control-adb.js";
import {
  controlDeviceInfo, getLogcat, launchApp, longPress, openUrl, pressKey, recordScreen, screenshotNow, scroll, swipe,
  tap, typeText, uiHierarchy,
} from "../control.js";
import { controlActionNames, isControlTool, runControlAction, toMcpContent } from "../mcp-control.js";
import { controlToolDefinitions } from "../catalog-control.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/adb/${name}`, import.meta.url)), "utf-8");

type Call = { bin: string; argv: string[]; opts: AdbRunOptions };

/** Installs a scripted fake runner. `respond` gets the argv without the -s/-t target flags. */
function fakeAdb(respond: (cmd: string, argv: string[]) => string | Buffer): Call[] {
  const calls: Call[] = [];
  setAdbRunner(async (bin, argv, opts) => {
    calls.push({ bin, argv: [...argv], opts });
    const bare = argv[0] === "-s" || argv[0] === "-t" ? argv.slice(2) : argv;
    const out = respond(bare.join(" "), bare);
    return Buffer.isBuffer(out) ? out : Buffer.from(out, "utf8");
  });
  return calls;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const timeoutError = (cmd: string) =>
  Object.assign(new Error(`Command failed: adb ${cmd}`), { killed: true, signal: "SIGTERM", code: null });
const noEmptyArgs = (calls: Call[]) =>
  assert.ok(calls.every((c) => c.argv.every((a) => a !== "")), "no call may carry an empty argv element");

beforeEach(() => {
  delete process.env.SCREEN_SYNC_ADB_TARGET;
  delete process.env.SCREEN_SYNC_ADB_BIN;
  delete process.env.SCREENSYNC_ALLOW_OS_CONTROL; // the os_* tools must never reach PyAutoGUI here
});
afterEach(() => setAdbRunner(null));

test("'more than one device/emulator': control_status pins the ip:port serial for later calls", async () => {
  const calls = fakeAdb((cmd, argv) => {
    if (cmd === "devices") return fixture("devices_wireless_alias.txt");
    if (calls.at(-1)!.argv[0] !== "-s") throw new Error(`Command failed: adb ${argv.join(" ")}\nadb: more than one device/emulator`);
    if (cmd === "shell getprop ro.product.model") return "Pixel 8\n";
    if (cmd === "shell getprop ro.build.version.release") return "14\n";
    if (cmd === "shell wm size") return fixture("wm_size.txt");
    if (cmd === "get-serialno") return "192.168.1.20:41235\n";
    if (cmd.startsWith("shell input tap")) return "";
    throw new Error(`unexpected adb call: ${cmd}`);
  });
  // Nothing is pinned before the device list is read, and adb refuses to guess.
  await assert.rejects(tap(10, 20), /more than one device\/emulator/);

  const info = await controlDeviceInfo();
  assert.deepEqual(info, {
    available: true, serial: "192.168.1.20:41235", model: "Pixel 8", androidVersion: "14", screen: { width: 1080, height: 2400 },
  });
  assert.deepEqual(calls.find((c) => c.argv.includes("devices"))!.argv, ["devices"], "`devices` is global: no -s/-t");

  assert.equal(await tap(10, 20), "tapped (10, 20)");
  assert.deepEqual(calls.at(-1)!.argv, ["-s", "192.168.1.20:41235", "shell", "input", "tap", "10", "20"]);
  assert.ok(calls.every((c) => c.bin === "adb"), "adb from PATH when SCREEN_SYNC_ADB_BIN is unset");
});

test("the env pin wins over resolution, and SCREEN_SYNC_ADB_TARGET / _BIN are read on every call", async () => {
  process.env.SCREEN_SYNC_ADB_TARGET = "7";
  const calls = fakeAdb((cmd) => (cmd === "devices" ? fixture("devices_wireless_alias.txt") : ""));
  await controlDeviceInfo();
  await tap(1, 2);
  assert.deepEqual(calls.at(-1)!.argv, ["-t", "7", "shell", "input", "tap", "1", "2"], "a numeric pin is a transport id");

  process.env.SCREEN_SYNC_ADB_TARGET = "emulator-5554";
  process.env.SCREEN_SYNC_ADB_BIN = "C:\\Program Files\\Android\\platform-tools\\adb.exe";
  await pressKey("home");
  assert.deepEqual(calls.at(-1)!.argv, ["-s", "emulator-5554", "shell", "input", "keyevent", "3"]);
  assert.equal(calls.at(-1)!.bin, "C:\\Program Files\\Android\\platform-tools\\adb.exe", "a path with spaces, unquoted");
});

test("no online device: offline and unauthorized phones are reported as unavailable", async () => {
  const calls = fakeAdb((cmd) => (cmd === "devices" ? fixture("devices_offline_unauthorized.txt") : ""));
  assert.deepEqual(await controlDeviceInfo(), { available: false, error: "No ADB device is online." });
  assert.equal(calls.length, 1, "nothing else is asked once no device is online");
});

test("a timeout: it surfaces as an error, carries the default limits, and does not poison the size cache", async () => {
  let wmTimesOut = true;
  const calls = fakeAdb((cmd) => {
    if (cmd === "devices") throw timeoutError("devices");
    if (cmd === "shell wm size") {
      if (wmTimesOut) throw timeoutError(cmd);
      return fixture("wm_size.txt");
    }
    return "";
  });
  const info = await controlDeviceInfo();
  assert.equal(info.available, false);
  assert.match(info.error ?? "", /Command failed: adb devices/);

  await assert.rejects(tap(0.5, 0.5), /Command failed: adb shell wm size/);
  wmTimesOut = false;
  assert.equal(await tap(0.5, 0.5), "tapped (540, 1200)", "the next call reads the size again");
  assert.ok(calls.every((c) => c.opts.timeoutMs === 15_000 && c.opts.maxBuffer === 64 * 1024 * 1024));
});

test("fraction mapping: 0..1 points scale by `wm size` (read once), pixels pass through untouched", async () => {
  const calls = fakeAdb((cmd) => (cmd === "shell wm size" ? fixture("wm_size.txt") : ""));
  assert.equal(await tap(540.4, 1200.6), "tapped (540, 1201)");
  assert.equal(calls.length, 1, "absolute pixels never ask for the screen size");

  await tap(0.5, 0.25);
  await tap(1, 1);
  await swipe(0.5, 0.75, 0.5, 0.25, 250.4);
  await longPress(0.1, 0.1);
  await scroll("down");
  assert.deepEqual(calls.map((c) => c.argv.join(" ")), [
    "shell input tap 540 1201",
    "shell wm size",
    "shell input tap 540 600",
    "shell input tap 1080 2400",
    "shell input swipe 540 1800 540 600 250",
    "shell input swipe 108 240 108 240 700",
    "shell input swipe 540 1920 540 480 300",
  ]);
});

test("argv shape: typed text and URLs are one argv element, sanitised, and never meet a host shell", async () => {
  const calls = fakeAdb((cmd) => (cmd.startsWith("shell pidof") ? "4321 4322\n" : ""));
  const hostile = 'Hello world; rm -rf / && echo "x"';
  assert.equal(await typeText(hostile), `typed ${hostile.length} chars`);
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "input", "text", "Hello%sworld%srm%s-rf%s/%s%secho%sx"]);

  const before = calls.length;
  assert.equal(await typeText("$();|&"), "nothing to type after sanitizing input");
  assert.equal(calls.length, before, "nothing left to type: adb is not called");

  // & $ ( ) are stripped (today's sanitising, which also mangles the query; the text-entry step fixes that).
  assert.equal(await openUrl("https://example.com/a?b=1&c=$(id)"), "opened https://example.com/a?b=1c=id");
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "https://example.com/a?b=1c=id"]);
  await assert.rejects(openUrl("javascript:alert(1)"), /requires an http\(s\) URL/);

  await launchApp("com.android.settings");
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "monkey", "-p", "com.android.settings", "-c", "android.intent.category.LAUNCHER", "1"]);
  await launchApp("com.example/.MainActivity");
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "am", "start", "-n", "com.example/.MainActivity"]);
  await assert.rejects(launchApp("com.example; reboot"), /Invalid package/);
  await assert.rejects(pressKey("reboot"), /Unsupported key 'reboot'/);

  await getLogcat({ pkg: "com.screensync.mcp" });
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "logcat", "-d", "-t", "200", "--pid=4321"]);
  await getLogcat({ pkg: "com.x;reboot", lines: 5 });
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "logcat", "-d", "-t", "10"], "no pid filter: no empty argv element either");
  assert.ok(!calls.some((c) => c.argv.includes("com.x;reboot")), "an invalid package never reaches adb");
  noEmptyArgs(calls);
});

test("the real runner: argv reaches the child verbatim (node stands in for adb), and a timeout kills it", async () => {
  setAdbRunner(null);
  process.env.SCREEN_SYNC_ADB_BIN = process.execPath; // "C:\Program Files\nodejs\node.exe" on a default Windows install
  const hostile = `a"; echo PWNED & echo $(whoami) | more %PATH% 'x' \`y\` ^ > out.txt`;
  const echoed = await adb(["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", hostile]);
  assert.deepEqual(JSON.parse(echoed), [hostile], "no host shell split, expanded or redirected anything");

  await assert.rejects(adb(["-e", "setTimeout(() => {}, 10000)"], { timeoutMs: 300 }), (error: unknown) => {
    assert.equal((error as { killed?: boolean }).killed, true);
    return true;
  });
});

test("screencap: a PNG comes back as base64, anything else is an error", async () => {
  let reply: Buffer | string = PNG;
  const calls = fakeAdb(() => reply);
  assert.deepEqual(await screenshotNow(), { base64: PNG.toString("base64"), mimeType: "image/png" });
  assert.deepEqual(calls.at(-1)!.argv, ["exec-out", "screencap", "-p"]);
  reply = "error: no devices/emulators found";
  await assert.rejects(screenshotNow(), /did not return a PNG/);
});

test("record_screen: screenrecord gets its own time limit, the pull a larger buffer, then the file is removed", async () => {
  const MP4 = Buffer.from("ftypmp42-fake");
  const calls = fakeAdb((cmd) => (cmd.startsWith("exec-out cat") ? MP4 : ""));
  const clip = await recordScreen(3);
  assert.deepEqual(clip, { base64: MP4.toString("base64"), mimeType: "video/mp4", seconds: 3 });
  assert.deepEqual(calls.map((c) => [c.argv.join(" "), c.opts.timeoutMs, c.opts.maxBuffer]), [
    ["shell screenrecord --time-limit 3 --bit-rate 4000000 /sdcard/screensync_rec.mp4", 11_000, 8 * 1024 * 1024],
    ["exec-out cat /sdcard/screensync_rec.mp4", 20_000, 128 * 1024 * 1024],
    ["shell rm -f /sdcard/screensync_rec.mp4", 15_000, 64 * 1024 * 1024],
  ]);
});

test("uiHierarchy dumps to the device, reads the file back, and an empty read gives no nodes", async () => {
  let xml = fixture("uiautomator_android14.xml");
  const calls = fakeAdb((cmd) => (cmd.startsWith("shell cat") ? xml : "UI hierchary dumped to: /sdcard/screensync_ui.xml"));
  assert.equal((await uiHierarchy()).length, 4);
  assert.deepEqual(calls.map((c) => c.argv.join(" ")), [
    "shell uiautomator dump /sdcard/screensync_ui.xml",
    "shell cat /sdcard/screensync_ui.xml",
  ]);
  xml = "";
  assert.deepEqual(await uiHierarchy(), []);
});

test.todo("a failed or empty dump returns UI_DUMP_FAILED instead of re-reading the previous screen (ui-tree step)");

test("every tool declared in catalog-control.ts is answered by runControlAction, and nothing else is", () => {
  const declared = controlToolDefinitions().map((t) => t.name);
  assert.equal(declared.length, 20);
  assert.deepEqual([...controlActionNames()].sort(), [...declared].sort());
  for (const name of declared) assert.ok(isControlTool(name), name);
  for (const name of ["web_status", "get_latest_screenshot", "get_device_status", "toString", "constructor"]) {
    assert.equal(isControlTool(name), false, name);
  }
});

test("runControlAction + toMcpContent keep the MCP reply shapes of every kind of control tool", async () => {
  fakeAdb((cmd) => {
    if (cmd === "devices") return fixture("devices_mixed_states.txt");
    if (cmd === "shell wm size") return fixture("wm_size.txt");
    if (cmd === "exec-out screencap -p") return PNG;
    if (cmd.startsWith("shell cat")) return fixture("uiautomator_android9.xml");
    return "";
  });
  const text = (value: unknown) => [{ type: "text", text: JSON.stringify(value, null, 2) }];

  const status = toMcpContent(await runControlAction("control_status", {}));
  assert.deepEqual(status, { content: text({ available: true, screen: { width: 1080, height: 2400 } }), isError: false });

  const tapped = toMcpContent(await runControlAction("control_tap", { x: 0.5, y: 0.5 }));
  assert.deepEqual(tapped, { content: text({ success: true, detail: "tapped (540, 1200)" }), isError: false });

  const shot = toMcpContent(await runControlAction("control_screenshot", {}));
  assert.deepEqual(shot, { content: [{ type: "image", data: PNG.toString("base64"), mimeType: "image/png" }] });
  assert.equal("isError" in shot, false, "an image reply never carried isError");

  const frames = toMcpContent(await runControlAction("compare_frames", { delayMs: 0 }));
  assert.deepEqual(frames.content.map((c) => c.type), ["text", "image", "image"]);
  assert.equal("isError" in frames, false);

  const tree = await runControlAction("get_ui_hierarchy", { onlyClickable: true });
  assert.deepEqual((tree.data as { count: number }).count, 2);
  const filtered = await runControlAction("get_ui_hierarchy", { filter: "NETWORK" });
  assert.deepEqual((filtered.data as { nodes: Array<{ text: string }> }).nodes.map((n) => n.text), ["Network &amp; internet"]);

  const os = toMcpContent(await runControlAction("os_hotkey", { keys: ["ctrl", "r"] }));
  assert.equal(os.isError, true);
  const osText = os.content[0];
  assert.ok(osText.type === "text");
  assert.match(osText.text, /"enabled": false[\s\S]*OS-level control is disabled/);

  assert.deepEqual(toMcpContent(await runControlAction("nope", {})), { content: text({ success: false, error: "Unknown tool: nope" }), isError: true });
  // A missing required argument throws, exactly as before; mcp.ts turns it into {success:false, error}.
  await assert.rejects(runControlAction("control_tap", undefined), TypeError);
});
