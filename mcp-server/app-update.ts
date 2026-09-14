import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PROJECT_DIR } from "./config.js";

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
export type AppManifest = {
  versionName: string;
  versionCode: number;
  sha256: string;
  sizeBytes: number;
  builtAt: string;
};

/** The release APK produced by `flutter build apk --release`. */
export function appApkPath(): string {
  return path.resolve(
    PROJECT_DIR, "..", "build", "app", "outputs", "flutter-apk", "app-release.apk"
  );
}

/** Version from pubspec.yaml - the same source Gradle stamps into the APK. */
async function pubspecVersion(): Promise<{ name: string; code: number }> {
  try {
    const raw = await readFile(path.resolve(PROJECT_DIR, "..", "pubspec.yaml"), "utf8");
    const m = raw.match(/^version:\s*(\S+)\s*$/m);
    const value = m?.[1] ?? "";
    const [name, code] = value.split("+");
    return { name: name || "0.0.0", code: Number(code ?? 0) || 0 };
  } catch {
    return { name: "0.0.0", code: 0 };
  }
}

let cache: { key: string; manifest: AppManifest } | null = null;

/** Clears the cached hash after the APK is rebuilt. */
export function invalidateAppManifest(): void {
  cache = null;
}

/** Manifest for the current APK; the sha is cached against size+mtime. */
export async function appManifest(): Promise<AppManifest | null> {
  const apk = appApkPath();
  if (!existsSync(apk)) return null;
  const st = statSync(apk);
  const key = `${st.size}:${st.mtimeMs}`;
  if (cache && cache.key === key) return cache.manifest;
  const sha256 = createHash("sha256").update(await readFile(apk)).digest("hex");
  const { name, code } = await pubspecVersion();
  const manifest: AppManifest = {
    versionName: name,
    versionCode: code,
    sha256,
    sizeBytes: st.size,
    builtAt: new Date(st.mtimeMs).toISOString(),
  };
  cache = { key, manifest };
  return manifest;
}
