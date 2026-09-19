// ScreenSync Cognitive State - crash-safe JSON I/O primitives.
//
// The cognitive layer used to persist with a bare writeFileSync over the live file and to
// "recover" from a file it did not like by writing defaults straight over it. Either one can
// destroy everything the system has learned: a crash mid-write leaves a truncated file, and a
// schema check that fails reseeds and overwrites. These helpers make both impossible:
//
//   atomicWriteJson  write to a temp file, fsync it, rename over the target. A reader (or a crash)
//                    sees either the whole old file or the whole new one, never half of each.
//   readJsonSafe     never throws; says whether the file is missing, fine, or unreadable.
//   quarantine       moves an unreadable file aside instead of deleting or overwriting it, so a
//                    human can still recover it.
//
// Phase 1 of the cognitive spine builds the per-engine persistence registry on top of these.

import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { log } from "./config.js";

/** Windows refuses a rename over a file another process (antivirus, indexer) briefly holds. */
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 5;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (attempt >= RENAME_ATTEMPTS || !RETRYABLE.has(code)) throw e;
      sleepSync(10 * 2 ** (attempt - 1));
    }
  }
}

/**
 * Writes `value` as pretty JSON to `file` atomically. The temp file lives beside the target so the
 * rename never crosses a filesystem. On any failure the temp file is removed and the error thrown,
 * leaving the previous contents of `file` exactly as they were.
 */
export function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(value, null, 2);
  let fd: number | null = null;
  try {
    fd = openSync(tmp, "w");
    writeSync(fd, payload);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameWithRetry(tmp, file);
  } catch (e) {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
    try { unlinkSync(tmp); } catch { /* never created, or already gone */ }
    throw e;
  }
}

export type ReadResult =
  | { status: "missing" }
  | { status: "ok"; value: unknown }
  | { status: "corrupt"; error: string };

/** Reads and parses a JSON file. Never throws: the caller decides what "corrupt" means. */
export function readJsonSafe(file: string): ReadResult {
  if (!existsSync(file)) return { status: "missing" };
  try {
    return { status: "ok", value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (e) {
    return { status: "corrupt", error: String((e as Error).message ?? e) };
  }
}

/**
 * Moves an unreadable or unrecognised file aside as `<file>.corrupt-<timestamp>` and returns the new
 * path (or null if it could not). Falls back to a copy, so the original bytes are never the only casualty.
 */
export function quarantine(file: string, reason: string): string | null {
  if (!existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.corrupt-${stamp}`;
  try {
    renameWithRetry(file, dest);
  } catch {
    try {
      copyFileSync(file, dest);
    } catch (e) {
      log("ERROR", "Could not quarantine an unreadable cognitive file", { file, reason, error: String(e) });
      return null;
    }
  }
  log("WARN", "Quarantined an unreadable cognitive file instead of overwriting it", { file, quarantinedTo: dest, reason });
  return dest;
}
