/**
 * Full aim-loop E2E: simulated mobile capture upload -> MCP tools -> app
 * HTTP readback. Mirrors exactly what the Flutter app sends in
 * ScreenRepository.pushToLocalMcpServer and what Claude Code would call.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = 3002;
const TOKEN = "e2e-pairing-token";
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-flow-"));

// ── Minimal valid PNG builder (3x2, single color) ─────────────────────────
let crcTable: Uint32Array | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function buildPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const row = Buffer.concat([
    Buffer.from([0]), // filter: none
    Buffer.alloc(width * 3, 0x3b),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Boot the hub+MCP server in a child process ────────────────────────────
const serverProcess = spawn(
  process.execPath,
  ["dist/index.js"],
  {
    env: {
      ...process.env,
      SCREEN_SYNC_PORT: String(PORT),
      SCREEN_SYNC_TOKEN: TOKEN,
      SCREEN_SYNC_DATA_DIR: DATA_DIR,
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

async function waitForHealth(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Hub did not become healthy in time");
}

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};

function uploadPayload(png: Buffer, filename: string) {
  return {
    imageDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    filename,
    timestamp: new Date().toISOString(),
    deviceModel: "E2E Virtual Device",
    screenResolution: { width: 3, height: 2 },
  };
}

let failed = false;
try {
  await waitForHealth();

  // 1. Health endpoint reports the hub.
  const health = await (await fetch(`${BASE}/health`)).json() as Record<string, unknown>;
  assert.equal(health.ok, true);

  // 2. Auth: wrong token must be rejected.
  const unauthorized = await fetch(`${BASE}/api/screens/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong" },
    body: JSON.stringify(uploadPayload(buildPng(3, 2), "x.png")),
  });
  assert.equal(unauthorized.status, 401, "upload must reject wrong token");

  const unauthorizedRead = await fetch(`${BASE}/api/screens/latest`, {
    headers: { Authorization: "Bearer wrong" },
  });
  assert.equal(unauthorizedRead.status, 401, "latest must reject wrong token");

  // 3. Validation: garbage payloads must 400, not crash.
  const badFilename = await fetch(`${BASE}/api/screens/upload`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(uploadPayload(buildPng(3, 2), "../../evil.png")),
  });
  assert.equal(badFilename.status, 400, "path-traversal filename must be rejected");

  const notAnImage = await fetch(`${BASE}/api/screens/upload`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      ...uploadPayload(buildPng(3, 2), "ok.png"),
      imageDataUrl: "data:image/png;base64,aGVsbG8gd29ybGQ=", // "hello world"
    }),
  });
  assert.equal(notAnImage.status, 400, "non-image bytes must be rejected");

  // 4. The actual aim: simulated mobile capture upload succeeds.
  const png = buildPng(3, 2);
  const uploadResponse = await fetch(`${BASE}/api/screens/upload`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(uploadPayload(png, "e2e_capture.png")),
  });
  assert.equal(uploadResponse.status, 201, "valid upload must return 201");
  const uploaded = await uploadResponse.json() as {
    success: boolean;
    frame: { id: string; screenResolution: { width: number; height: number } };
  };
  assert.equal(uploaded.success, true);
  assert.deepEqual(uploaded.frame.screenResolution, { width: 3, height: 2 });

  // 5. MCP view of the same frame: byte-identical image + metadata.
  const client = new Client({ name: "screensync-flow-e2e", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: {
      ...process.env,
      SCREEN_SYNC_PORT: String(PORT + 100), // MCP-only twin; shares DATA_DIR
      SCREEN_SYNC_TOKEN: TOKEN,
      SCREEN_SYNC_DATA_DIR: DATA_DIR,
    },
  });
  await client.connect(transport);

  const status = await client.callTool({ name: "get_device_status", arguments: {} });
  const statusContent = status.content as Array<{ type: string; text?: string }>;
  const statusBody = JSON.parse(statusContent[0]?.text ?? "{}") as Record<string, unknown>;
  assert.equal(statusBody.connected, true, "device status must show connected after upload");
  assert.equal(statusBody.stale, false, "fresh frame must not be marked stale");

  const latest = await client.callTool({
    name: "get_latest_screenshot",
    arguments: { includeMetadata: true },
  });
  const image = (latest.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>)
    .find((item) => item.type === "image");
  assert(image, "get_latest_screenshot must return image content");
  const returnedBytes = Buffer.from(image!.data!, "base64");
  assert(returnedBytes.equals(png), "MCP must return the exact uploaded bytes");
  assert.equal(image!.mimeType, "image/png");

  // 6. Claude publishes an inspection -> Flutter heatmap endpoint sees it.
  const publish = await client.callTool({
    name: "publish_inspection",
    arguments: {
      bugs: [{ id: "b1", label: "Clipped button", x: 0.1, y: 0.8, w: 0.2, h: 0.1, severity: "error" }],
      summary: "Submit button clipped at bottom edge.",
    },
  });
  assert.notEqual(publish.isError, true);
  const inspectionResponse = await fetch(`${BASE}/api/inspections/latest`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const inspection = await inspectionResponse.json() as { bugs: unknown[]; summary: string };
  assert.equal(inspection.summary, "Submit button clipped at bottom edge.");
  assert.equal(inspection.bugs.length, 1);

  // 7. Claude publishes a patch -> Flutter diagnose endpoint sees it.
  const patchPublish = await client.callTool({
    name: "publish_patch",
    arguments: {
      patch: "--- a/lib/main.dart\n+++ b/lib/main.dart\n@@ -1 +1 @@\n-fix\n+fixed\n",
      description: "Fix clipped submit button",
      filesTouched: ["lib/main.dart"],
    },
  });
  assert.notEqual(patchPublish.isError, true);
  const patchResponse = await fetch(`${BASE}/api/patches/latest`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const patchBody = await patchResponse.json() as { description: string; patch: string };
  assert.equal(patchBody.description, "Fix clipped submit button");
  assert(patchBody.patch.includes("+fixed"));

  await client.close();

  // 8. HTTP /api/screens/latest roundtrip matches the upload too.
  const latestHttp = await (
    await fetch(`${BASE}/api/screens/latest`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  ).json() as { imageDataUrl: string; deviceModel: string };
  const httpBytes = Buffer.from(latestHttp.imageDataUrl.split(",")[1]!, "base64");
  assert(httpBytes.equals(png), "HTTP latest must return the exact uploaded bytes");
  assert.equal(latestHttp.deviceModel, "E2E Virtual Device");

  process.stdout.write(JSON.stringify({ success: true, dataDir: DATA_DIR }, null, 2));
} catch (error) {
  failed = true;
  console.error("FLOW E2E FAILED:", error);
  process.exitCode = 1;
} finally {
  serverProcess.kill();
  rmSync(DATA_DIR, { recursive: true, force: true });
  if (!failed) process.stdout.write("\nflow-e2e cleaned up\n");
}
