/**
 * Live MCP tool driver: runs the ScreenSync MCP server in-process over an
 * in-memory transport pair and invokes one tool, dumping image/text content
 * to disk so the operator can inspect it.
 *
 * Usage: npx tsx test/live_mcp_call.ts <tool> [jsonArgs] [outDir]
 * Example: npx tsx test/live_mcp_call.ts control_tap '{"x":540,"y":1200}' test/out
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createMcpServer } from "../mcp.js";

const toolName = process.argv[2];
const argsJson = process.argv[3];
const outDir = process.argv[4] ?? "test/out";
if (!toolName) {
  console.error("usage: tsx test/live_mcp_call.ts <tool> [jsonArgs] [outDir]");
  process.exit(2);
}

const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
mkdirSync(outDir, { recursive: true });

const server = createMcpServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: "qoder-live-test", version: "1.0.0" }, { capabilities: {} });
await client.connect(clientTransport);

const result = await client.callTool({ name: toolName, arguments: args });
let imgIdx = 0;
let txtIdx = 0;
for (const item of (result.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>) ?? []) {
  if (item.type === "image" && item.data) {
    const bytes = Buffer.from(item.data, "base64");
    const ext = item.mimeType === "image/png" ? "png" : "bin";
    const file = path.join(outDir, `${toolName}-${++imgIdx}.${ext}`);
    writeFileSync(file, bytes);
    console.log(`IMAGE ${file} (${bytes.length} bytes)`);
  } else if (item.type === "text" && item.text !== undefined) {
    const file = path.join(outDir, `${toolName}-${++txtIdx}.txt`);
    writeFileSync(file, item.text);
    console.log(`TEXT ${file}`);
    console.log(item.text.length > 6000 ? `${item.text.slice(0, 6000)}\n…(truncated)` : item.text);
  }
}
const failed = result.isError === true;
if (failed) console.error("TOOL REPORTED ERROR");
await client.close();
process.exit(failed ? 1 : 0);
