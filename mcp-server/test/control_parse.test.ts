// The pure parsers of the phone control path, run on recorded adb output in test/fixtures/adb/.
// No adb, no phone, no runner: these are the functions every control_* tool leans on.
//
// Some cases pin today's behaviour on purpose (the Physical size wins over an Override line): later
// steps change them deliberately, and these assertions make that change visible in review. The UI tree
// step did exactly that: XML entities are decoded now, a disabled button says so (enabled: false), and
// the default view also lists scroll containers. uiautomator_states.xml carries the state flags. The
// text-entry step replaced the old metacharacter stripping with quoting for the device's sh, proven
// below by decoding every argument the way that sh and Android's `input text` do.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chooseTarget, parseAdbDevices, parseWmSize, targetArgs } from "../control-adb.js";
import { ControlInputError, inputTextArgs, isFractionPoint, mapPoint, quoteForDeviceShell } from "../control.js";
import {
  decodeXml, parseUiAutomatorXml, parseUiTree, readMatchArgs, readUiArgs, shapeUiNodes, UI_DEFAULT_FIELDS, UI_NODE_FIELDS,
  type UiNode, type UiOutputField, type UiQuery,
} from "../control-ui.js";
import { controlToolDefinitions } from "../catalog-control.js";

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

test("uiautomator, Android 9 (single-line dump): text, a description, a click or a scroll container", () => {
  const nodes = parseUiAutomatorXml(fixture("uiautomator_android9.xml"));
  assert.deepEqual(
    nodes.map((n) => [n.text, n.desc, n.clickable, n.scrollable]),
    [
      ["", "", true, false], // the search toolbar
      ["Search settings", "", false, false],
      ["", "", false, true], // the RecyclerView: listed since the UI tree step, so an agent can find what scrolls
      ["", "", true, false], // a clickable settings row
      ["Network & internet", "", false, false], // decoded from &amp;
      ["Wi‑Fi, mobile, data usage, hotspot", "", false, false],
      ["", "Navigate up", false, false],
    ],
    "the root FrameLayout carries nothing to act on, so it is skipped",
  );
  const toolbar = nodes[0];
  assert.equal(toolbar.resourceId, "com.android.settings:id/search_action_bar");
  assert.equal(toolbar.className, "android.widget.Toolbar");
  assert.equal(toolbar.package, "com.android.settings");
  assert.deepEqual(toolbar.bounds, { x1: 42, y1: 95, x2: 1038, y2: 221 });
  assert.deepEqual(toolbar.center, { x: 540, y: 158 });
  // Centers round half up: (189+768)/2 = 478.5 and (363+410)/2 = 386.5.
  assert.deepEqual(nodes[5].center, { x: 479, y: 387 });
  // The hierarchy: the row's children point at the row, and the row at the RecyclerView.
  assert.deepEqual(nodes.map((n) => [n.depth, n.parent]), [[1, null], [2, 0], [1, null], [2, 2], [3, 3], [3, 3], [2, 2]]);
});

test("uiautomator, Android 14 (indented, with drawing-order and hint): same rules", () => {
  const nodes = parseUiAutomatorXml(fixture("uiautomator_android14.xml"));
  assert.deepEqual(
    nodes.map((n) => [n.text, n.desc, n.className, n.center.x, n.center.y, n.enabled]),
    [
      ["", "", "android.widget.ScrollView", 540, 924, true], // the scrollable workspace
      ["Chrome", "Chrome", "android.widget.TextView", 174, 1560, true],
      ["", "Play Store", "android.widget.TextView", 418, 1560, true],
      // Still listed, but now it says it is disabled (control_tap_text skips it unless asked).
      ["Uninstall", "", "android.widget.Button", 750, 1470, false],
      // The search field has only a hint; it is an EditText, so it is listed even when not clickable.
      ["", "", "android.widget.EditText", 540, 2220, true],
    ],
  );
  assert.equal(nodes[4].resourceId, "com.google.android.apps.nexuslauncher:id/search_container_hotseat");
  assert.deepEqual(nodes.map((n) => n.parent), [null, 0, 0, 0, null], "the EditText's View parent is not listed");
});

test("uiautomator: an empty or failed dump parses to no nodes", () => {
  assert.deepEqual(parseUiAutomatorXml(""), []);
  assert.deepEqual(parseUiAutomatorXml(fixture("uiautomator_dump_failed.txt")), []);
  assert.deepEqual(parseUiAutomatorXml("<?xml version='1.0' ?><hierarchy rotation=\"0\"></hierarchy>"), []);
});

// ── The state flags, the hierarchy, the filters and the projection (uiautomator_states.xml) ──

const STATES = fixture("uiautomator_states.xml");
const label = (n: UiNode) => n.text || n.desc || n.className.split(".").pop();
const view = (query: UiQuery) => parseUiAutomatorXml(STATES, query).map(label);
const pick = (n: UiNode, keys: Array<keyof UiNode>) => Object.fromEntries(keys.map((k) => [k, n[k]]));

test("uiautomator states: every flag is read, and XML entities are decoded", () => {
  const all = parseUiTree(STATES);
  assert.equal(all.length, 20);
  assert.deepEqual(Object.keys(all[0]), [...UI_NODE_FIELDS], "a node carries exactly the documented fields, in order");
  assert.deepEqual(pick(all[0], ["depth", "parent", "index", "package"]), { depth: 0, parent: null, index: 0, package: "com.android.settings" });

  const connect = all.find((n) => n.text === "Connect")!;
  assert.deepEqual(pick(connect, ["clickable", "enabled", "index"]), { clickable: true, enabled: false, index: 1 });
  const wifiSwitch = all[7];
  assert.deepEqual(pick(wifiSwitch, ["className", "checkable", "checked", "clickable"]), {
    className: "android.widget.Switch", checkable: true, checked: true, clickable: false,
  });
  assert.deepEqual(pick(all[10], ["desc", "checked", "clickable"]), { desc: "Bluetooth", checked: false, clickable: true });
  assert.deepEqual(pick(all[12], ["text", "checked", "selected"]), { text: "Home", checked: true, selected: true });
  assert.deepEqual(pick(all[15], ["className", "password", "focused", "focusable", "longClickable", "clickable"]), {
    className: "android.widget.EditText", password: true, focused: true, focusable: true, longClickable: true, clickable: false,
  });
  assert.equal(all[3].text, "Wi-Fi & network");
  assert.equal(all[16].text, "Status:\nOnline", "&#10; is a newline");
});

test("entities are decoded once, and unknown or out-of-range ones are left alone", () => {
  assert.equal(decodeXml("a &amp;amp; b &lt;x&gt; &quot;q&quot; &apos;s&apos;"), "a &amp; b <x> \"q\" 's'");
  assert.equal(decodeXml("&#x1F600; &#65;"), "😀 A");
  assert.equal(decodeXml("&nbsp; &#99999999; & plain"), "&nbsp; &#99999999; & plain");
});

test("the default view: scroll containers, EditText fields and checkable toggles join text, desc and clickable", () => {
  const nodes = parseUiAutomatorXml(STATES);
  assert.deepEqual(nodes.map(label), [
    "Navigate up", "Wi-Fi & network", "RecyclerView", "LinearLayout", "Use Wi-Fi", "Switch", "LinearLayout", "Bluetooth",
    "Bluetooth", "RecyclerView", "Home", "Work", "Home office", "EditText", "Status:\nOnline", "Cancel", "Connect",
  ]);
  // The button bar is a bare layout, so Cancel and Connect hang off the RecyclerView, its nearest listed ancestor.
  assert.deepEqual(nodes.map((n) => n.parent), [null, null, null, 2, 3, 3, 2, 6, 6, 2, 9, 9, 9, 2, 2, 2, 2]);
  assert.deepEqual(nodes.map((n) => n.depth), [2, 2, 1, 2, 3, 3, 2, 3, 3, 2, 3, 3, 3, 2, 2, 3, 3]);
});

test("depth and parent invariants hold in every view, filtered or not", () => {
  const xmls = [STATES, fixture("uiautomator_android9.xml"), fixture("uiautomator_android14.xml")];
  const queries: UiQuery[] = [{}, { all: true }, { scrollable: true }, { enabled: false }, { className: "Chip" }, { all: true, maxDepth: 2 },
    { region: { x1: 0, y1: 300, x2: 1080, y2: 700, mode: "inside" } }];
  for (const xml of xmls) {
    for (const query of queries) {
      const nodes = parseUiAutomatorXml(xml, query);
      nodes.forEach((n, i) => {
        if (n.parent === null) return;
        assert.ok(n.parent < i, `a parent comes first (${JSON.stringify(query)})`);
        assert.ok(nodes[n.parent].depth < n.depth, `a parent is shallower (${JSON.stringify(query)})`);
      });
    }
    // Unfiltered, the parent is exactly one level up and only the root has none.
    const all = parseUiTree(xml);
    for (const n of all) assert.equal(n.parent === null ? 0 : all[n.parent].depth + 1, n.depth);
  }
  // A node whose bounds cannot be read is left out, but still counts for its children's depth.
  const gap = parseUiTree('<hierarchy><node text="a" bounds="[0,0][10,10]"><node text="?"><node text="b" bounds="[1,1][2,2]" /></node></node></hierarchy>');
  assert.deepEqual(gap.map((n) => [n.text, n.depth, n.parent]), [["a", 0, null], ["b", 2, 0]]);
});

test("filters: enabled, checked, scrollable, className, maxDepth, all, and the old two", () => {
  assert.deepEqual(view({ enabled: false }), ["Connect"]);
  assert.deepEqual(view({ checked: true }), ["Switch", "Home"]);
  assert.deepEqual(view({ checked: false, className: "Switch" }), ["Bluetooth"]);
  const scrollers = parseUiAutomatorXml(STATES, { scrollable: true });
  assert.deepEqual(scrollers.map((n) => [n.resourceId, n.parent]), [
    ["com.android.settings:id/recycler_view", null], ["com.android.settings:id/chips", 0], // nested RecyclerViews
  ]);
  assert.deepEqual(view({ className: "chip" }), ["Home", "Work", "Home office"]);
  assert.deepEqual(view({ maxDepth: 1 }), ["RecyclerView"]);
  assert.deepEqual(view({ all: true, maxDepth: 1 }), ["FrameLayout", "ViewGroup", "RecyclerView"]);
  assert.equal(parseUiAutomatorXml(STATES, { all: true }).length, 20);
  assert.deepEqual(view({ onlyClickable: true, filter: "HOME" }), ["Home", "Home office"]);
});

test("region: intersect (the default) or inside, in pixels or as 0..1 fractions of the dump's root", () => {
  const top = ["Navigate up", "Wi-Fi & network"];
  assert.deepEqual(view({ region: { x1: 0, y1: 0, x2: 1080, y2: 264 } }), top, "the RecyclerView only touches y=264");
  assert.deepEqual(view({ region: { x1: 0, y1: 0, x2: 1, y2: 0.1 } }), top, "0.1 of 2400 is y=240");
  assert.deepEqual(view({ region: { x1: 0, y1: 300, x2: 1080, y2: 700 } }), [
    "RecyclerView", "LinearLayout", "Use Wi-Fi", "Switch", "LinearLayout", "Bluetooth", "Bluetooth", "RecyclerView", "Home", "Work", "Home office",
  ]);
  const inside = parseUiAutomatorXml(STATES, { region: { x1: 1080, y1: 700, x2: 0, y2: 300, mode: "inside" } });
  assert.deepEqual(inside.map(label), ["Use Wi-Fi", "Switch", "LinearLayout", "Bluetooth", "Bluetooth"], "corners in any order");
  assert.deepEqual(inside.map((n) => n.parent), [null, null, null, 2, 2]);
});

test("fields project each node; format tree nests children and drops parent", () => {
  assert.deepEqual(shapeUiNodes(parseUiAutomatorXml(STATES, { className: "Chip" }), { fields: ["text", "checked", "center"] }), {
    count: 3,
    nodes: [
      { text: "Home", checked: true, center: { x: 162, y: 711 } },
      { text: "Work", checked: false, center: { x: 423, y: 711 } },
      { text: "Home office", checked: false, center: { x: 812, y: 711 } },
    ],
  });
  assert.deepEqual(shapeUiNodes(parseUiAutomatorXml(STATES, { scrollable: true }), { fields: ["resourceId"], format: "tree" }), {
    count: 2,
    tree: [{ resourceId: "com.android.settings:id/recycler_view", children: [{ resourceId: "com.android.settings:id/chips" }] }],
  });
  const full = shapeUiNodes(parseUiAutomatorXml(STATES), { format: "tree" });
  assert.ok("tree" in full);
  assert.equal(full.count, 17);
  assert.deepEqual(full.tree.map((n) => n.children?.length ?? 0), [0, 0, 7]);
  assert.equal("parent" in full.tree[2], false);
  const every = shapeUiNodes(parseUiAutomatorXml(STATES), { fields: "all" });
  assert.ok("nodes" in every && every.nodes[3].parent === 2, "fields 'all' is the whole node");
  assert.deepEqual(Object.keys(every.nodes[3]), [...UI_NODE_FIELDS]);
});

test("without fields a node is compact: the seven keys it always had, plus state when a flag applies", () => {
  const flat = shapeUiNodes(parseUiAutomatorXml(STATES));
  assert.ok("nodes" in flat);
  const seven = ["text", "desc", "resourceId", "className", "clickable", "bounds", "center"];
  for (const n of flat.nodes) assert.deepEqual(Object.keys(n), "state" in n ? [...seven, "state"] : seven);
  assert.deepEqual([...UI_DEFAULT_FIELDS], [...seven, "state"]);
  const states = flat.nodes.map((n) => [n.text || n.desc || n.className!.split(".").pop(), n.state ?? null]);
  assert.deepEqual(states, [
    ["Navigate up", null], ["Wi-Fi & network", null], ["RecyclerView", ["scrollable"]], ["LinearLayout", null], ["Use Wi-Fi", null],
    ["Switch", ["checkable", "checked"]], ["LinearLayout", null], ["Bluetooth", null], ["Bluetooth", ["checkable"]], ["RecyclerView", ["scrollable"]],
    ["Home", ["checkable", "checked", "selected"]], ["Work", ["checkable"]], ["Home office", ["checkable"]],
    // focusable is left out on purpose: nearly every clickable node is.
    ["EditText", ["focused", "longClickable", "password"]], ["Status:\nOnline", null], ["Cancel", null], ["Connect", ["disabled"]],
  ]);
  // state can be asked for by name next to other keys, and is still absent when nothing applies.
  const picked = shapeUiNodes(parseUiAutomatorXml(STATES, { className: "widget.Button" }), { fields: ["text", "state"] });
  assert.deepEqual(picked, { count: 2, nodes: [{ text: "Cancel" }, { text: "Connect", state: ["disabled"] }] });
  // The tree format nests the same compact nodes.
  const tree = shapeUiNodes(parseUiAutomatorXml(STATES, { scrollable: true }), { format: "tree" });
  assert.ok("tree" in tree);
  assert.deepEqual(tree.tree[0].state, ["scrollable"]);
  assert.deepEqual(Object.keys(tree.tree[0]), [...seven, "state", "children"]);
});

test("size budget: a call without fields costs about what the seven-key reply did; every key is opt-in", () => {
  // Bytes of main's reply (seven keys, text/desc/clickable nodes only), measured 2026-10-01 with its parser.
  const before: Record<string, number> = { "uiautomator_android9.xml": 2103, "uiautomator_android14.xml": 1435, "uiautomator_states.xml": 4325 };
  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify({ success: true, ...(v as object) }, null, 2), "utf8");
  const seven: UiOutputField[] = ["text", "desc", "resourceId", "className", "clickable", "bounds", "center"];
  for (const [name, old] of Object.entries(before)) {
    const nodes = parseUiAutomatorXml(fixture(name));
    const compact = bytes(shapeUiNodes(nodes));
    const all = bytes(shapeUiNodes(nodes, { fields: "all" }));
    // `state` is the only key added; the rest of the growth is the scroll containers and fields now listed.
    assert.ok(compact <= 1.15 * bytes(shapeUiNodes(nodes, { fields: seven })), `${name}: state costs at most 15% (${compact} bytes)`);
    assert.ok(compact <= 1.5 * old, `${name}: ${compact} bytes against ${old} before; every key by default was ~2.5x`);
    assert.ok(all >= 1.6 * compact, `${name}: fields 'all' (${all} bytes) is the large reply, so it is opt-in`);
  }
});

test("loose MCP arguments become typed options, and the catalogue's fields enum matches the node", () => {
  const r = readUiArgs({
    enabled: "false", checked: false, maxDepth: 2.7, className: "", format: "tree",
    region: { x1: 0, y1: "10", x2: 5, y2: 20, mode: "inside" }, fields: ["text", "nope", "center"],
  });
  assert.equal(r.query.enabled, undefined, "a string is not a boolean");
  assert.equal(r.query.checked, false);
  assert.equal(r.query.maxDepth, 2);
  assert.equal(r.query.className, undefined);
  assert.deepEqual(r.query.region, { x1: 0, y1: 10, x2: 5, y2: 20, mode: "inside" });
  assert.deepEqual(r.fields, ["text", "center"]);
  assert.equal(r.format, "tree");
  assert.equal(readUiArgs({ fields: ["nope"] }).fields, undefined, "no known field left: the default keys");
  assert.equal(readUiArgs({}).fields, undefined, "no fields: the default keys");
  assert.equal(readUiArgs({ fields: ["all"] }).fields, "all");
  assert.equal(readUiArgs({ fields: ["text", "all"] }).fields, "all", "all anywhere in the list wins");
  assert.equal(readUiArgs({ fields: "all" }).fields, "all", "the bare string is taken too");
  assert.deepEqual(readUiArgs({ fields: ["state", "text"] }).fields, ["text", "state"]);
  assert.equal(readUiArgs({ region: { x1: 0 } }).query.region, undefined);
  assert.equal(readUiArgs(undefined).format, "flat");
  assert.deepEqual(readMatchArgs({ index: 1, enabled: false, clickableOnly: true, className: "Chip", exact: true }), {
    exact: true, index: 1, className: "Chip", enabled: false, clickableOnly: true,
  });

  const schema = controlToolDefinitions().find((t) => t.name === "get_ui_hierarchy")!.inputSchema as unknown as {
    properties: Record<string, { items?: { enum?: string[] } }>;
  };
  assert.deepEqual(schema.properties.fields.items?.enum, [...UI_NODE_FIELDS, "state", "all"]);
});

/** What the device's sh hands `input` for one word quoteForDeviceShell() built: the quoting removed. */
const shUnquote = (word: string): string => {
  assert.match(word, /^'.*'$/s, "always single-quoted");
  return word.slice(1, -1).split("'\\''").join("'");
};

/** Android's `input text` decoding (InputShellCommand.sendText): "%s" becomes a space, nothing else changes. */
const androidInputText = (arg: string): string => {
  const text = [...arg];
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    if (escape) {
      escape = false;
      if (text[i] === "s") {
        text[i] = " ";
        text.splice(--i, 1);
      }
    }
    if (text[i] === "%") escape = true;
  }
  return text.join("");
};

const typedOnDevice = (text: string) => inputTextArgs(text).map(shUnquote).map(androidInputText).join("");

test("quoteForDeviceShell: one single-quoted word, ' as '\\''", () => {
  assert.equal(quoteForDeviceShell("Hello world"), "'Hello world'");
  assert.equal(quoteForDeviceShell("it's"), "'it'\\''s'");
  assert.equal(quoteForDeviceShell("$(reboot); `id` & \"x\""), "'$(reboot); `id` & \"x\"'");
  assert.equal(quoteForDeviceShell(""), "''");
});

test("inputTextArgs: every printable ASCII character reaches the field exactly, %s included", () => {
  assert.deepEqual(inputTextArgs("Hello world"), ["'Hello%sworld'"]);
  assert.deepEqual(inputTextArgs("50% off"), ["'50%%soff'"], "a % before a space decodes as '% '");
  assert.deepEqual(inputTextArgs("100%sure"), ["'100%'", "'sure'"], "a literal %s is split across two calls");
  assert.deepEqual(inputTextArgs(""), []);

  const allPrintable = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join("");
  for (const text of [
    "Hello world", "a\"b'c`d$e\\f;g&h|i<j>k(l)m{n}o", "$();|&", "50% off*", "100%sure", "%%s", "%s", "% s", "s%", "%",
    "it's", "'", "''", "a  b", " ", "Hello world; rm -rf / && echo \"x\"", allPrintable,
  ]) {
    assert.equal(typedOnDevice(text), text, JSON.stringify(text));
  }
});

test("inputTextArgs: Unicode and control characters are refused with a count, never stripped", () => {
  const refusal = (code: string, count: number) => (error: unknown) => {
    assert.ok(error instanceof ControlInputError);
    assert.deepEqual([error.code, error.retryable, error.details], [code, false, { count }]);
    assert.match(error.message, new RegExp(`^${code}: `));
    assert.doesNotMatch(error.message, /paste/i, "no tool that does not exist is suggested");
    return true;
  };
  assert.throws(() => inputTextArgs("café ☕"), refusal("UNICODE_NOT_SUPPORTED", 2));
  assert.throws(() => inputTextArgs("سلام دنیا"), refusal("UNICODE_NOT_SUPPORTED", 8));
  assert.throws(() => inputTextArgs("ok 👍"), refusal("UNICODE_NOT_SUPPORTED", 1), "an emoji is one character, not two halves");
  assert.throws(() => inputTextArgs("a\nb\tc\x7f"), refusal("CONTROL_CHARACTERS_NOT_SUPPORTED", 3));
  assert.throws(() => inputTextArgs("é\n"), refusal("UNICODE_NOT_SUPPORTED", 1), "Unicode is reported first");
  assert.throws(() => inputTextArgs("سلام"), /Unicode typing is not supported yet: .* Nothing was typed\./);
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
