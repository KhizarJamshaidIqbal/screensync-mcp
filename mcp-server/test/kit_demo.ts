/**
 * Simulates exactly what Claude Code/Desktop does after being handed the
 * Connect Kit: spawns the stdio server via the kit's config (default port —
 * proves the EADDRINUSE-tolerant path since a hub is already running),
 * discovers capabilities, and runs the recommended workflow end to end.
 */
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

const client = new Client({ name: "claude-sim", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, SCREEN_SYNC_TOKEN: "screensync-local-dev" } as Record<string, string>,
  }),
);

const textOf = (result: unknown) =>
  JSON.parse(
    String(
      ((result as { content?: unknown }).content as Content | undefined)?.find(
        (c) => c.type === "text",
      )?.text ?? "{}",
    ),
  ) as Record<string, unknown>;

// Step 1 — capability discovery (the kit tells agents to call this first)
const catalog = textOf(await client.callTool({ name: "get_mcp_catalog", arguments: {} }));
const tools = (catalog.tools as Array<{ name: string }>).map((t) => t.name);
assert(tools.includes("get_mcp_catalog") && tools.length === 8, "catalog should list all 8 tools");
console.log("STEP1 catalog:", tools.join(", "));
console.log("       skills:", (catalog.prompts as Array<{ name: string }>).map((p) => p.name).join(", "));

// Step 2 — freshness check
const status = textOf(await client.callTool({ name: "get_device_status", arguments: {} }));
console.log("STEP2 status: connected =", status.connected, "| retained =", status.retainedFrames);
assert.equal(status.connected, true, "phone frame must exist on the shared data dir");

// Step 3 — fetch the phone screenshot like Claude's vision would
const shot = await client.callTool({ name: "get_latest_screenshot", arguments: { includeMetadata: true } });
const image = ((shot as { content?: unknown }).content as Content).find((c) => c.type === "image");
assert(image?.data, "image content expected");
writeFileSync("../build/claude_sim_screenshot.png", Buffer.from(image.data, "base64"));
console.log("STEP3 screenshot saved: claude_sim_screenshot.png",
  `(${image.data.length} base64 chars, ${image.mimeType})`);

// Step 4 — publish a demo inspection back to the phone heatmap
const inspection = await client.callTool({
  name: "publish_inspection",
  arguments: {
    bugs: [
      { id: "demo-1", label: "Sample region (kit test)", x: 0.06, y: 0.24, w: 0.88, h: 0.18, severity: "info" },
    ],
    summary: "Connect Kit self-test: inspection publish path is live.",
  },
});
assert((inspection as { isError?: boolean }).isError !== true);
console.log("STEP4 inspection published:", textOf(inspection).inspectedAt);

await client.close();
console.log("KIT SIMULATION: all steps passed");
