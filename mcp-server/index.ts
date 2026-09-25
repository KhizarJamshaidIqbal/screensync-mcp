#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { agentName, HTTP_PORT, hubSelfCheck, log } from "./config.js";
import { emitHubEvent } from "./events.js";
import { startHttpHub } from "./hub.js";
import { createMcpServer } from "./mcp.js";

// Structured logging for failures Node would otherwise print unformatted (or, for an uncaught exception,
// silently take the process — and this port — down with it). This is exactly the kind of silent failure that
// used to precede a "Hub replied 404": the hub process died mid-session with nothing in hub.log to explain it,
// freed the port, and whatever else grabbed it (another local dev server, most commonly on 3000) answered every
// later /api/web/tool call with its own unrelated 404. Logging first means the next hub.log actually says why.
process.on("uncaughtException", (error) => {
  log("FATAL", "Uncaught exception — hub process exiting", { error: String(error), stack: (error as Error)?.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log("ERROR", "Unhandled promise rejection (process continues)", { reason: String(reason) });
});

/** Probes whether a real ScreenSync hub answers at this port, retrying briefly to ride out a sibling
 * MCP process's own startHttpHub() still being mid-listen() (harmless multi-process startup race — see
 * the comment on hub-web-call.ts's callHubWebTool for why HTTP, not just in-process calls, is how tool
 * calls always reach whichever process actually won the port). */
async function probeForRealHub(attempts = 3, delayMs = 700): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const probeRes = await fetch(`http://127.0.0.1:${HTTP_PORT}/health`, { signal: AbortSignal.timeout(1500) });
      if (probeRes.ok) {
        const body = (await probeRes.json().catch(() => null)) as Record<string, unknown> | null;
        if (body?.service === "screensync-hub") return true;
      }
    } catch {
      // not up yet, or something un-probeable is there — fall through to retry/give up below
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main() {
  let hub: Awaited<ReturnType<typeof startHttpHub>> | null = null;
  try {
    hub = await startHttpHub();
    hubSelfCheck.ok = true;
    hubSelfCheck.detail = null;
  } catch (error) {
    if (String(error).includes("EADDRINUSE") || String(error).includes("EACCES")) {
      // Check whether an existing ScreenSync Hub is running or another application occupies the port.
      const existingHubFound = await probeForRealHub();

      if (existingHubFound) {
        log("INFO", `Existing ScreenSync Hub detected on port ${HTTP_PORT} — continuing in MCP-only mode`);
        hubSelfCheck.ok = true;
        hubSelfCheck.detail = null;
      } else {
        const platformHint = process.platform === "win32"
          ? `start-hub.bat 3001\n    (To find the conflicting process: netstat -ano | findstr :${HTTP_PORT})`
          : `export SCREEN_SYNC_PORT=3001 && ./start-hub.sh 3001\n    (To find the conflicting process: lsof -i :${HTTP_PORT})`;
        log("ERROR", `Port ${HTTP_PORT} is occupied by another service (not ScreenSync Hub)!`);
        console.error(`\n[ERROR] Port ${HTTP_PORT} is occupied by an unrelated service.\nRemediation:\n  ${platformHint}\n`);
        // Recorded (not thrown) so every web_*/control_* tool call fails fast with this exact diagnosis instead
        // of round-tripping to the wrong service and reporting its accidental "Hub replied 404" — see hub-web-call.ts.
        hubSelfCheck.ok = false;
        hubSelfCheck.checkedAt = Date.now();
        hubSelfCheck.detail =
          `Port ${HTTP_PORT} is occupied by a service that is not the ScreenSync hub, so this MCP process never became (or found) the hub. ` +
          `web_*/control_* tool calls cannot work until this is fixed. Remediation: ${platformHint.replace(/\n\s+/g, " ")}`;
      }
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
