import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { appApkPath, appManifest, invalidateAppManifest } from "./app-update.js";
import { PROJECT_DIR, log } from "./config.js";
import { watchExtensionDir } from "./ext-watcher.js";

// File watchers the hub owns: Zero-Click HMR on the unpacked extension and the release APK. Both are started
// with the hub and closed with it; hub.stop() used to leave the APK watcher (and its debounce timer) running.

export type HubWatchers = {
  /** Closes every watcher and cancels a pending APK re-hash. Idempotent. */
  close: () => void;
  /** Which watchers are running, for tests and diagnostics. */
  active: () => { extension: boolean; apk: boolean };
};

export type HubWatcherDirs = { extensionDir?: string; apkDir?: string };

export function startHubWatchers(broadcast: (payload: object) => void, dirs: HubWatcherDirs = {}): HubWatchers {
  let extWatcher: FSWatcher | null = null;
  let apkWatcher: FSWatcher | null = null;
  let apkBroadcastTimer: NodeJS.Timeout | null = null;
  let lastBroadcastSha = "";
  let closed = false;

  // ── Zero-Click HMR: File watcher on extension/ directory ──
  const extDir = dirs.extensionDir ?? path.resolve(PROJECT_DIR, "..", "extension");
  if (existsSync(extDir)) {
    try {
      // Only real edits reload: see ext-watcher.ts for why a raw fs.watch event is not enough on Windows.
      extWatcher = watchExtensionDir(extDir, (file) => {
        log("INFO", "Extension file changed, broadcasting dev_hot_reload", { file });
        broadcast({ type: "dev_hot_reload", file });
      });
      log("INFO", "Zero-Click HMR file watcher active", { dir: extDir });
    } catch (err) {
      log("WARN", "Zero-Click HMR file watcher failed to start", { error: String(err) });
    }
  }

  // ---- APK watch: a rebuilt app-release.apk IS the release event ----
  // The hook the whole update flow hangs off. Build (or CI) writes the APK, the
  // hub notices within a second, re-hashes it and pushes app_update to every
  // phone holding an SSE connection - the same trick the extension already used
  // for its zero-click reload.
  const apkDir = dirs.apkDir ?? path.dirname(appApkPath());
  if (existsSync(apkDir)) {
    try {
      apkWatcher = watch(apkDir, (_event, filename) => {
        if (closed || !filename || !String(filename).startsWith("app-release.apk")) return;
        // Gradle rewrites the APK several times per build, so debounce and then
        // compare the hash: one release must produce exactly one event.
        if (apkBroadcastTimer) clearTimeout(apkBroadcastTimer);
        apkBroadcastTimer = setTimeout(() => {
          apkBroadcastTimer = null;
          invalidateAppManifest();
          void appManifest().then((manifest) => {
            if (closed || !manifest || manifest.sha256 === lastBroadcastSha) return;
            lastBroadcastSha = manifest.sha256;
            log("INFO", "App release changed, broadcasting app_update", {
              versionName: manifest.versionName,
              versionCode: manifest.versionCode,
            });
            broadcast({ type: "app_update", ...manifest });
          });
        }, 1000);
      });
      log("INFO", "APK watcher active", { dir: apkDir });
    } catch (err) {
      log("WARN", "APK watcher failed to start", { error: String(err) });
    }
  }

  return {
    close: () => {
      closed = true;
      if (apkBroadcastTimer) clearTimeout(apkBroadcastTimer);
      apkBroadcastTimer = null;
      for (const w of [extWatcher, apkWatcher]) {
        try { w?.close(); } catch { /* already closed */ }
      }
      extWatcher = null;
      apkWatcher = null;
    },
    active: () => ({ extension: extWatcher !== null, apk: apkWatcher !== null }),
  };
}
