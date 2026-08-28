import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ARCHIVE_DIR, FRAMES_DIR, INSPECTIONS_FILE, MAX_ARCHIVE, MAX_FRAMES, PATCHES_FILE, log } from "./config.js";
import { emitHubEvent } from "./events.js";

export const uploadSchema = z.object({
  imageDataUrl: z.string().max(25_000_000),
  filename: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(160),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "timestamp must be a valid ISO-8601 date",
  }),
  deviceModel: z.string().max(120).optional(),
  screenResolution: z
    .object({ width: z.number().int().nonnegative(), height: z.number().int().nonnegative() })
    .optional(),
});

export type FrameMetadata = {
  id: string;
  filename: string;
  filePath: string;
  mimeType: "image/png" | "image/jpeg";
  timestamp: string;
  receivedAt: string;
  deviceModel: string;
  screenResolution: { width: number; height: number };
  byteLength: number;
};

export type BugRegion = {
  id: string;
  label: string;
  x: number; y: number; w: number; h: number;
  severity: "error" | "warning" | "info";
};

export type InspectionResult = {
  bugs: BugRegion[];
  summary: string;
  inspectedAt: string;
};

export type PatchResult = {
  patch: string;
  description: string;
  filesTouched: string[];
  createdAt: string;
};

export async function ensureDataDirs() {
  await Promise.all([
    mkdir(FRAMES_DIR, { recursive: true }),
    mkdir(ARCHIVE_DIR, { recursive: true }),
  ]);
}

export async function listFrames(): Promise<FrameMetadata[]> {
  await ensureDataDirs();
  const entries = await readdir(FRAMES_DIR);
  const frames: FrameMetadata[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      frames.push(JSON.parse(await readFile(path.join(FRAMES_DIR, entry), "utf8")) as FrameMetadata);
    } catch (error) {
      log("WARN", "Skipping unreadable frame metadata", { entry, error: String(error) });
    }
  }
  return frames.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function latestFrame(): Promise<FrameMetadata | undefined> {
  return (await listFrames())[0];
}

export async function retainRecentFrames() {
  const frames = await listFrames();
  for (const frame of frames.slice(MAX_FRAMES)) {
    const results = await Promise.allSettled([
      rename(frame.filePath, path.join(ARCHIVE_DIR, `${frame.id}.png`)),
      rename(
        path.join(FRAMES_DIR, `${frame.id}.json`),
        path.join(ARCHIVE_DIR, `${frame.id}.json`),
      ),
    ]);
    if (results.some((result) => result.status === "rejected")) {
      log("WARN", "Could not archive an old frame", { id: frame.id });
    }
  }
}

/**
 * Prune the archive directory when it grows past MAX_ARCHIVE entries.
 *
 * BUG FIX: The archive directory previously grew indefinitely — PNG
 * screenshots are megabytes each and contain sensitive screen content.
 */
export async function pruneArchive() {
  try {
    const entries = (await readdir(ARCHIVE_DIR))
      .filter((name) => name.endsWith(".json"))
      .sort(); // UUIDs are not time-sortable, but deletion order doesn't matter here
    if (entries.length <= MAX_ARCHIVE) return;
    const stale = entries.slice(0, entries.length - MAX_ARCHIVE);
    for (const jsonName of stale) {
      const id = jsonName.replace(".json", "");
      await Promise.allSettled([
        unlink(path.join(ARCHIVE_DIR, jsonName)),
        unlink(path.join(ARCHIVE_DIR, `${id}.png`)),
      ]);
    }
    log("INFO", "Archive pruned", { removed: stale.length, remaining: entries.length - stale.length });
  } catch (error) {
    log("WARN", "Archive prune failed", { error: String(error) });
  }
}

export async function saveInspection(result: InspectionResult): Promise<void> {
  await writeFile(INSPECTIONS_FILE, JSON.stringify(result, null, 2));
  emitHubEvent("inspection");
}

export async function loadInspection(): Promise<InspectionResult | null> {
  try {
    return JSON.parse(await readFile(INSPECTIONS_FILE, "utf8")) as InspectionResult;
  } catch { return null; }
}

export async function savePatch(result: PatchResult): Promise<void> {
  await writeFile(PATCHES_FILE, JSON.stringify(result, null, 2));
  emitHubEvent("patch");
}

export async function loadPatch(): Promise<PatchResult | null> {
  try {
    return JSON.parse(await readFile(PATCHES_FILE, "utf8")) as PatchResult;
  } catch { return null; }
}

export function parseImageDimensions(bytes: Buffer): { width: number; height: number; mimeType: "image/png" | "image/jpeg" } {
  // PNG: check magic bytes 89504e47
  const pngSig = bytes.subarray(0, 8).toString("hex");
  if (pngSig === "89504e470d0a1a0a" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mimeType: "image/png" };
  }
  // JPEG: check FFD8 header, find SOF0/SOF2 marker for dimensions
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length - 9) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const segLen = bytes.readUInt16BE(offset + 2);
      // SOF0 (0xC0) or SOF2 (0xC2) contain height/width
      if (marker === 0xc0 || marker === 0xc2) {
        const height = bytes.readUInt16BE(offset + 5);
        const width = bytes.readUInt16BE(offset + 7);
        return { width, height, mimeType: "image/jpeg" };
      }
      offset += 2 + segLen;
    }
    // JPEG without SOF — return fallback dims
    return { width: 0, height: 0, mimeType: "image/jpeg" };
  }
  throw new Error("Only valid PNG or JPEG captures are accepted.");
}
