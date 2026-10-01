// The pure parsers of the phone control path, run on recorded adb output in test/fixtures/adb/.
// No adb, no phone, no runner: these are the functions every control_* tool leans on.
//
// Some cases pin today's behaviour on purpose (the Physical size wins over an Override line, XML
// entities stay encoded, a disabled button still counts): later steps change them deliberately, and
// these assertions make that change visible in review.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chooseTarget, parseAdbDevices, parseWmSize, targetArgs } from "../control-adb.js";
import { escapeInputText, isFractionPoint, mapPoint, parseUiAutomatorXml } from "../control.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/adb/${name}`, import.meta.url)), "utf-8");

test("adb devices: the wireless phone appears twice, as ip:port and as its mDNS alias", () => {
  const serials = parseAdbDevices(fixture("devices_wireless_alias.txt"));
  assert.deepEqual(serials, ["192.168.1.20:41235", "adb-R5CT1234567-AbCdEf._adb-tls-connect._tcp"]);
  // adb on Windows ends lines with CRLF; the parser must not care.
  const crlf = fixture("devices_wireless_alias.txt").replace(/\r?\n/g, "\r\n");
  assert.deepEqual(parseAdbDevices(crlf), serials);
});

test("adb devices: offline and unauthorized entries are not online devices", () => {
  assert.deepEqual(parseAdbDevices(fixture("devices_offline_unauthorized.txt")), []);
  // A daemon start banner and mixed states: only the `device` line counts.
  assert.deepEqual(parseAdbDevices(fixture("devices_mixed_states.txt")), ["192.168.1.20:5555"]);
  assert.deepEqual(parseAdbDevices("List of devices attached\n\n"), []);
  assert.deepEqual(parseAdbDevices(""), []);
});

test("target choice: the ip:port serial beats the mDNS alias, whatever the listing order", () => {
  const listed = parseAdbDevices(fixture("devices_wireless_alias.txt"));
  assert.equal(chooseTarget(listed), "192.168.1.20:41235");
  assert.equal(chooseTarget([...listed].reverse()), "192.168.1.20:41235");
  assert.equal(chooseTarget(["emulator-5554", "R5CT1234567"]), "emulator-5554", "no ip:port serial: the first one");
});

test("target flags: a transport id is -t, anything else is -s, and a serial is ONE argv element", () => {
  assert.deepEqual(targetArgs(""), []);
  assert.deepEqual(targetArgs("7"), ["-t", "7"]);
  assert.deepEqual(targetArgs("192.168.1.20:5555"), ["-s", "192.168.1.20:5555"]);
  // Wireless serials can contain spaces and parentheses; with execFile they need no quoting.
  const odd = "adb-R5CT1234567 (2)._adb-tls-connect._tcp";
  assert.deepEqual(targetArgs(odd), ["-s", odd]);
});

test("wm size: plain output, an Override line, and output that is not a size", () => {
  assert.deepEqual(parseWmSize(fixture("wm_size.txt")), { width: 1080, height: 2400 });
  // Today the Physical line wins over the Override line (the first WxH in the output).
  assert.deepEqual(parseWmSize(fixture("wm_size_override.txt")), { width: 1440, height: 3200 });
  assert.equal(parseWmSize(""), null);
  assert.equal(parseWmSize("error: no devices/emulators found"), null);
});

test("uiautomator, Android 9 (single-line dump): only nodes with text, a description or a click", () => {
  const nodes = parseUiAutomatorXml(fixture("uiautomator_android9.xml"));
  assert.deepEqual(
    nodes.map((n) => [n.text, n.desc, n.clickable]),
    [
      ["", "", true], // the search toolbar
      ["Search settings", "", false],
      ["", "", true], // a clickable settings row
      ["Network &amp; internet", "", false], // XML entities are not decoded today
      ["Wi‑Fi, mobile, data usage, hotspot", "", false],
      ["", "Navigate up", false],
    ],
    "the root FrameLayout and the scrollable RecyclerView carry nothing to act on, so they are skipped",
  );
  const toolbar = nodes[0];
  assert.equal(toolbar.resourceId, "com.android.settings:id/search_action_bar");
  assert.equal(toolbar.className, "android.widget.Toolbar");
  assert.deepEqual(toolbar.bounds, { x1: 42, y1: 95, x2: 1038, y2: 221 });
  assert.deepEqual(toolbar.center, { x: 540, y: 158 });
  // Centers round half up: (189+768)/2 = 478.5 and (363+410)/2 = 386.5.
  assert.deepEqual(nodes[4].center, { x: 479, y: 387 });
});

test("uiautomator, Android 14 (indented, with drawing-order and hint): same rules", () => {
  const nodes = parseUiAutomatorXml(fixture("uiautomator_android14.xml"));
  assert.deepEqual(
    nodes.map((n) => [n.text, n.desc, n.className, n.center.x, n.center.y]),
    [
      ["Chrome", "Chrome", "android.widget.TextView", 174, 1560],
      ["", "Play Store", "android.widget.TextView", 418, 1560],
      // enabled="false" is not read today: a disabled button is still a tap target.
      ["Uninstall", "", "android.widget.Button", 750, 1470],
      // The search field has only a hint; it is kept because it is clickable.
      ["", "", "android.widget.EditText", 540, 2220],
    ],
  );
  assert.equal(nodes[3].resourceId, "com.google.android.apps.nexuslauncher:id/search_container_hotseat");
});

test("uiautomator: an empty or failed dump parses to no nodes", () => {
  assert.deepEqual(parseUiAutomatorXml(""), []);
  assert.deepEqual(parseUiAutomatorXml(fixture("uiautomator_dump_failed.txt")), []);
  assert.deepEqual(parseUiAutomatorXml("<?xml version='1.0' ?><hierarchy rotation=\"0\"></hierarchy>"), []);
});

test("escapeInputText: spaces become %s and shell metacharacters are dropped", () => {
  assert.equal(escapeInputText("Hello world"), "Hello%sworld");
  assert.equal(escapeInputText("a\"b'c`d$e\\f;g&h|i<j>k(l)m{n}o"), "abcdefghijklmno");
  assert.equal(escapeInputText("$();|&"), "");
  // What survives today (the device's sh still sees it; the text-entry step quotes for that sh).
  assert.equal(escapeInputText("50% off*"), "50%%soff*");
  assert.equal(escapeInputText("café ☕"), "café%s☕");
});

test("fraction heuristic: BOTH coordinates in 0..1 means a fraction of the screen", () => {
  const screen = { width: 1080, height: 2400 };
  assert.deepEqual(mapPoint(0.5, 0.25, screen), [540, 600]);
  assert.deepEqual(mapPoint(0, 0, screen), [0, 0]);
  assert.deepEqual(mapPoint(1, 1, screen), [1080, 2400], "(1, 1) is the bottom-right corner, not pixel (1, 1)");
  assert.deepEqual(mapPoint(540.4, 1200.6, screen), [540, 1201], "pixels are rounded");
  // One coordinate outside 0..1 makes the whole point pixels, so 0.5 rounds to pixel 1.
  assert.deepEqual(mapPoint(0.5, 500, screen), [1, 500]);
  assert.equal(isFractionPoint(1, 1), true);
  assert.equal(isFractionPoint(1, 1.0001), false);
  assert.equal(isFractionPoint(-0.1, 0.5), false);
});
