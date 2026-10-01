// storage.ts retention: what leaves data/frames, and what the archive keeps.
//
// What used to go wrong: retainRecentFrames() renamed every old frame to <id>.png, so a JPEG (what the phone's
// mirror sends) sat in the archive under a .png name; and pruneArchive() sorted by file name to decide what to delete,
// but names are UUIDs, so it removed frames in arbitrary order (a minute-old screenshot could go before a month-old
// one) and, keyed on .png, left the JPEG behind when it removed the metadata. Runs on a temp data dir.

import { ISOLATED_DATA_DIR } from "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ARCHIVE_DIR, DATA_DIR, FRAMES_DIR, MAX_ARCHIVE, MAX_FRAMES } from "../config.js";
import { listFrames, pruneArchive, retainRecentFrames, type FrameMetadata } from "../storage.js";

test("the data dir is the isolated temp dir, never the repo's data/", () => {
  assert.equal(DATA_DIR, ISOLATED_DATA_DIR);
});

const names = (dir: string) => readdirSync(dir).sort();

/** Writes one frame (image + metadata) into `dir`; the metadata's mtime is set to `at` like a real arrival would leave it. */
function writeFrame(dir: string, id: string, ext: "jpg" | "png", at: number): FrameMetadata {
  const meta: FrameMetadata = {
    id,
    filename: `${id}.${ext}`,
    filePath: path.join(FRAMES_DIR, `${id}.${ext}`),
    mimeType: ext === "jpg" ? "image/jpeg" : "image/png",
    timestamp: new Date(at).toISOString(),
    receivedAt: new Date(at).toISOString(),
    deviceModel: "Test device",
    screenResolution: { width: 1, height: 1 },
    byteLength: 3,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id}.${ext}`), "img");
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(meta));
  utimesSync(path.join(dir, `${id}.json`), new Date(at), new Date(at));
  return meta;
}

test("retainRecentFrames archives an old JPEG as .jpg, an old PNG as .png, and keeps the newest MAX_FRAMES live", async () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  // MAX_FRAMES + 2 frames; the two oldest are a JPEG and a PNG. Later frames alternate, all newer.
  writeFrame(FRAMES_DIR, "aaaaaaaa-old-jpeg", "jpg", t0);
  writeFrame(FRAMES_DIR, "bbbbbbbb-old-png", "png", t0 + 1000);
  for (let i = 0; i < MAX_FRAMES; i++) writeFrame(FRAMES_DIR, `live-${String(i).padStart(2, "0")}`, i % 2 ? "jpg" : "png", t0 + 10_000 + i * 1000);

  await retainRecentFrames();

  assert.deepEqual(names(ARCHIVE_DIR), ["aaaaaaaa-old-jpeg.jpg", "aaaaaaaa-old-jpeg.json", "bbbbbbbb-old-png.json", "bbbbbbbb-old-png.png"],
    "the JPEG keeps its .jpg name (it used to be renamed to .png)");
  const live = names(FRAMES_DIR);
  assert.equal(live.filter((n) => n.endsWith(".json")).length, MAX_FRAMES, "the newest MAX_FRAMES stay live");
  assert.ok(!live.some((n) => n.includes("old-")), "the two oldest left data/frames");
  assert.equal((await listFrames()).length, MAX_FRAMES);
});

test("pruneArchive removes the OLDEST frames first, both files of each, whatever their UUID order", async () => {
  // A fresh archive: MAX_ARCHIVE + 5 frames. Give the 5 oldest ids that sort LAST by name (zz-...), and the newest
  // ids that sort FIRST (aa-...), so a name-ordered prune would delete exactly the wrong ones.
  const { rmSync } = await import("node:fs");
  rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const t0 = Date.parse("2026-02-01T00:00:00Z");
  const oldest = Array.from({ length: 5 }, (_, i) => `zz-oldest-${i}`);
  for (const [i, id] of oldest.entries()) writeFrame(ARCHIVE_DIR, id, i % 2 ? "png" : "jpg", t0 + i * 1000);
  const rest = Array.from({ length: MAX_ARCHIVE }, (_, i) => `aa-newer-${String(i).padStart(3, "0")}`);
  for (const [i, id] of rest.entries()) writeFrame(ARCHIVE_DIR, id, i % 3 ? "png" : "jpg", t0 + 100_000 + i * 1000);
  assert.equal(readdirSync(ARCHIVE_DIR).filter((n) => n.endsWith(".json")).length, MAX_ARCHIVE + 5);

  await pruneArchive();

  const left = names(ARCHIVE_DIR);
  assert.equal(left.filter((n) => n.endsWith(".json")).length, MAX_ARCHIVE, "pruned down to exactly MAX_ARCHIVE");
  assert.ok(!left.some((n) => n.startsWith("zz-oldest-")), `the 5 oldest are gone, images included (left: ${left.filter((n) => n.startsWith("zz-")).join(", ")})`);
  assert.equal(left.filter((n) => n.startsWith("aa-newer-")).length, MAX_ARCHIVE * 2, "every newer frame kept both its image and its metadata");
  assert.equal(left.filter((n) => !n.endsWith(".json") && !n.endsWith(".png") && !n.endsWith(".jpg")).length, 0);
});

test("pruneArchive leaves an archive at or under MAX_ARCHIVE alone", async () => {
  const before = names(ARCHIVE_DIR);
  assert.equal(before.filter((n) => n.endsWith(".json")).length, MAX_ARCHIVE);
  await pruneArchive();
  assert.deepEqual(names(ARCHIVE_DIR), before);
});

test("pruneArchive still removes a legacy JPEG that an older hub archived under a .png name", async () => {
  const { rmSync } = await import("node:fs");
  rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const t0 = Date.parse("2026-03-01T00:00:00Z");
  writeFrame(ARCHIVE_DIR, "legacy-oldest", "png", t0); // what the old rename left: a .png (holding JPEG bytes) + .json
  for (let i = 0; i < MAX_ARCHIVE; i++) writeFrame(ARCHIVE_DIR, `newer-${String(i).padStart(3, "0")}`, "jpg", t0 + 10_000 + i * 1000);
  await pruneArchive();
  const left = names(ARCHIVE_DIR);
  assert.ok(!left.some((n) => n.startsWith("legacy-oldest")), "both legacy files are removed");
  assert.equal(left.filter((n) => n.endsWith(".json")).length, MAX_ARCHIVE);
});
