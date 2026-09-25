// Protocol e2e: spawns the built hub over stdio and walks the core MCP surface.
//
// Fully isolated (M12): its own temp data dir, its own token and port 3014, so it never touches the
// developer's data/ (frames, cognitive memory) or a live hub on 3000. It uploads its own screenshots through
// the hub's real upload route, so it passes on a machine that has never received a frame.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = 3014;
const TOKEN = "e2e-protocol-token";
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-protocol-"));

/** A real PNG (signature, IHDR, IDAT, IEND with valid CRCs) of random pixels, so it stays well over 1000 base64 chars. */
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), randomBytes(width * 3)])));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function waitForHealth(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Hub on :${PORT} did not become healthy in time`);
}

async function uploadFrame(i: number): Promise<void> {
  const res = await fetch(`${BASE}/api/screens/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${makePng(48, 32).toString("base64")}`,
      filename: `e2e-frame-${i}.png`,
      timestamp: new Date(Date.now() - (2 - i) * 1000).toISOString(),
      deviceModel: "e2e synthetic device",
    }),
  });
  assert.equal(res.status, 201, `frame ${i} upload failed: ${res.status} ${await res.text()}`);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: {
    ...process.env,
    SCREEN_SYNC_PORT: String(PORT),
    SCREEN_SYNC_TOKEN: TOKEN,
    SCREEN_SYNC_DATA_DIR: DATA_DIR,
  } as Record<string, string>,
});
const client = new Client({ name: "screensync-e2e", version: "1.0.0" });

try {
  await client.connect(transport);
  await waitForHealth();
  // /health reports the hub's real release version (package.json), not a hard-coded string.
  const health = (await (await fetch(`${BASE}/health`)).json()) as { version?: string };
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(health.version, pkg.version, "/health version comes from package.json");
  // The data dir is empty: give the screenshot tools something real to return.
  await uploadFrame(0);
  await uploadFrame(1);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  const expectedCore = [
    "get_device_status",
    "get_latest_screenshot",
    "get_mcp_catalog",
    "get_recent_screenshots",
    "get_skills",
    "list_recent_screens",
    "publish_inspection",
    "publish_patch",
  ];
  for (const expected of expectedCore) {
    assert(toolNames.includes(expected), `Missing core tool: ${expected}`);
  }
  assert(toolNames.includes("web_status"), "Missing web_status tool");
  assert(toolNames.includes("web_hierarchy"), "Missing web_hierarchy tool");
  assert(toolNames.includes("control_status"), "Missing control_status tool");
  assert(toolNames.length >= 40, `Expected >= 40 tools, got ${toolNames.length}`);

  const prompts = await client.listPrompts();
  assert(prompts.prompts.some((prompt) => prompt.name === "inspect_latest_mobile_screen"));

  const resources = await client.listResources();
  assert(resources.resources.some((resource) => resource.uri === "screensync://status"));
  assert(resources.resources.some((resource) => resource.uri === "screensync://workflow"));
  assert(resources.resources.some((resource) => resource.uri === "screensync://skills"));

  const skills = await client.callTool({ name: "get_skills", arguments: {} });
  assert.notEqual(skills.isError, true);

  const recentShots = await client.callTool({ name: "get_recent_screenshots", arguments: { limit: 2 } });
  assert.notEqual(recentShots.isError, true);
  assert((recentShots.content as Array<{ type: string }>).some((c) => c.type === "image"));

  const statusResource = await client.readResource({ uri: "screensync://status" });
  assert.equal(statusResource.contents[0]?.mimeType, "application/json");

  const prompt = await client.getPrompt({
    name: "inspect_latest_mobile_screen",
    arguments: { focus: "RenderFlex overflow and accessibility" },
  });
  assert(prompt.messages[0]?.content.type === "text");

  const status = await client.callTool({ name: "get_device_status", arguments: {} });
  assert.notEqual(status.isError, true);

  const catalog = await client.callTool({ name: "get_mcp_catalog", arguments: {} });
  assert.notEqual(catalog.isError, true);
  const catalogBody = JSON.parse(
    String((catalog.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}"),
  ) as {
    tools?: Array<{ name: string }>;
    prompts?: Array<{ name: string }>;
    resources?: Array<{ uri: string }>;
    connection?: { stdio?: { command: string }; httpHub?: { bearerToken: string } };
  };
  assert(catalogBody.tools && catalogBody.tools.length >= 40);
  assert(catalogBody.tools?.some((t) => t.name === "get_mcp_catalog"));
  assert(catalogBody.prompts?.some((p) => p.name === "inspect_latest_mobile_screen"));
  assert.equal(catalogBody.resources?.length, 3);
  assert.equal(catalogBody.connection?.stdio?.command, "node");
  assert(catalogBody.connection?.httpHub?.bearerToken);

  const recent = await client.callTool({ name: "list_recent_screens", arguments: { limit: 3 } });
  assert.notEqual(recent.isError, true);

  const latest = await client.callTool({
    name: "get_latest_screenshot",
    arguments: { includeMetadata: true },
  });
  assert.notEqual(latest.isError, true);
  assert(Array.isArray(latest.content));
  const image = latest.content.find((item) => item.type === "image");
  assert(image && image.type === "image");
  assert(["image/png", "image/jpeg"].includes(image.mimeType));
  assert(image.data.length > 1000);
  assert.equal(image.mimeType, "image/png");

  process.stdout.write(
    JSON.stringify(
      {
        success: true,
        tools: tools.tools.map((tool) => tool.name),
        prompts: prompts.prompts.map((item) => item.name),
        resources: resources.resources.map((item) => item.uri),
        imageMimeType: image.mimeType,
        imageBase64Chars: image.data.length,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
