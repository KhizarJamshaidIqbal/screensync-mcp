// Side-effect-only test helper: points the hub's data directory at a throwaway temp folder.
//
// It MUST be the first import of any in-process test that can reach cognitive state. ES modules
// evaluate their imports in order, so this runs before config.ts reads SCREEN_SYNC_DATA_DIR.
//
// Why it exists: none of these tests used to set that variable, so every run of the suite wrote its
// `test-site-<epoch>.com` fixtures into the developer's REAL data/cognitive-memory.json. 26 of the 27
// pitfall domains in a real store turned out to be that junk, and once the cognitive engines persist
// (Phase 1) the pollution would have spread to every engine's state.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ISOLATED_DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-test-data-"));
process.env.SCREEN_SYNC_DATA_DIR = ISOLATED_DATA_DIR;

process.on("exit", () => {
  try {
    rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best effort: it lives in the OS temp dir either way */
  }
});
