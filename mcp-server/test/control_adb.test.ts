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
  ControlInputError, controlDeviceInfo, getLogcat, launchApp, longPress, openUrl, pressKey, recordScreen, screenshotNow,
  scroll, swipe, tap, typeText,
} from "../control.js";
import { tapText, uiHierarchy, UiDumpError } from "../control-ui.js";
import { controlActionNames, isControlTool, runControlAction, toMcpContent } from "../mcp-control.js";
import { controlToolDefinitions } from "../catalog-control.js";
import { resolveConsolidatedCall } from "../catalog-consolidated.js";

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
const argvOf = (calls: Call[]) => calls.map((c) => c.argv.join(" "));
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

test("control_tap count 2: both taps in ONE adb shell call of whole numbers; a bad count or point taps nothing", async () => {
  const calls = fakeAdb((cmd) => (cmd === "shell wm size" ? fixture("wm_size.txt") : ""));
  assert.equal(await tap(0.5, 0.5, 2), "double-tapped (540, 1200)");
  assert.deepEqual(argvOf(calls), ["shell wm size", "shell input tap 540 1200 && input tap 540 1200"]);
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "input", "tap", "540", "1200", "&&", "input", "tap", "540", "1200"]);

  const viaTool = await runControlAction("control_tap", { x: 100.4, y: 200.6, count: 2 });
  assert.deepEqual(viaTool.data, { success: true, detail: "double-tapped (100, 201)" });
  assert.ok(calls.at(-1)!.argv.slice(1).every((a) => /^(\d+|&&|input|tap)$/.test(a)), "only numbers reach the device's sh");
  await tap(5, 6, 1);
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "input", "tap", "5", "6"], "count 1 is today's single tap");

  const before = calls.length;
  for (const count of [0, 3, 1.5]) {
    await assert.rejects(tap(5, 6, count), (error: unknown) => error instanceof ControlInputError && error.code === "INVALID_TAP_COUNT");
  }
  for (const [x, y] of [[Number.NaN, 5], [5, Number.POSITIVE_INFINITY]] as Array<[number, number]>) {
    await assert.rejects(tap(x, y, 2), (error: unknown) => error instanceof ControlInputError && error.code === "INVALID_COORDINATES");
  }
  const reply = JSON.parse((toMcpContent(await runControlAction("control_tap", { x: 1, y: 1, count: 3 })).content[0] as { text: string }).text);
  assert.deepEqual([reply.success, reply.code, reply.retryable], [false, "INVALID_TAP_COUNT", false]);
  assert.equal(calls.length, before, "a refused tap never reaches adb");
});

test("argv shape: typed text and URLs are one argv element, quoted for the device's sh, and never meet a host shell", async () => {
  const calls = fakeAdb((cmd) => (cmd.startsWith("shell pidof") ? "4321 4322\n" : ""));
  const said = `Say "hi" & what's up? a=1`;
  assert.equal(await typeText(said), `typed ${said.length} chars`);
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "input", "text", `'Say%s"hi"%s&%swhat'\\''s%sup?%sa=1'`]);
  const hostile = 'Hello world; rm -rf / && echo "x" $(reboot)';
  await typeText(hostile);
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "input", "text", `'Hello%sworld;%srm%s-rf%s/%s&&%secho%s"x"%s$(reboot)'`]);

  const before = calls.length;
  assert.equal(await typeText(""), "nothing to type: the text is empty");
  assert.equal(calls.length, before, "nothing to type: adb is not called");

  // The query string survives whole: ? & $ ( ) are kept (they used to be stripped, opening the wrong page).
  assert.equal(await openUrl("https://example.com/a?b=1&c=$(id)"), "opened https://example.com/a?b=1&c=$(id)");
  assert.deepEqual(calls.at(-1)!.argv, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "'https://example.com/a?b=1&c=$(id)'"]);
  await openUrl(" https://example.com/it's?q=a b&x=1#top ");
  assert.deepEqual(calls.at(-1)!.argv.at(-1), "'https://example.com/it'\\''s?q=a%20b&x=1#top'", "parsed (space encoded), ' quoted");
  const before2 = calls.length;
  for (const bad of ["javascript:alert(1)", "file:///sdcard/x", "example.com/no-scheme", ""]) {
    await assert.rejects(openUrl(bad), (error: unknown) => error instanceof ControlInputError && error.code === "INVALID_URL", bad);
  }
  assert.equal(calls.length, before2, "a refused URL never reaches adb");

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

test("honest typing: Unicode and newlines are typed refusals, a literal %s takes two calls, and adb errors hide the text", async () => {
  const calls = fakeAdb(() => "");
  const body = async (tool: string, args: Record<string, unknown>) => {
    const reply = toMcpContent(await runControlAction(tool, args));
    assert.equal(reply.isError, true, tool);
    return JSON.parse((reply.content[0] as { text: string }).text);
  };
  const urdu = await body("control_type", { text: "سلام دنیا" });
  assert.deepEqual([urdu.success, urdu.code, urdu.retryable, urdu.count], [false, "UNICODE_NOT_SUPPORTED", false, 8]);
  assert.match(urdu.error, /Unicode typing is not supported yet/);
  assert.ok(!urdu.error.includes("سلام"), "the refusal never echoes the text");
  const injected = await body("control_type", { text: "x\nreboot" });
  assert.deepEqual([injected.code, injected.count], ["CONTROL_CHARACTERS_NOT_SUPPORTED", 1]);
  assert.equal(calls.length, 0, "a refused text never reaches adb: nothing is half-typed");

  assert.equal(await typeText("100%sure"), "typed 8 chars");
  assert.deepEqual(argvOf(calls), ["shell input text '100%'", "shell input text 'sure'"]);

  const url = await body("control_open_url", { url: "intent://x#Intent;end" });
  assert.deepEqual([url.code, url.retryable], ["INVALID_URL", false]);

  fakeAdb((cmd, argv) => {
    throw new Error(`Command failed: adb ${cmd}\nerror: device '${argv.at(-1)}' not found`);
  });
  await assert.rejects(typeText("my secret pin 1234"), (error: unknown) => {
    const message = String(error);
    assert.match(message, /input text failed \(18 chars\): .*'<text>'/s);
    assert.ok(!message.includes("secret") && !message.includes("1234"), message);
    return true;
  });
});

test("control_key: paste and move_end are keyevents, select_all is ctrl+a on Android 13+ and a typed refusal before", async () => {
  let sdk = "34";
  let comboOut = "";
  const calls = fakeAdb((cmd) => {
    if (cmd === "shell getprop ro.build.version.sdk") {
      if (sdk === "fail") throw new Error("Command failed: adb shell getprop");
      return `${sdk}\n`;
    }
    return cmd.startsWith("shell input keycombination") ? comboOut : "";
  });
  assert.equal(await pressKey("paste"), "pressed paste");
  assert.equal(await pressKey("move_end"), "pressed move_end");
  assert.equal(await pressKey("SELECT_ALL"), "pressed select_all");
  assert.deepEqual(argvOf(calls), [
    "shell input keyevent 279",
    "shell input keyevent 123",
    "shell getprop ro.build.version.sdk",
    "shell input keycombination 113 29",
  ]);

  sdk = "31";
  const before = calls.length;
  const old = toMcpContent(await runControlAction("control_key", { key: "select_all" }));
  const reply = JSON.parse((old.content[0] as { text: string }).text);
  assert.deepEqual([reply.code, reply.retryable, reply.key, reply.sdk], ["KEY_COMBINATION_NOT_SUPPORTED", false, "select_all", 31]);
  assert.match(reply.error, /long-press the text field, then control_tap_text "Select all"/);
  assert.deepEqual(argvOf(calls.slice(before)), ["shell getprop ro.build.version.sdk"], "no keycombination on API 31");

  // Unknown API level: it is tried, and an old `input` that prints an error (exit 0) is still a refusal.
  sdk = "fail";
  comboOut = "Error: Unknown command: keycombination";
  await assert.rejects(pressKey("select_all"), (error: unknown) => error instanceof ControlInputError && error.code === "KEY_COMBINATION_NOT_SUPPORTED");
  await assert.rejects(pressKey("paste_all"), /Unsupported key 'paste_all'\. Allowed: .*paste, move_end, select_all/);
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

// ── The UI tree: a dump is either this screen's or a typed UI_DUMP_FAILED ──

const DUMPED = "UI hierchary dumped to: /sdcard/screensync_ui.xml"; // Android's own spelling
const NOT_IDLE = fixture("uiautomator_dump_failed.txt"); // "ERROR: could not get idle state." (mid-animation)
const DUMP_CALLS = ["shell rm -f /sdcard/screensync_ui.xml", "shell uiautomator dump /sdcard/screensync_ui.xml"];
const READ_CALL = "shell cat /sdcard/screensync_ui.xml";

/** A phone whose `uiautomator dump` answers from `dumps` in turn (the last repeats) and whose dump file holds `file`. */
function fakeUiDevice(dumps: Array<string | Error>, file = () => fixture("uiautomator_states.xml")): Call[] {
  let next = 0;
  return fakeAdb((cmd) => {
    if (cmd.startsWith("shell uiautomator dump")) {
      const out = dumps[Math.min(next++, dumps.length - 1)];
      if (out instanceof Error) throw out;
      return out;
    }
    if (cmd.startsWith("shell cat")) return file();
    if (cmd.startsWith("shell rm -f") || cmd.startsWith("shell input tap")) return "";
    throw new Error(`unexpected adb call: ${cmd}`);
  });
}
const isDumpFailure = (pattern: RegExp) => (error: unknown) => {
  assert.ok(error instanceof UiDumpError);
  assert.deepEqual([error.code, error.retryable, error.attempts], ["UI_DUMP_FAILED", true, 2]);
  assert.match(error.message, pattern);
  return true;
};

test("uiHierarchy removes the old dump, requires Android's 'dumped' line, then reads this screen back", async () => {
  const calls = fakeUiDevice([DUMPED], () => fixture("uiautomator_android14.xml"));
  assert.equal((await uiHierarchy()).length, 5);
  assert.deepEqual(argvOf(calls), [...DUMP_CALLS, READ_CALL]);
});

test("the stale dump: a failed dump is retried once after ~400 ms, then UI_DUMP_FAILED, and the old file is never read", async () => {
  // The file on the device still holds the PREVIOUS screen; before this step it was read back and returned.
  const calls = fakeUiDevice([NOT_IDLE], () => fixture("uiautomator_android14.xml"));
  const started = Date.now();
  await assert.rejects(uiHierarchy(), isDumpFailure(/could not get idle state/));
  assert.ok(Date.now() - started >= 380, "the retry waits for the animation to settle");
  assert.deepEqual(argvOf(calls), [...DUMP_CALLS, ...DUMP_CALLS]);
  assert.ok(!calls.some((c) => c.argv.includes("cat")), "the previous screen's file is never read");
});

test("one failed attempt then a good one returns this screen; a non-zero exit or an empty file also fail typed", async () => {
  let calls = fakeUiDevice([NOT_IDLE, DUMPED]);
  assert.equal((await uiHierarchy()).length, 17);
  assert.deepEqual(argvOf(calls), [...DUMP_CALLS, ...DUMP_CALLS, READ_CALL]);

  fakeUiDevice([new Error("Command failed: adb shell uiautomator dump\nERROR: null root node returned by UiTestAutomationBridge.")]);
  await assert.rejects(uiHierarchy(), isDumpFailure(/null root node/));

  calls = fakeUiDevice([DUMPED], () => "");
  await assert.rejects(uiHierarchy(), isDumpFailure(/empty or not XML/));
  assert.deepEqual(argvOf(calls), [...DUMP_CALLS, READ_CALL, ...DUMP_CALLS, READ_CALL]);
});

test("runControlAction turns UI_DUMP_FAILED into a typed reply for every UI tool, and nothing is tapped", async () => {
  const calls = fakeUiDevice([NOT_IDLE]);
  for (const [tool, args] of [["get_ui_hierarchy", {}], ["control_tap_text", { query: "Cancel" }], ["control_swipe_until", { query: "x" }]] as const) {
    const reply = toMcpContent(await runControlAction(tool, args));
    assert.equal(reply.isError, true, tool);
    const body = JSON.parse((reply.content[0] as { text: string }).text);
    assert.deepEqual([body.success, body.code, body.retryable], [false, "UI_DUMP_FAILED", true], tool);
  }
  assert.ok(!calls.some((c) => c.argv.includes("input")), "no tap and no swipe on a failed dump");
});

test("control_tap_text: disabled elements are skipped unless asked, index picks the Nth match, className and clickableOnly narrow", async () => {
  const calls = fakeUiDevice([DUMPED]);
  const taps = () => calls.filter((c) => c.argv.includes("tap")).map((c) => c.argv.slice(-2).join(","));

  await assert.rejects(tapText("Connect"), /matching "Connect"; 1 disabled match\(es\) skipped \(pass enabled:false/);
  assert.equal((await tapText("Connect", { enabled: false })).tapped.text, "Connect");
  const home = await tapText("Home");
  assert.deepEqual([home.tapped.text, home.matches], ["Home", 2], "best match: clickable first, then the smallest");
  assert.equal((await tapText("Home", { index: 1 })).tapped.text, "Home office", "index counts in hierarchy order");
  await assert.rejects(tapText("Home", { index: 2 }), /at index 2 \(2 match\(es\), counted from 0\)/);
  assert.equal((await tapText("Bluetooth")).tapped.className, "android.widget.Switch", "the clickable switch beats its label");
  assert.equal((await tapText("Bluetooth", { className: "TextView" })).tapped.className, "android.widget.TextView");
  await assert.rejects(tapText("Use Wi-Fi", { clickableOnly: true }), /No on-screen element matching "Use Wi-Fi"\. Try/);
  assert.deepEqual(taps(), ["789,1225", "162,711", "812,711", "954,548", "197,548"]);

  // The same matcher behind control_swipe_until, through the handler: a disabled target is found at once when asked for.
  const found = await runControlAction("control_swipe_until", { query: "Connect", enabled: false });
  assert.deepEqual((found.data as { detail: { found: boolean; swipes: number } }).detail.found, true);
});

test("get_ui_hierarchy takes the new arguments, and the consolidated ui_hierarchy action passes them through", async () => {
  fakeUiDevice([DUMPED]);
  const args = { checked: true, fields: ["text", "checked"] };
  const viaMeta = resolveConsolidatedCall("mobile_control", { action: "ui_hierarchy", args });
  assert.deepEqual(viaMeta, { toolName: "get_ui_hierarchy", args });
  const checked = await runControlAction("get_ui_hierarchy", (viaMeta as { args: Record<string, unknown> }).args);
  assert.deepEqual(checked.data, { success: true, count: 2, nodes: [{ text: "", checked: true }, { text: "Home", checked: true }] });

  const tree = await runControlAction("get_ui_hierarchy", { scrollable: true, fields: ["resourceId"], format: "tree" });
  assert.deepEqual(tree.data, {
    success: true, count: 2,
    tree: [{ resourceId: "com.android.settings:id/recycler_view", children: [{ resourceId: "com.android.settings:id/chips" }] }],
  });
});

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
    if (cmd.startsWith("shell uiautomator dump")) return DUMPED;
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
  assert.deepEqual((filtered.data as { nodes: Array<{ text: string }> }).nodes.map((n) => n.text), ["Network & internet"]);

  const os = toMcpContent(await runControlAction("os_hotkey", { keys: ["ctrl", "r"] }));
  assert.equal(os.isError, true);
  const osText = os.content[0];
  assert.ok(osText.type === "text");
  assert.match(osText.text, /"enabled": false[\s\S]*OS-level control is disabled/);

  assert.deepEqual(toMcpContent(await runControlAction("nope", {})), { content: text({ success: false, error: "Unknown tool: nope" }), isError: true });
  // A missing required argument throws, exactly as before; mcp.ts turns it into {success:false, error}.
  await assert.rejects(runControlAction("control_tap", undefined), TypeError);
});
