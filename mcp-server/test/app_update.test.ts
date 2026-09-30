// app-update.ts: what the hub advertises as "the latest build", and how it knows.
//
// What used to go wrong: the manifest took versionCode/versionName from pubspec.yaml while the served APK was built
// separately. After a version bump (and a hub restart) the hub advertised N+1 while still serving the N-stamped APK,
// so every phone saw "an update is available" forever, and a blocking update gate would have locked them out. The
// version now comes from the APK's own Gradle output-metadata.json, with pubspec.yaml only as the fallback.
//
// Pure file-system tests against a throwaway repository root: no port, no hub, the real build/ is never read.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { apkCandidates, appApkPath, appManifest, invalidateAppManifest, isApkArtifactName } from "../app-update.js";

const roots: string[] = [];
process.on("exit", () => { for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch { /* temp dir */ } } });

type Fixture = {
  pubspec?: string;
  sideloadApk?: string;
  legacyApk?: string;
  /** output-metadata.json under apk/sideload/release; a string is written verbatim (to test malformed input). */
  sideloadMeta?: unknown;
  /** output-metadata.json under apk/release (the legacy un-flavored layout). */
  legacyMeta?: unknown;
};

/** A repository root shaped like the real one: pubspec.yaml at the top, build outputs under build/app/outputs. */
function repo(f: Fixture): string {
  const root = mkdtempSync(path.join(tmpdir(), "screensync-app-update-"));
  roots.push(root);
  const write = (rel: string[], body: string) => {
    const file = path.join(root, ...rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  const json = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  if (f.pubspec !== undefined) write(["pubspec.yaml"], `name: demo\nversion: ${f.pubspec}\n`);
  if (f.sideloadApk !== undefined) write(["build", "app", "outputs", "flutter-apk", "app-sideload-release.apk"], f.sideloadApk);
  if (f.legacyApk !== undefined) write(["build", "app", "outputs", "flutter-apk", "app-release.apk"], f.legacyApk);
  if (f.sideloadMeta !== undefined) write(["build", "app", "outputs", "apk", "sideload", "release", "output-metadata.json"], json(f.sideloadMeta));
  if (f.legacyMeta !== undefined) write(["build", "app", "outputs", "apk", "release", "output-metadata.json"], json(f.legacyMeta));
  return root;
}

/** What Gradle writes next to a built APK (only the fields the hub reads, plus the file it describes). */
const metadata = (versionCode: number, versionName: string, outputFile?: string) => ({
  version: 3,
  applicationId: "com.screensync.mcp",
  elements: [{ type: "SINGLE", versionCode, versionName, ...(outputFile ? { outputFile } : {}) }],
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Runs `fn` and returns every WARN the hub logged meanwhile (log() writes JSON lines to stderr). */
async function warnings<T>(fn: () => Promise<T>): Promise<{ result: T; warns: Array<Record<string, unknown>> }> {
  const original = console.error;
  const warns: Array<Record<string, unknown>> = [];
  console.error = (line?: unknown) => {
    try {
      const parsed = JSON.parse(String(line)) as Record<string, unknown>;
      if (parsed.level === "WARN") warns.push(parsed);
    } catch { /* not a hub log line */ }
  };
  try {
    return { result: await fn(), warns };
  } finally {
    console.error = original;
  }
}

test("the version comes from the APK's own build metadata, not from a pubspec that was bumped afterwards", async () => {
  // The bug: pubspec already says 33, but the APK on disk was stamped 32. Advertising 33 makes every phone (which
  // reports 32) see an update that does not exist, forever.
  const root = repo({
    pubspec: "9.9.9+900",
    sideloadApk: "apk-bytes-32",
    sideloadMeta: metadata(32, "2.5.4", "app-sideload-release.apk"),
  });
  const { result: m, warns } = await warnings(() => appManifest(root));
  assert.ok(m);
  assert.equal(m.versionCode, 32);
  assert.equal(m.versionName, "2.5.4");
  assert.equal(m.versionSource, "apk-metadata");
  assert.equal(m.sha256, sha("apk-bytes-32"));
  assert.equal(m.sizeBytes, "apk-bytes-32".length);
  assert.equal(warns.length, 1, "a metadata/pubspec disagreement is worth one warning");
  assert.match(String(warns[0]!.message), /disagree/i);
  assert.equal(warns[0]!.metadata, "2.5.4+32");
  assert.equal(warns[0]!.pubspec, "9.9.9+900");
});

test("the disagreement warning is logged once, not on every poll", async () => {
  const root = repo({ pubspec: "7.7.7+777", sideloadApk: "x", sideloadMeta: metadata(70, "7.0.0") });
  const { warns } = await warnings(async () => {
    await appManifest(root);
    await appManifest(root);
    await appManifest(root);
  });
  assert.equal(warns.length, 1);
});

test("metadata and pubspec agreeing is silent", async () => {
  const root = repo({ pubspec: "3.1.4+15", sideloadApk: "x", sideloadMeta: metadata(15, "3.1.4") });
  const { result: m, warns } = await warnings(() => appManifest(root));
  assert.equal(m?.versionSource, "apk-metadata");
  assert.deepEqual(warns, []);
});

test("with no build metadata the version falls back to pubspec.yaml and says so", async () => {
  const root = repo({ pubspec: "2.5.4+32", sideloadApk: "apk" });
  const m = await appManifest(root);
  assert.ok(m);
  assert.equal(m.versionCode, 32);
  assert.equal(m.versionName, "2.5.4");
  assert.equal(m.versionSource, "pubspec");
});

test("malformed or incomplete metadata is ignored, never trusted", async () => {
  for (const bad of ["{ not json", {}, { elements: [] }, metadata(0, "1.0.0"), metadata(5, ""), { elements: [{ versionCode: "abc", versionName: "1.0.0" }] }]) {
    const root = repo({ pubspec: "4.0.0+40", sideloadApk: "apk", sideloadMeta: bad });
    const m = await appManifest(root);
    assert.equal(m?.versionSource, "pubspec", `metadata ${JSON.stringify(bad)} must fall back to pubspec`);
    assert.equal(m?.versionCode, 40);
  }
});

test("neither metadata nor pubspec: 0.0.0+0 from pubspec, but the APK is still described", async () => {
  const root = repo({ sideloadApk: "apk" });
  const m = await appManifest(root);
  assert.ok(m);
  assert.equal(m.versionSource, "pubspec");
  assert.equal(m.versionCode, 0);
  assert.equal(m.versionName, "0.0.0");
  assert.equal(m.sha256, sha("apk"));
});

test("the sideload APK is preferred over the legacy app-release.apk; the legacy one is still served when it is all there is", async () => {
  const both = repo({ pubspec: "1.0.0+1", sideloadApk: "sideload", legacyApk: "legacy" });
  assert.equal(path.basename(appApkPath(both)), "app-sideload-release.apk");
  assert.equal((await appManifest(both))?.sha256, sha("sideload"));

  const legacyOnly = repo({ pubspec: "1.0.0+1", legacyApk: "legacy" });
  assert.equal(path.basename(appApkPath(legacyOnly)), "app-release.apk");
  assert.equal((await appManifest(legacyOnly))?.sha256, sha("legacy"));

  const none = repo({ pubspec: "1.0.0+1" });
  assert.equal(await appManifest(none), null, "no APK built: no manifest");
  assert.equal(path.basename(appApkPath(none)), "app-sideload-release.apk", "the preferred path is still the target for messages and the watcher");
  assert.deepEqual(apkCandidates(none).map((p) => path.basename(p)), ["app-sideload-release.apk", "app-release.apk"]);
});

test("metadata that describes a different APK than the one served is not used for it", async () => {
  // Only the legacy APK exists, but a newer flavored build left its metadata behind: that metadata is not this file's.
  const stray = repo({ pubspec: "5.0.0+50", legacyApk: "legacy", sideloadMeta: metadata(99, "9.9.9", "app-sideload-release.apk") });
  const m = await appManifest(stray);
  assert.equal(m?.versionSource, "pubspec");
  assert.equal(m?.versionCode, 50);

  // The legacy un-flavored layout describes the legacy APK, so it does apply to it.
  const legacy = repo({ pubspec: "5.0.0+50", legacyApk: "legacy", legacyMeta: metadata(48, "4.8.0", "app-release.apk") });
  const l = await appManifest(legacy);
  assert.equal(l?.versionSource, "apk-metadata");
  assert.equal(l?.versionCode, 48);
});

test("the sha256 is cached against size+mtime and follows a rebuilt APK", async () => {
  const root = repo({ pubspec: "1.0.0+1", sideloadApk: "AAAA" });
  const apk = appApkPath(root);
  // Whole-millisecond mtimes, so "same mtime" below is exactly the same key.
  const at = (ms: number) => utimesSync(apk, new Date(ms), new Date(ms));
  const t0 = Date.now() - 60_000;
  at(t0);
  assert.equal((await appManifest(root))?.sha256, sha("AAAA"));

  // Same size, same mtime: the cached hash is what is served (that is the cache doing its job).
  writeFileSync(apk, "BBBB");
  at(t0);
  assert.equal((await appManifest(root))?.sha256, sha("AAAA"), "unchanged size+mtime keeps the cached hash");

  // A new mtime (what any real rebuild changes) re-hashes.
  at(t0 + 5000);
  assert.equal((await appManifest(root))?.sha256, sha("BBBB"), "a new mtime re-hashes");

  // A different size re-hashes.
  writeFileSync(apk, "CCCCCC");
  at(t0 + 6000);
  assert.equal((await appManifest(root))?.sha256, sha("CCCCCC"), "a new size re-hashes");

  // invalidateAppManifest() forces a re-hash even when size and mtime did not move.
  writeFileSync(apk, "DDDDDD");
  at(t0 + 6000);
  assert.equal((await appManifest(root))?.sha256, sha("CCCCCC"));
  invalidateAppManifest();
  assert.equal((await appManifest(root))?.sha256, sha("DDDDDD"));
});

test("a version bump is advertised without waiting for the sha cache: the version files are re-read every call", async () => {
  const root = repo({ pubspec: "1.0.0+1", sideloadApk: "same-apk", sideloadMeta: metadata(1, "1.0.0") });
  assert.equal((await appManifest(root))?.versionCode, 1);
  writeFileSync(path.join(root, "build", "app", "outputs", "apk", "sideload", "release", "output-metadata.json"), JSON.stringify(metadata(2, "1.0.1")));
  assert.equal((await appManifest(root))?.versionCode, 2, "the APK bytes did not change, the metadata did");
});

test("the release watcher reacts to both APK names and their .sha1 companions, and to nothing else", () => {
  for (const name of ["app-sideload-release.apk", "app-sideload-release.apk.sha1", "app-release.apk", "app-release.apk.sha1"]) {
    assert.equal(isApkArtifactName(name), true, name);
  }
  for (const name of ["app-debug.apk", "app-sideload-debug.apk", "output-metadata.json", "screensync.apk"]) {
    assert.equal(isApkArtifactName(name), false, name);
  }
});
