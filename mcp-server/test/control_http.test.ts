// POST /api/control/:action (hub-control.ts) on an ephemeral port, with a scripted fake adb runner installed through
// setAdbRunner(). No adb binary runs, no phone is touched, and nothing listens on the hub's own port.
//
// What used to go wrong: the route was a hand-written switch over nine short names, so the app's in-app tool runner
// (which posts control_<x> as /api/control/<x>) got 404 for launch_app, tap_text, swipe_until and open_url, the
// extension's "open link on phone" menu got 404 for open_url, and an empty body became `input tap NaN NaN`. The
// route now runs runControlAction() for every control_* tool in the catalogue and checks the catalogue's required
// arguments first.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";

process.env.SCREEN_SYNC_TOKEN = "control-http-route-token";
process.env.SCREEN_SYNC_HOST = "127.0.0.1";
process.env.SCREEN_SYNC_PORT = "0"; // nothing here listens on it, but it must never be 3000

const { mountControlRoutes, controlRouteActions } = await import("../hub-control.js");
const { setAdbRunner } = await import("../control-adb.js");
const { controlToolDefinitions } = await import("../catalog-control.js");
const { hubEvents } = await import("../events.js");

const TOKEN = "control-http-route-token";
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/adb/${name}`, import.meta.url)), "utf-8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const DUMPED = "UI hierchary dumped to: /sdcard/screensync_ui.xml"; // Android's own spelling

/** The catalogue's control_* tools and their schemas: the route must answer every one of them. */
const CONTROL_TOOLS = controlToolDefinitions().filter((t) => t.name.startsWith("control_"));
type Schema = { required?: string[] };

/** A healthy phone: one online device, a 1080x2400 screen, a Settings screen to dump, and quiet input commands. */
function fakePhone(opts: { dump?: "ok" | "fail" } = {}): string[] {
  const calls: string[] = [];
  setAdbRunner(async (_bin, argv) => {
    const bare = argv[0] === "-s" || argv[0] === "-t" ? argv.slice(2) : argv;
    const cmd = bare.join(" ");
    calls.push(cmd);
    if (cmd === "devices") return Buffer.from(fixture("devices_mixed_states.txt"));
    if (cmd === "shell getprop ro.product.model") return Buffer.from("Pixel 8\n");
    if (cmd === "shell getprop ro.build.version.release") return Buffer.from("14\n");
    if (cmd === "get-serialno") return Buffer.from("192.168.1.20:5555\n");
    if (cmd === "shell wm size") return Buffer.from(fixture("wm_size.txt"));
    if (cmd === "exec-out screencap -p") return PNG;
    if (cmd.startsWith("shell uiautomator dump")) return Buffer.from(opts.dump === "fail" ? fixture("uiautomator_dump_failed.txt") : DUMPED);
    if (cmd.startsWith("shell cat")) return Buffer.from(fixture("uiautomator_android9.xml"));
    if (cmd.startsWith("shell rm -f") || cmd.startsWith("shell input ") || cmd.startsWith("shell am start ")) return Buffer.from("");
    if (cmd.startsWith("shell monkey -p ")) return Buffer.from("Events injected: 1\n");
    throw new Error(`unexpected adb call: ${cmd}`);
  });
  return calls;
}

let server: Server;
let base = "";

before(async () => {
  const app = express();
  app.use(express.json());
  mountControlRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => delete process.env.SCREEN_SYNC_ADB_TARGET);
afterEach(() => setAdbRunner(null));

type Reply = { status: number; body: Record<string, unknown> };

async function post(action: string, body?: unknown, auth: string | null = `Bearer ${TOKEN}`): Promise<Reply> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  const res = await fetch(`${base}/api/control/${encodeURIComponent(action)}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Collects the timeline labels emitted while `fn` runs. */
async function timeline(fn: () => Promise<void>): Promise<string[]> {
  const labels: string[] = [];
  const onEvent = (e: { type: string; label?: string }) => { if (e.type === "tool" && e.label) labels.push(e.label); };
  hubEvents.on("event", onEvent);
  try { await fn(); } finally { hubEvents.off("event", onEvent); }
  return labels;
}

/**
 * One valid call per catalogue control tool, and the adb command that proves its handler ran. A new control_* tool
 * without a case here fails the first test, so it cannot ship unreachable over HTTP.
 */
const CASES: Record<string, { args: Record<string, unknown>; proof: RegExp }> = {
  control_status: { args: {}, proof: /^get-serialno$/ },
  control_screenshot: { args: {}, proof: /^exec-out screencap -p$/ },
  control_tap: { args: { x: 10, y: 20 }, proof: /^shell input tap 10 20$/ },
  control_long_press: { args: { x: 30, y: 40 }, proof: /^shell input swipe 30 40 30 40 700$/ },
  control_swipe: { args: { x1: 1, y1: 2, x2: 3, y2: 4 }, proof: /^shell input swipe 1 2 3 4 300$/ },
  control_scroll: { args: { direction: "down" }, proof: /^shell input swipe 540 / },
  control_type: { args: { text: "hello" }, proof: /^shell input text 'hello'$/ },
  control_key: { args: { key: "back" }, proof: /^shell input keyevent 4$/ },
  control_launch_app: { args: { package: "com.android.settings" }, proof: /^shell monkey -p com\.android\.settings / },
  control_tap_text: { args: { query: "Network" }, proof: /^shell input tap \d+ \d+$/ },
  control_swipe_until: { args: { query: "Network" }, proof: /^shell cat / },
  control_open_url: { args: { url: "https://example.com/a?b=1&c=2" }, proof: /^shell am start -a android\.intent\.action\.VIEW -d / },
};

test("every control_* tool in the catalogue reaches its handler over /api/control by its short name", async () => {
  assert.deepEqual(Object.keys(CASES).sort(), CONTROL_TOOLS.map((t) => t.name).sort(), "one HTTP case per catalogue control tool");
  for (const [name, { args, proof }] of Object.entries(CASES)) {
    const calls = fakePhone();
    const reply = await post(name.slice("control_".length), args);
    assert.equal(reply.status, 200, `${name}: ${JSON.stringify(reply.body)}`);
    assert.equal(reply.body.success, true, name);
    assert.ok(calls.some((c) => proof.test(c)), `${name} must reach adb (${proof}); saw ${JSON.stringify(calls)}`);
  }
  assert.deepEqual(controlRouteActions(), [...CONTROL_TOOLS.map((t) => t.name.slice("control_".length)), "launch"]);
});

test("the full tool name works too, and so do the legacy short names launch and launch_app", async () => {
  for (const action of ["control_tap", "tap"]) {
    const calls = fakePhone();
    assert.deepEqual(await post(action, { x: 5, y: 6 }), { status: 200, body: { success: true, detail: "tapped (5, 6)" } });
    assert.deepEqual(calls, ["shell input tap 5 6"]);
  }
  for (const action of ["launch", "launch_app", "control_launch_app"]) {
    const calls = fakePhone();
    const reply = await post(action, { package: "com.android.settings" });
    assert.deepEqual(reply, { status: 200, body: { success: true, detail: "launched com.android.settings" } }, action);
    assert.deepEqual(calls, ["shell monkey -p com.android.settings -c android.intent.category.LAUNCHER 1"], action);
  }
});

test("the replies keep the route's shapes: device for status, imageDataUrl for screenshot, the handler's own otherwise", async () => {
  fakePhone();
  assert.deepEqual(await post("status", {}), {
    status: 200,
    body: { success: true, device: { available: true, serial: "192.168.1.20:5555", model: "Pixel 8", androidVersion: "14", screen: { width: 1080, height: 2400 } } },
  });
  assert.deepEqual(await post("screenshot"), { status: 200, body: { success: true, imageDataUrl: `data:image/png;base64,${PNG.toString("base64")}` } });
  // A structured detail comes back as the handler built it, exactly as over MCP.
  const found = await post("swipe_until", { query: "Network" });
  assert.equal((found.body.detail as { found: boolean; swipes: number }).found, true);
  assert.equal((found.body.detail as { found: boolean; swipes: number }).swipes, 0);
});

test("a missing required argument is 400 MISSING_ARG for every tool that has one, and nothing reaches adb", async () => {
  let checked = 0;
  for (const tool of CONTROL_TOOLS) {
    const required = (tool.inputSchema as Schema).required ?? [];
    if (!required.length) continue;
    const calls = fakePhone();
    for (const body of [undefined, {}]) {
      const reply = await post(tool.name.slice("control_".length), body);
      assert.equal(reply.status, 400, tool.name);
      assert.equal(reply.body.success, false);
      assert.equal(reply.body.code, "MISSING_ARG", tool.name);
      assert.deepEqual(reply.body.missing, required, tool.name);
    }
    assert.deepEqual(calls, [], `${tool.name}: a refused call never reaches adb`);
    checked++;
  }
  assert.ok(checked >= 9, `checked ${checked} tools with required arguments`);

  const calls = fakePhone();
  const oneMissing = await post("tap", { x: 1 });
  assert.equal(oneMissing.status, 400);
  assert.deepEqual(oneMissing.body.missing, ["y"]);
  assert.match(String(oneMissing.body.error), /control_tap needs y\. Nothing was sent to the phone\./);
  // null counts as absent: an empty form field is not a value.
  assert.deepEqual((await post("swipe", { x1: 1, y1: 2, x2: null, y2: 4 })).body.missing, ["x2"]);
  assert.deepEqual(calls, []);
});

test("numbers: a numeric string is taken as its number, anything else is 400 INVALID_ARG; a null optional gets its default", async () => {
  let calls = fakePhone();
  assert.deepEqual((await post("tap", { x: "540", y: " 1200 " })).body, { success: true, detail: "tapped (540, 1200)" });
  assert.deepEqual((await post("long_press", { x: 1, y: 2, durationMs: null })).body, { success: true, detail: "long-pressed (1, 2) for 700ms" });
  assert.deepEqual(calls, ["shell input tap 540 1200", "shell input swipe 1 2 1 2 700"]);

  calls = fakePhone();
  for (const [action, body, field] of [
    ["tap", { x: "abc", y: 1 }, "x"],
    ["tap", { x: "", y: 1 }, "x"],
    ["tap", { x: true, y: 1 }, "x"],
    ["swipe", { x1: 1, y1: 2, x2: 3, y2: 4, durationMs: "fast" }, "durationMs"],
    ["scroll", { direction: "down", amount: [0.5] }, "amount"],
  ] as const) {
    const reply = await post(action, body);
    assert.equal(reply.status, 400, `${action} ${JSON.stringify(body)}`);
    assert.equal(reply.body.code, "INVALID_ARG");
    assert.equal(reply.body.field, field);
  }
  const notAnObject = await post("tap", [1, 2]);
  assert.equal(notAnObject.status, 400);
  assert.equal(notAnObject.body.code, "INVALID_ARG");
  assert.deepEqual(calls, [], "no NaN ever reaches the phone");
});

test("refusals keep their code: 400 for bad input, 503 for a retryable UI dump failure; an untyped error stays 400", async () => {
  fakePhone();
  const badUrl = await post("open_url", { url: "ftp://example.com/file" });
  assert.equal(badUrl.status, 400);
  assert.equal(badUrl.body.success, false);
  assert.equal(badUrl.body.code, "INVALID_URL");
  assert.equal(badUrl.body.retryable, false);

  const badCount = await post("tap", { x: 1, y: 2, count: 3 });
  assert.equal(badCount.status, 400);
  assert.equal(badCount.body.code, "INVALID_TAP_COUNT");

  // control_launch_app has no required argument in its schema (package OR query OR list): the handler refuses.
  const noTarget = await post("launch_app", {});
  assert.equal(noTarget.status, 400);
  assert.equal(noTarget.body.code, "INVALID_ARGUMENTS");

  fakePhone({ dump: "fail" });
  const busy = await post("tap_text", { query: "Network" });
  assert.equal(busy.status, 503);
  assert.equal(busy.body.code, "UI_DUMP_FAILED");
  assert.equal(busy.body.retryable, true);

  fakePhone();
  const key = await post("key", { key: "KEYCODE_APP_SWITCH" });
  assert.equal(key.status, 400);
  assert.equal(key.body.success, false);
  assert.match(String(key.body.error), /Unsupported key 'KEYCODE_APP_SWITCH'/);
});

test("unknown actions are 404, prototype names included, and the non-control tools stay off this route", async () => {
  const calls = fakePhone();
  for (const action of ["nope", "control_nope", "constructor", "toString", "__proto__", "hasOwnProperty", "get_ui_hierarchy", "ui_hierarchy", "os_hotkey", "compare_frames", "record_screen"]) {
    const reply = await post(action, {});
    assert.equal(reply.status, 404, action);
    assert.equal(reply.body.code, "UNKNOWN_ACTION", action);
    assert.equal(reply.body.error, `Unknown control action: ${action}`);
    assert.ok((reply.body.actions as string[]).includes("tap_text"), "the reply lists what the route answers");
  }
  assert.deepEqual(calls, []);
});

test("the bearer guard: no token or a wrong one is 401 before anything runs or shows on the timeline", async () => {
  const calls = fakePhone();
  const labels = await timeline(async () => {
    for (const auth of [null, "Bearer wrong-token", TOKEN, `Bearer ${TOKEN}x`]) {
      for (const action of ["tap", "status", "nope"]) {
        const reply = await post(action, { x: 1, y: 2 }, auth);
        assert.equal(reply.status, 401, `${action} with ${String(auth)}`);
        assert.deepEqual(reply.body, { success: false, error: "Invalid ScreenSync pairing token." });
      }
    }
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(labels, []);
});

test("the timeline shows each call under the tool's own name, legacy names included; refused calls do not show", async () => {
  fakePhone();
  const labels = await timeline(async () => {
    await post("tap", { x: 1, y: 2 });
    await post("launch", { package: "com.android.settings" });
    await post("open_url", { url: "https://example.com/" });
    await post("tap", {}); // MISSING_ARG
    await post("nope", {}); // 404
  });
  assert.deepEqual(labels, ["control_tap", "control_launch_app", "control_open_url"]);
});
