// Zero-Click HMR must reload the extension on a real edit and never on a read.
//
// A raw fs.watch on Windows reports an access-time update as "change": Chrome reading an extension page's
// stylesheet reloaded the whole extension and closed the page it had just opened. These cases pin the
// filter in ext-watcher.ts. The first one fails against the old raw watcher (verified on Windows, where the
// atime-only touch below does emit an event).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { watchExtensionDir } from "../ext-watcher.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 40;
const SETTLE = 400;

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ss-extwatch-"));
  writeFileSync(path.join(dir, "manifest.json"), "{}");
  return { dir };
}

test("ext-watcher: a read (access-time only) does not reload; a real edit does, once", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ss-extwatch-"));
  const css = path.join(dir, "components.css");
  writeFileSync(css, "a{}");
  const pinned = new Date(1_790_000_000_000); // whole milliseconds, so the stored mtime round-trips exactly
  utimesSync(css, pinned, pinned);
  const calls: string[] = [];
  const w = watchExtensionDir(dir, (f) => calls.push(f), DEBOUNCE);
  try {
    await sleep(100);
    utimesSync(css, new Date(), pinned); // what a read does on NTFS: atime moves, mtime and size do not
    await sleep(SETTLE);
    assert.equal(statSync(css).mtimeMs, pinned.getTime(), "the touch must leave mtime alone for this case to mean anything");
    assert.deepEqual(calls, [], "an access-time update is not an edit");

    writeFileSync(css, "a{color:red}");
    await sleep(SETTLE);
    assert.deepEqual(calls, ["components.css"], "a real edit reloads, debounced to one call");
  } finally {
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ext-watcher: new and deleted files count, other file types are ignored", async () => {
  const { dir } = fixture();
  const calls: string[] = [];
  const w = watchExtensionDir(dir, (f) => calls.push(f), DEBOUNCE);
  try {
    await sleep(100);
    writeFileSync(path.join(dir, "icon.png"), "png");
    await sleep(SETTLE);
    assert.deepEqual(calls, [], "only js/html/css/json reload the extension");

    writeFileSync(path.join(dir, "new-page.html"), "<p>");
    await sleep(SETTLE);
    assert.deepEqual(calls, ["new-page.html"], "a file that appears is an edit");

    unlinkSync(path.join(dir, "manifest.json"));
    await sleep(SETTLE);
    assert.deepEqual(calls, ["new-page.html", "manifest.json"], "a file that disappears is an edit");
  } finally {
    w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ext-watcher: close() cancels a reload that is still pending", async () => {
  const { dir } = fixture();
  const calls: string[] = [];
  const w = watchExtensionDir(dir, (f) => calls.push(f), 300);
  try {
    await sleep(100);
    writeFileSync(path.join(dir, "manifest.json"), '{"v":2}');
    await sleep(100); // the event has arrived; the debounced call has not fired yet
    w.close();
    await sleep(500);
    assert.deepEqual(calls, [], "a hub that is shutting down must not broadcast a reload");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
