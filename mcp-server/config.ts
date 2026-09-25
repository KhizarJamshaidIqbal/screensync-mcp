import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR =
  path.basename(currentDir) === "dist" ? path.dirname(currentDir) : currentDir;

// The hub's release version, reported by /health. Read from package.json (shipped in the hub zip) so it
// can never go stale the way a hard-coded string did.
function readHubVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(PROJECT_DIR, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}
export const HUB_VERSION = readHubVersion();

export const DATA_DIR = process.env.SCREEN_SYNC_DATA_DIR || path.join(PROJECT_DIR, "data");
export const FRAMES_DIR = path.join(DATA_DIR, "frames");
export const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
export const OS_CONTROL_FILE = path.join(DATA_DIR, "os-control.json");
export const INSPECTIONS_FILE = path.join(DATA_DIR, "latest_inspection.json");
export const PATCHES_FILE = path.join(DATA_DIR, "latest_patch.json");

export const HTTP_PORT = Number(process.env.SCREEN_SYNC_PORT || 3000);
export const HTTP_HOST = process.env.SCREEN_SYNC_HOST || "0.0.0.0";
export const AUTH_TOKEN = process.env.SCREEN_SYNC_TOKEN || "screensync-local-dev";

export const MAX_FRAMES = 20;
export const MAX_ARCHIVE = 100; // prune archive when it exceeds this many frames
export const MAX_BODY_BYTES = "18mb";

/**
 * Pairing window for the unauthenticated /pair + /api/pair endpoints, in
 * minutes. The token is served while no device has paired yet OR within this
 * window after hub start; afterwards a restart (or 0 = always open) is needed.
 */
export const PAIR_WINDOW_MINUTES = Number(process.env.SCREEN_SYNC_PAIR_WINDOW_MINUTES ?? "10");

/** The extension aborts an SSE stream that stays silent this long (extension/lib/constants.js SSE_LIVENESS_MS). */
export const EXTENSION_SSE_LIVENESS_MS = 90_000;
/** The slowest keepalive allowed: half the extension's liveness window, so one late keepalive never kills a stream. */
export const SSE_KEEPALIVE_MAX_MS = EXTENSION_SSE_LIVENESS_MS / 2;

/**
 * Interval of the `: keepalive` comment on every SSE stream (/api/events), in ms, from SCREEN_SYNC_SSE_KEEPALIVE_MS
 * (default 30000). The extension treats a silent stream as dead after its liveness window (90s), so a slower
 * keepalive would make every idle stream reconnect every 90s: clamped to 100..SSE_KEEPALIVE_MAX_MS, with a warning.
 * The low floor exists for tests, which shorten it to see a keepalive within a second.
 */
export function sseKeepaliveMs(raw: string | undefined): number {
  const asked = Number(raw) || 30_000;
  const ms = Math.min(SSE_KEEPALIVE_MAX_MS, Math.max(100, asked));
  if (ms !== asked) log("WARN", "SCREEN_SYNC_SSE_KEEPALIVE_MS clamped", { asked, used: ms, max: SSE_KEEPALIVE_MAX_MS });
  return ms;
}
export const SSE_KEEPALIVE_MS = sseKeepaliveMs(process.env.SCREEN_SYNC_SSE_KEEPALIVE_MS);

/** Default AI agent label surfaced on the phone. Override via env SCREEN_SYNC_AGENT_NAME. */
export const agentName = process.env.SCREEN_SYNC_AGENT_NAME || "Claude";

export function log(level: string, message: string, context: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context }));
}

export function isAuthorized(header: string | undefined): boolean {
  return header === `Bearer ${AUTH_TOKEN}`;
}

/**
 * Whether THIS process's own attempt to become the HTTP hub (see index.ts) is known-good, and if not, why.
 *
 * Root cause this closes: when startHttpHub() loses an EADDRINUSE/EACCES race and the occupying service is
 * confirmed to NOT be a ScreenSync hub, index.ts used to log an error and continue anyway — every later
 * web_* (or control_*) tool call then round-tripped to whatever unrelated service holds the port, which
 * naturally answers with its own 404 (or worse) for /api/web/tool. The MCP layer had no way to tell "the hub never came
 * up" apart from "the hub is fine but this one call failed", so the agent just saw an opaque "Hub replied 404"
 * repeated forever. hub-web-call.ts checks this before every round trip and self-heals the moment a real hub
 * becomes reachable (see callHubWebTool), so this object is mutated in place, never reassigned.
 */
export const hubSelfCheck: { ok: boolean; detail: string | null; checkedAt: number } = {
  ok: true,
  detail: null,
  checkedAt: 0,
};
