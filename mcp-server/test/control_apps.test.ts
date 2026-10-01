// control_launch_app by query and the app list, from runControlAction() down to the adb argv, with a scripted
// fake installed through setAdbRunner(). The fixtures follow the output formats of AOSP's
// `cmd package query-activities --brief` and `pm list packages -3`; no adb binary runs and no phone is touched.

import "./_isolate-data-dir.js";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setAdbRunner } from "../control-adb.js";
import { listApps, matchApps, parseLauncherPackages, parsePmPackages } from "../control-apps.js";
import { runControlAction, toMcpContent } from "../mcp-control.js";
import { resolveConsolidatedCall } from "../catalog-consolidated.js";

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/adb/${name}`, import.meta.url)), "utf-8");

const LAUNCHER = "shell cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER";
const THIRD_PARTY = "shell pm list packages -3";
const monkey = (pkg: string) => `shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`;

/** The launcher apps in query_activities_launcher.txt: sorted, com.example.tools once for its two activities. */
const LAUNCHER_APPS = [
  "com.android.chrome", "com.android.settings", "com.example.tools", "com.google.android.apps.messaging",
  "com.google.android.gm", "com.google.android.youtube", "com.whatsapp", "com.whatsapp.w4b",
];

/** A phone that answers the launcher query with `launcher` (or fails with it) and pm with the -3 fixture. */
function fakePhone(launcher: string | Error = fixture("query_activities_launcher.txt")): string[] {
  const calls: string[] = [];
  setAdbRunner(async (_bin, argv) => {
    const cmd = argv.join(" ");
    calls.push(cmd);
    if (cmd === LAUNCHER) {
      if (launcher instanceof Error) throw launcher;
      return Buffer.from(launcher, "utf8");
    }
    if (cmd === THIRD_PARTY) return Buffer.from(fixture("pm_list_packages_3.txt"), "utf8");
    if (cmd.startsWith("shell monkey -p ") || cmd.startsWith("shell am start -n ")) return Buffer.from("Events injected: 1\n");
    throw new Error(`unexpected adb call: ${cmd}`);
  });
  return calls;
}

/** control_launch_app through runControlAction, as an MCP client sees it: the parsed JSON and isError. */
async function launch(args?: Record<string, unknown>): Promise<{ body: Record<string, unknown>; isError?: boolean }> {
  const reply = toMcpContent(await runControlAction("control_launch_app", args));
  return { body: JSON.parse((reply.content[0] as { text: string }).text), isError: reply.isError };
}

beforeEach(() => delete process.env.SCREEN_SYNC_ADB_TARGET);
afterEach(() => setAdbRunner(null));

test("parsers: launcher and pm output become sorted, unique package names; anything else is ignored", () => {
  assert.deepEqual(parseLauncherPackages(fixture("query_activities_launcher.txt")), LAUNCHER_APPS);
  // --components lines, a full dump's packageName= line, CRLF from an old adb, and lines that are not packages.
  const mixed = "com.a.b/.X\r\ncom.a.b/.Y\r\n    packageName=org.c.d\r\nNo activities found\r\nError: no/such\r\na;reboot/x\r\nsingle/x\r\n";
  assert.deepEqual(parseLauncherPackages(mixed), ["com.a.b", "org.c.d"]);
  assert.deepEqual(parseLauncherPackages(fixture("query_activities_no_cmd.txt")), []);

  assert.deepEqual(parsePmPackages(fixture("pm_list_packages_3.txt")), ["com.example.keyboard", "com.example.tools", "com.whatsapp", "com.whatsapp.w4b"]);
  assert.deepEqual(parsePmPackages("package:com.x.y\r\npackage:$(reboot)\r\nnoise\r\n"), ["com.x.y"]);

  assert.deepEqual(matchApps(LAUNCHER_APPS, "WhatsApp"), ["com.whatsapp", "com.whatsapp.w4b"], "case-insensitive substring");
  assert.deepEqual(matchApps(LAUNCHER_APPS, " com.whatsapp "), ["com.whatsapp"], "an exact package wins on its own");
  assert.deepEqual(matchApps(LAUNCHER_APPS, "tiktok"), []);
});

test("listApps asks the launcher query only; thirdPartyOnly intersects it with pm list packages -3", async () => {
  let calls = fakePhone();
  assert.deepEqual(await listApps(), { packages: LAUNCHER_APPS, source: "launcher", thirdPartyOnly: false });
  assert.deepEqual(calls, [LAUNCHER]);

  calls = fakePhone();
  const own = await listApps(true);
  // com.example.keyboard is user-installed but has no launcher activity, so it is not an app to open.
  assert.deepEqual(own, { packages: ["com.example.tools", "com.whatsapp", "com.whatsapp.w4b"], source: "launcher", thirdPartyOnly: true });
  assert.deepEqual(calls, [LAUNCHER, THIRD_PARTY]);
});

test("older Android: no launcher query (printed or a failed exit) falls back to the user-installed packages, and says so", async () => {
  for (const launcher of [fixture("query_activities_no_cmd.txt"), new Error("Command failed: adb shell cmd package\nUnknown command: query-activities")]) {
    const calls = fakePhone(launcher);
    const apps = await listApps();
    assert.deepEqual([apps.source, apps.thirdPartyOnly, apps.packages.length], ["third-party", true, 4]);
    assert.match(apps.note ?? "", /System apps such as Settings are not in the list: launch them by package/);
    assert.deepEqual(calls, [LAUNCHER, THIRD_PARTY]);
  }
  fakePhone(fixture("query_activities_no_cmd.txt"));
  const missing = await launch({ query: "settings" });
  assert.deepEqual([missing.body.code, missing.body.source, missing.body.searched], ["NOT_FOUND", "third-party", 4]);
  assert.match(String(missing.body.note), /launch them by package/);
});

test("query: one match launches it, case-insensitively; an exact package name is never ambiguous", async () => {
  let calls = fakePhone();
  const youtube = await launch({ query: "YouTube" });
  assert.deepEqual(youtube, {
    body: { success: true, detail: "launched com.google.android.youtube", package: "com.google.android.youtube", query: "YouTube", source: "launcher" },
    isError: false,
  });
  assert.deepEqual(calls, [LAUNCHER, monkey("com.google.android.youtube")]);

  calls = fakePhone();
  assert.equal((await launch({ query: "com.whatsapp" })).body.package, "com.whatsapp");
  assert.deepEqual(calls, [LAUNCHER, monkey("com.whatsapp")]);

  calls = fakePhone();
  assert.equal((await launch({ query: "w4b", thirdPartyOnly: true })).body.package, "com.whatsapp.w4b");
  assert.deepEqual(calls, [LAUNCHER, THIRD_PARTY, monkey("com.whatsapp.w4b")]);
});

test("query: several matches are AMBIGUOUS with the candidates, none is NOT_FOUND, and nothing is launched", async () => {
  const calls = fakePhone();
  const both = await launch({ query: "whatsapp" });
  assert.equal(both.isError, true);
  assert.deepEqual(
    [both.body.success, both.body.code, both.body.retryable, both.body.count, both.body.candidates, both.body.query],
    [false, "AMBIGUOUS", false, 2, ["com.whatsapp", "com.whatsapp.w4b"], "whatsapp"],
  );
  assert.match(String(both.body.error), /"whatsapp" matches 2 apps: com\.whatsapp, com\.whatsapp\.w4b\. Pass the one you mean as package/);

  const none = await launch({ query: "tiktok" });
  assert.deepEqual([none.isError, none.body.code, none.body.retryable, none.body.searched, none.body.source], [true, "NOT_FOUND", false, 8, "launcher"]);
  assert.match(String(none.body.error), /package names, not the labels on the home screen \(Gmail is com\.google\.android\.gm\)/);
  assert.ok(!calls.some((c) => c.includes("monkey")), "an ambiguous or unknown query launches nothing");

  // A broad query lists at most 20 candidates, and the count and the message say how many more there were.
  const many = Array.from({ length: 25 }, (_, i) => `    com.example.app${String(i).padStart(2, "0")}/.Main`).join("\n");
  fakePhone(many);
  const broad = await launch({ query: "example" });
  assert.deepEqual([broad.body.code, broad.body.count, (broad.body.candidates as string[]).length], ["AMBIGUOUS", 25, 20]);
  assert.match(String(broad.body.error), /com\.example\.app19 and 5 more\./);
});

test("list: true returns the package names and launches nothing; with a query, only the matches", async () => {
  const calls = fakePhone();
  assert.deepEqual((await launch({ list: true })).body, {
    success: true, count: 8, packages: LAUNCHER_APPS, thirdPartyOnly: false, source: "launcher",
  });
  assert.deepEqual((await launch({ list: true, query: "GOOGLE" })).body, {
    success: true, count: 3, packages: ["com.google.android.apps.messaging", "com.google.android.gm", "com.google.android.youtube"],
    query: "GOOGLE", thirdPartyOnly: false, source: "launcher",
  });
  const own = (await launch({ list: true, thirdPartyOnly: true })).body;
  assert.deepEqual([own.count, own.thirdPartyOnly], [3, true]);
  assert.ok(!calls.some((c) => c.includes("monkey")));
});

test("package keeps today's behaviour; a missing or mixed argument is a typed INVALID_ARGUMENTS before any adb call", async () => {
  const calls = fakePhone();
  assert.deepEqual(await launch({ package: "com.android.settings" }), { body: { success: true, detail: "launched com.android.settings" }, isError: false });
  await launch({ package: "com.example/.MainActivity", list: false });
  assert.deepEqual(calls, [monkey("com.android.settings"), "shell am start -n com.example/.MainActivity"], "no app list is read for a package");

  for (const args of [undefined, {}, { package: "com.x", query: "x" }, { package: "com.x", list: true }, { query: "  " }, { query: 5 }, { package: 5 }]) {
    const bad = await launch(args as Record<string, unknown> | undefined);
    assert.deepEqual([bad.isError, bad.body.code, bad.body.retryable], [true, "INVALID_ARGUMENTS", false], JSON.stringify(args));
    assert.match(String(bad.body.error), /Nothing was launched\.$/);
  }
  assert.equal(calls.length, 2, "a refused call never reaches adb");
  await assert.rejects(runControlAction("control_launch_app", { package: "com.example; reboot" }), /Invalid package/);
});

test("the consolidated mobile_control launch and tap actions pass the new arguments through", async () => {
  fakePhone();
  const via = resolveConsolidatedCall("mobile_control", { action: "launch", args: { query: "chrome" } });
  assert.deepEqual(via, { toolName: "control_launch_app", args: { query: "chrome" } });
  assert.equal((await launch((via as { args: Record<string, unknown> }).args)).body.package, "com.android.chrome");
  assert.deepEqual(
    resolveConsolidatedCall("mobile_control", { action: "tap", args: { x: 1, y: 2, count: 2 } }),
    { toolName: "control_tap", args: { x: 1, y: 2, count: 2 } },
  );
});

test("no QUERY_ALL_PACKAGES: apps are listed by the shell user over adb, so no app manifest asks for it", () => {
  const src = fileURLToPath(new URL("../../android/app/src/", import.meta.url));
  const manifests = readdirSync(src, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(src, d.name, "AndroidManifest.xml"))
    .flatMap((path) => {
      try {
        return [{ path, text: readFileSync(path, "utf-8") }];
      } catch {
        return [];
      }
    });
  assert.ok(manifests.length >= 2, "the main and sideload manifests are read");
  for (const { path, text } of manifests) assert.ok(!text.includes("QUERY_ALL_PACKAGES"), path);
});
