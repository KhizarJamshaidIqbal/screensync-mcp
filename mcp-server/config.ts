import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR =
  path.basename(currentDir) === "dist" ? path.dirname(currentDir) : currentDir;

export const DATA_DIR = process.env.SCREEN_SYNC_DATA_DIR || path.join(PROJECT_DIR, "data");
export const FRAMES_DIR = path.join(DATA_DIR, "frames");
export const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
export const INSPECTIONS_FILE = path.join(DATA_DIR, "latest_inspection.json");
export const PATCHES_FILE = path.join(DATA_DIR, "latest_patch.json");

export const HTTP_PORT = Number(process.env.SCREEN_SYNC_PORT || 3000);
export const HTTP_HOST = process.env.SCREEN_SYNC_HOST || "0.0.0.0";
export const AUTH_TOKEN = process.env.SCREEN_SYNC_TOKEN || "screensync-local-dev";

export const MAX_FRAMES = 20;
export const MAX_ARCHIVE = 100; // prune archive when it exceeds this many frames
export const MAX_BODY_BYTES = "18mb";

export function log(level: string, message: string, context: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context }));
}

export function isAuthorized(header: string | undefined): boolean {
  return header === `Bearer ${AUTH_TOKEN}`;
}
