/**
 * Connects to the ScreenSync MCP server (stdio), calls
 * get_latest_screenshot, saves the image and prints its metadata.
 *
 * Usage (from mcp-server/):
 *   SCREEN_SYNC_DATA_DIR=<same as running hub> npm run fetch:latest [outPath]
 */
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const outPath = process.argv[2] ?? "latest_screenshot.png";
const port = process.env.SCREEN_SYNC_PORT ?? "3005"; // avoid clashing with a live hub

const client = new Client({ name: "screensync-fetch", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, SCREEN_SYNC_PORT: port } as Record<string, string>,
  }),
);

const result = await client.callTool({
  name: "get_latest_screenshot",
  arguments: { includeMetadata: true },
});
const items = (result.content ?? []) as Array<{
  type: string;
  data?: string;
  mimeType?: string;
  text?: string;
}>;
const image = items.find((item) => item.type === "image");
const metadata = items.find((item) => item.type === "text");

if (!image?.data) {
  console.error("No screenshot available on the hub yet.");
  console.error(metadata?.text ?? "");
  process.exitCode = 1;
} else {
  writeFileSync(outPath, Buffer.from(image.data, "base64"));
  console.log(`Saved ${image.mimeType} -> ${outPath} (${image.data.length} base64 chars)`);
  console.log(metadata?.text ?? "");
}

await client.close();
