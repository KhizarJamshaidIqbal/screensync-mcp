// Host-level switch for the OS plane (os_mouse_click / os_type / os_hotkey).
//
// Those tools move the REAL mouse and type REAL keys anywhere on the machine, using
// PyAutoGUI. They run in the hub rather than the extension, so they are outside both the
// browser web-access toggle and the per-origin action grants. Two things can enable them:
// the environment variable (a host-level override for headless setups) or the persisted
// flag the desktop app writes. Neither is on by default.
import { readFileSync, writeFileSync } from "node:fs";
import { OS_CONTROL_FILE } from "./config.js";

export type OsControlSource = "env" | "desktop" | "off";

export function osControlSource(): OsControlSource {
  if (process.env.SCREENSYNC_ALLOW_OS_CONTROL === "1") return "env";
  try {
    return JSON.parse(readFileSync(OS_CONTROL_FILE, "utf8")).enabled === true ? "desktop" : "off";
  } catch {
    return "off";
  }
}

export function isOsControlEnabled(): boolean {
  return osControlSource() !== "off";
}

export function setOsControlEnabled(enabled: boolean): { enabled: boolean; source: OsControlSource } {
  writeFileSync(
    OS_CONTROL_FILE,
    JSON.stringify({ enabled: enabled === true, updatedAt: new Date().toISOString() }, null, 2),
  );
  return { enabled: enabled === true, source: osControlSource() };
}
