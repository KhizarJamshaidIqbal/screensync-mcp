// Launches the ScreenSync MCP server for the MCP Inspector with explicit
// env (the Inspector's ad-hoc stdio launcher does not inherit the parent
// environment). Uses a non-default port so it can coexist with a running
// hub on :3000. Data dir is left at the default (mcp-server/data) so the
// Inspector, the hub, and any agent-spawned instance all share one store.
process.env.SCREEN_SYNC_PORT = process.env.SCREEN_SYNC_PORT || "3010";

const { startHttpHub } = await import("./dist/hub.js");
const { createMcpServer } = await import("./dist/mcp.js");
const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);

try {
  await startHttpHub();
} catch (error) {
  if (String(error).includes("EADDRINUSE")) {
    // A stale instance already holds the port — serve MCP only.
    console.error(JSON.stringify({ level: "INFO", message: "HTTP port busy — continuing in MCP-only mode" }));
  } else {
    throw error;
  }
}
const server = createMcpServer();
await server.connect(new StdioServerTransport());
