import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PROJECT_DIR, log } from "./config.js";

/**
 * In-app update channel.
 *
 * A sideloaded Android app cannot silently replace itself unless it is a device
 * owner, so "automatic update" means: the hub publishes the freshly built APK
 * plus its hash, each phone notices a newer versionCode and downloads it, and
 * the phone's own package installer asks the owner for the final tap. This
 * module is the single source of truth for what that latest build is, shared by
 * the HTTP hub and the stdio MCP server so both report identical values.
 */

/** Where a manifest's version came from: the APK's own build metadata is exact, pubspec.yaml is a best guess. */
export type VersionSource = "apk-metadata" | "pubspec";

export type AppManifest = {
  versionName: string;
  versionCode: number;
  sha256: string;
  sizeBytes: number;
  builtAt: string;
  versionSource: VersionSource;
};

/** The repository root; the hub lives in <root>/mcp-server. */
export function repoRoot(): string {
  return path.resolve(PROJECT_DIR, "..");
}

/**
 * File names `flutter build apk --release` leaves in build/app/outputs/flutter-apk, best first: the sideload
 * flavor, then the legacy un-flavored name older builds (and older phones' hub setups) produced.
 */
const APK_NAMES = ["app-sideload-release.apk", "app-release.apk"] as const;

/** Every APK the hub may serve, in preference order. All of them live in one directory. */
export function apkCandidates(root: string = repoRoot()): string[] {
  return APK_NAMES.map((name) => path.join(root, "build", "app", "outputs", "flutter-apk", name));
}

/** True for a file the release watcher should react to: an APK candidate or its .sha1 companion. */
export function isApkArtifactName(name: string): boolean {
  return APK_NAMES.some((n) => name.startsWith(n));
}

/** The APK to serve: the first candidate that exists, else the preferred path (a stable target for messages and the watcher). */
export function appApkPath(root: string = repoRoot()): string {
  const all = apkCandidates(root);
  return all.find((p) => existsSync(p)) ?? all[0]!;
}

/** Version from pubspec.yaml - the same source Gradle stamps into the APK, but only at the moment it is built. */
async function pubspecVersion(root: string): Promise<{ name: string; code: number }> {
  try {
    const raw = await readFile(path.join(root, "pubspec.yaml"), "utf8");
    const m = raw.match(/^version:\s*(\S+)\s*$/m);
    const value = m?.[1] ?? "";
    const [name, code] = value.split("+");
    return { name: name || "0.0.0", code: Number(code ?? 0) || 0 };
  } catch {
    return { name: "0.0.0", code: 0 };
  }
}

/** Gradle's per-variant build metadata: the flavored layout first, then the legacy un-flavored one. */
function metadataFiles(root: string): string[] {
  const dir = path.join(root, "build", "app", "outputs", "apk");
  return [
    path.join(dir, "sideload", "release", "output-metadata.json"),
    path.join(dir, "release", "output-metadata.json"),
  ];
}

/**
 * The version Gradle stamped into the APK itself (output-metadata.json, elements[0]). Metadata that names a
 * different output file than the one being served describes another build, so it is not used for this APK.
 */
async function apkMetadataVersion(root: string, apk: string): Promise<{ name: string; code: number } | null> {
  for (const file of metadataFiles(root)) {
    try {
      const json = JSON.parse(await readFile(file, "utf8")) as {
        elements?: Array<{ versionCode?: unknown; versionName?: unknown; outputFile?: unknown }>;
      };
      const el = json.elements?.[0];
      const code = Number(el?.versionCode);
      const name = typeof el?.versionName === "string" ? el.versionName.trim() : "";
      if (!Number.isInteger(code) || code <= 0 || !name) continue;
      if (typeof el?.outputFile === "string" && path.basename(el.outputFile) !== path.basename(apk)) continue;
      return { name, code };
    } catch {
      // Absent or unreadable: try the next layout, then pubspec.yaml.
    }
  }
  return null;
}

let warnedDisagreement = "";

/** The APK's own version when Gradle recorded it, else pubspec.yaml's. A disagreement between them is logged once. */
async function resolveVersion(root: string, apk: string): Promise<{ name: string; code: number; source: VersionSource }> {
  const pub = await pubspecVersion(root);
  const meta = await apkMetadataVersion(root, apk);
  if (!meta) return { ...pub, source: "pubspec" };
  if (pub.code > 0 && (pub.code !== meta.code || pub.name !== meta.name)) {
    const key = `${meta.name}+${meta.code}|${pub.name}+${pub.code}`;
    if (warnedDisagreement !== key) {
      warnedDisagreement = key;
      log("WARN", "APK build metadata and pubspec.yaml disagree on the app version; advertising the APK's own version", {
        apk: path.basename(apk),
        metadata: `${meta.name}+${meta.code}`,
        pubspec: `${pub.name}+${pub.code}`,
      });
    }
  }
  return { ...meta, source: "apk-metadata" };
}

// Only the hash is cached (against the APK's path, size and mtime): hashing a ~56 MB APK is the expensive part,
// while the version files are tiny and read on every call so a version bump is never advertised stale.
let shaCache: { key: string; sha256: string } | null = null;

/** Clears the cached hash after the APK is rebuilt. */
export function invalidateAppManifest(): void {
  shaCache = null;
}

/** Manifest for the current APK; the sha is cached against size+mtime. */
export async function appManifest(root: string = repoRoot()): Promise<AppManifest | null> {
  const apk = appApkPath(root);
  if (!existsSync(apk)) return null;
  const st = statSync(apk);
  const key = `${apk}:${st.size}:${st.mtimeMs}`;
  if (!shaCache || shaCache.key !== key) {
    shaCache = { key, sha256: createHash("sha256").update(await readFile(apk)).digest("hex") };
  }
  const { name, code, source } = await resolveVersion(root, apk);
  return {
    versionName: name,
    versionCode: code,
    sha256: shaCache.sha256,
    sizeBytes: st.size,
    builtAt: new Date(st.mtimeMs).toISOString(),
    versionSource: source,
  };
}
