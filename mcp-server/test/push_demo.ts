/**
 * Push-loop demo: boots the hub (HTTP on SCREEN_SYNC_PORT) as a child MCP
 * server, publishes an inspection through the real MCP tool, then exits.
 * The phone's SSE connection receives the event and auto-fetches.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, SCREEN_SYNC_PORT: process.env.SCREEN_SYNC_PORT ?? "3000" },
});
const client = new Client({ name: "push-demo", version: "1.0.0" });
await client.connect(transport);

// Give the phone's SSE client (exponential backoff) time to reconnect.
await new Promise((resolve) => setTimeout(resolve, 20_000));

await client.callTool({
  name: "publish_inspection",
  arguments: {
    bugs: [
      { id: "b1", label: "Clipped CTA", x: 40, y: 300, w: 220, h: 60, severity: "error" },
    ],
    summary: "Push-loop demo inspection",
  },
});
console.log("PUSH-DEMO: inspection published via MCP");
await new Promise((resolve) => setTimeout(resolve, 3_000));
await client.close();
process.exit(0);
