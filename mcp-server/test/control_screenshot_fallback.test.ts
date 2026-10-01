// mobile_control `screenshot` in consolidated mode: the live grab over ADB, or, when ADB cannot answer, the
// bubble's latest frame marked live: false. Before that action meant the live grab it returned the bubble's
// frame, so a phone that streams through the bubble without ADB must keep getting an image. The fake runner
// stands in for adb and the frames are written to the isolated data dir; no phone is touched.

import { ISOLATED_DATA_DIR } from "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FRAMES_DIR } from "../config.js";

// The frames written and removed below must be the temp dir's, never a real hub's.
assert.equal(path.dirname(FRAMES_DIR), ISOLATED_DATA_DIR);
import { setAdbRunner } from "../control-adb.js";
import { liveScreenOrFrame } from "../mcp-control.js";
import type { FrameMetadata } from "../storage.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const BUBBLE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]); // the bubble's upload, a JPEG
const NO_ADB = Object.assign(new Error("spawn adb ENOENT"), { code: "ENOENT" });

type Reply = Awaited<ReturnType<typeof liveScreenOrFrame>>;
const textOf = (reply: Reply) => {
  const block = reply.content.find((c) => c.type === "text");
  return block && block.type === "text" ? JSON.parse(block.text) : undefined;
};

/** adb answers every call with `out`, or throws it. */
function adbAnswers(out: Buffer | string | Error): void {
  setAdbRunner(async () => {
    if (out instanceof Error) throw out;
    return Buffer.isBuffer(out) ? out : Buffer.from(out, "utf8");
  });
}

/** Stores a bubble frame received `ageSeconds` ago, as the upload route does. */
function storeFrame(ageSeconds: number): FrameMetadata {
  mkdirSync(FRAMES_DIR, { recursive: true });
  const frame: FrameMetadata = {
    id: "bubble-1", filename: "capture.jpg", filePath: path.join(FRAMES_DIR, "bubble-1.jpg"), mimeType: "image/jpeg",
    timestamp: new Date().toISOString(), receivedAt: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    deviceModel: "Pixel 8", screenResolution: { width: 1080, height: 2400 }, byteLength: BUBBLE.length,
  };
  writeFileSync(frame.filePath, BUBBLE);
  writeFileSync(path.join(FRAMES_DIR, "bubble-1.json"), JSON.stringify(frame));
  return frame;
}

afterEach(() => {
  setAdbRunner(null);
  rmSync(FRAMES_DIR, { recursive: true, force: true });
});

test("with ADB: the live screen, then a text block saying it is live (as get_latest_screenshot's image + text)", async () => {
  adbAnswers(PNG);
  storeFrame(300); // an old bubble frame exists, and is NOT what comes back
  const reply = await liveScreenOrFrame({});
  assert.deepEqual(reply.content.map((c) => c.type), ["image", "text"]);
  assert.deepEqual(reply.content[0], { type: "image", data: PNG.toString("base64"), mimeType: "image/png" });
  const meta = textOf(reply);
  assert.deepEqual([meta.source, meta.live, meta.mimeType], ["adb", true, "image/png"]);
  assert.ok(!Number.isNaN(Date.parse(meta.capturedAt)));
  assert.equal("isError" in reply, false);

  const bare = await liveScreenOrFrame({ includeMetadata: false });
  assert.deepEqual(bare.content.map((c) => c.type), ["image"], "includeMetadata: false is the image alone");
});

test("no adb binary: the bubble's latest frame, marked live: false with its age and a note naming `frame`", async () => {
  adbAnswers(NO_ADB);
  const frame = storeFrame(90);
  const reply = await liveScreenOrFrame(undefined);
  assert.equal("isError" in reply, false, "an image came back, so it is not an error");
  assert.deepEqual(reply.content[0], { type: "image", data: BUBBLE.toString("base64"), mimeType: "image/jpeg" });
  const meta = textOf(reply);
  assert.deepEqual([meta.source, meta.live, meta.id, meta.receivedAt, meta.deviceModel], ["bubble", false, frame.id, frame.receivedAt, "Pixel 8"],
    "the frame's own metadata is still there, as get_latest_screenshot returned it");
  assert.ok(meta.ageSeconds >= 89 && meta.ageSeconds <= 92, String(meta.ageSeconds));
  assert.match(meta.liveError, /spawn adb ENOENT/);
  assert.match(meta.note, /^Not live: .*mobile_control action "frame"/);

  // includeMetadata: false drops the frame's metadata, never the note that it is not live.
  const bare = textOf(await liveScreenOrFrame({ includeMetadata: false }));
  assert.deepEqual(Object.keys(bare).sort(), ["ageSeconds", "live", "liveError", "note", "source"]);
});

test("a device that answers with something other than a PNG also falls back to the frame", async () => {
  adbAnswers("error: no devices/emulators found");
  storeFrame(5);
  const meta = textOf(await liveScreenOrFrame({}));
  assert.equal(meta.live, false);
  assert.match(meta.liveError, /did not return a PNG/);
});

test("no ADB and no frame: NO_SCREEN, and the error says how to get one (control_status, the bubble, action frame)", async () => {
  adbAnswers(NO_ADB);
  const reply = await liveScreenOrFrame({});
  assert.equal(reply.isError, true);
  assert.deepEqual(reply.content.map((c) => c.type), ["text"]);
  const body = textOf(reply);
  assert.deepEqual([body.success, body.code, body.retryable], [false, "NO_SCREEN", false]);
  assert.match(body.liveError, /ENOENT/);
  assert.match(body.error, /control_status/);
  assert.match(body.error, /mobile_control action "frame"/);
});
