// ScreenSync Cognitive Memory - versioned migration of the on-disk store.
//
// Replaces the old load-time gate, which accepted the file only if version === "1.1.0" AND a
// particular seeded playbook still had probes. Anything else was silently replaced with defaults
// and written straight over the real file, so a version bump or the pruning of one playbook wiped
// everything the system had learned.
//
// The rule here is the opposite: a file that parses is MIGRATED, never judged and reseeded.
//   - older or unversioned but memory-shaped   -> upgraded in place (changed = true)
//   - current version                           -> used as is, missing collections filled
//   - written by a NEWER build                  -> null: do not touch it, the caller quarantines it
//   - structurally wrong (a collection of the wrong type, not an object)  -> null, same treatment
//
// Returning null never means "overwrite me". It means "set me aside and start fresh".

import type { CognitiveMemoryData } from "./cognitive-memory.js";

export const CURRENT_MEMORY_VERSION = "1.1.0" as const;

type Raw = Record<string, unknown>;

/** One entry per schema step. A future format change adds "1.1.0": (d) => ({ ...d, ... }) here. */
const UPGRADES: Record<string, (d: Raw) => Raw> = {};

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function parseVersion(v: string): number[] | null {
  const parts = v.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  return parts.length >= 2 && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

/** >0 if a is newer than b, <0 if older, 0 if equal. Null if either is not a dotted number. */
function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const COLLECTIONS: Array<[key: "domains" | "playbooks" | "pitfalls", empty: () => unknown]> = [
  ["domains", () => ({})],
  ["playbooks", () => ({})],
  ["pitfalls", () => ({})],
];

export function migrateMemory(raw: unknown): { data: CognitiveMemoryData; changed: boolean } | null {
  if (!isObj(raw)) return null;

  const looksLikeMemory =
    isObj(raw.playbooks) || isObj(raw.domains) || isObj(raw.pitfalls) || Array.isArray(raw.episodes);
  let version: string;
  if (typeof raw.version === "string") {
    version = raw.version;
  } else if (looksLikeMemory) {
    version = "1.0.0"; // an unversioned file that is clearly a memory store is legacy, not garbage
  } else {
    return null;
  }

  const order = compareVersions(version, CURRENT_MEMORY_VERSION);
  if (order === null) return null; // "banana": not a version we can reason about
  if (order > 0) return null; // written by a newer build; never downgrade it in place

  let changed = false;
  let data: Raw = { ...raw };

  // Walk the explicit upgrade steps (none exist yet), then fall through to tolerant normalisation.
  let guard = 0;
  while (compareVersions(version, CURRENT_MEMORY_VERSION)! < 0 && UPGRADES[version] && guard < 16) {
    data = UPGRADES[version](data);
    version = String(data.version ?? CURRENT_MEMORY_VERSION);
    changed = true;
    guard += 1;
  }

  // Missing collections are filled. A collection of the WRONG TYPE is corruption: bail out so the
  // caller quarantines the bytes rather than this function quietly discarding them.
  for (const [key, empty] of COLLECTIONS) {
    if (data[key] === undefined) {
      data[key] = empty();
      changed = true;
    } else if (!isObj(data[key])) {
      return null;
    }
  }
  if (data.episodes === undefined) {
    data.episodes = [];
    changed = true;
  } else if (!Array.isArray(data.episodes)) {
    return null;
  }

  if (data.version !== CURRENT_MEMORY_VERSION) {
    data.version = CURRENT_MEMORY_VERSION;
    changed = true;
  }
  if (typeof data.updatedAt !== "string") {
    data.updatedAt = new Date().toISOString();
    changed = true;
  }

  return { data: data as unknown as CognitiveMemoryData, changed };
}
