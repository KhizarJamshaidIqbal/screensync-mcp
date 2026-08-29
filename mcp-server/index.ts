#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { agentName, log } from "./config.js";
import { emitHubEvent } from "./events.js";
import { startHttpHub } from "./hub.js";
import { createMcpServer } from "./mcp.js";

async function main() {
  let hub: Awaited<ReturnType<typeof startHttpHub>> | null = null;
  try {
    hub = await startHttpHub();
  } catch (error) {
    if (String(error).includes("EADDRINUSE")) {
      // Another hub instance already serves the shared data dir (typical
      // when an agent spawns this stdio server while npm start is running).
      // Continue in MCP-only mode instead of crashing.
      log("INFO", "HTTP port busy — continuing in MCP-only mode");
    } else {
      throw error;
    }
  }
  const shutdown = async () => {
    try { await hub?.stop(); } catch { /* best-effort teardown */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Broadcast the connected AI agent identity so the phone can show it
  // instead of a static "Your AI" placeholder.
  emitHubEvent("agent_connect", undefined, undefined, agentName);
  log("INFO", "Agent identity emitted", { agentName });

  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  log("INFO", "ScreenSync MCP stdio server connected");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    log("FATAL", "ScreenSync MCP failed", { error: String(error) });
    process.exit(1);
  });
}
