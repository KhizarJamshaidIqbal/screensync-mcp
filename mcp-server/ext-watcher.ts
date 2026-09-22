// Zero-Click HMR: watches the unpacked extension folder and reports REAL edits only.
//
// fs.watch on Windows also fires for last-access-time updates, and NTFS writes one the first time a file is
// read in an hour. Chrome reading an extension page's stylesheet was therefore enough to hot-reload the whole
// extension, which closed the page that had just opened (the 1.12.0 access-request window lost its request
// that way) and dropped anything held in the service worker's memory. An event now counts only when the
// file's size or modification time moved, or the file appeared or disappeared.

import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

const WATCHED = /\.(js|html|css|json)$/i;
const skipped = (file: string) => file.includes(".git") || file.includes("node_modules") || !WATCHED.test(file);

/** `mtime:size`, or "missing" once the file is gone. */
function signature(file: string): string {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "missing";
  }
}

/**
 * Calls `onChange(relativeFile)` once per burst of real edits under `dir` (debounced). Returns the watcher,
 * whose close() also cancels a pending call, or throws like fs.watch when the folder cannot be watched.
 */
export function watchExtensionDir(dir: string, onChange: (file: string) => void, debounceMs = 300): FSWatcher {
  const seen = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const rel = path.normalize(entry);
    if (!skipped(rel)) seen.set(rel, signature(path.join(dir, rel)));
  }
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = path.normalize(String(filename));
    if (skipped(rel)) return;
    const now = signature(path.join(dir, rel));
    if (seen.get(rel) === now) return; // read, not written: an access-time or attribute event
    seen.set(rel, now);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => onChange(rel), debounceMs);
  });
  const close = watcher.close.bind(watcher);
  watcher.close = () => {
    if (timer) clearTimeout(timer);
    close();
  };
  return watcher;
}
