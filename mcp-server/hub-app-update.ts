import { existsSync } from "node:fs";
import type { Express, Request } from "express";
import { AUTH_TOKEN, isAuthorized, log } from "./config.js";
import { appApkPath, appManifest } from "./app-update.js";
import { isLoopbackReq, primaryBaseUrl } from "./hub-pairing.js";

// The in-app update channel's HTTP side: /api/app/latest (what is the newest build) and /apk (the build itself).
// Mounted by hub.ts via mountAppUpdateRoutes(). The manifest itself is app-update.ts; this file only speaks HTTP.

/** A Host header worth echoing into a URL: a hostname or IPv4 or bracketed IPv6 literal, with an optional port. */
const HOST_RE = /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * The base URL the caller itself used to reach this hub (its Host header), so the download link works from the
 * phone's own vantage point. primaryBaseUrl() is only a guess (the first non-internal IPv4, which can be a WSL,
 * Hyper-V or VPN adapter the phone cannot reach), so it is the fallback when the header is missing or malformed.
 */
export function requestBaseUrl(req: Request): string {
  const host = req.get("host") ?? "";
  return HOST_RE.test(host) ? `${req.protocol}://${host}` : primaryBaseUrl();
}

export type AppUpdateRouteOptions = {
  /** Repository root to look for build outputs in; defaults to this hub's own repository. For tests. */
  root?: string;
};

export function mountAppUpdateRoutes(app: Express, opts: AppUpdateRouteOptions = {}): void {
  app.get("/api/app/latest", async (req, res) => {
    if (!isAuthorized(req.header("authorization")) && !isLoopbackReq(req)) {
      res.status(401).json({ success: false, error: "Invalid ScreenSync pairing token." });
      return;
    }
    const manifest = await appManifest(opts.root);
    if (!manifest) {
      res.status(404).json({ success: false, error: "No release APK built yet. Run: flutter build apk --release" });
      return;
    }
    const raw = Number(req.query.versionCode);
    const installed = Number.isFinite(raw) ? raw : null;
    // `url` (and its alias `downloadUrl`) is what phones that predate the Bearer /apk read: the token rides in the
    // query string. A current phone builds "<its configured hub URL>/apk" from `apkPath` and sends the token as a header.
    const url = `${requestBaseUrl(req)}/apk?token=${encodeURIComponent(AUTH_TOKEN)}`;
    res.json({
      success: true,
      ...manifest,
      installedVersionCode: installed,
      updateAvailable: installed === null ? null : manifest.versionCode > installed,
      url,
      downloadUrl: url,
      apkPath: "/apk",
    });
  });

  // Serves the APK itself so a phone can fetch the update over the LAN. The token comes as a Bearer header (what a
  // current phone sends, keeping it out of URLs and logs) or as ?token= (a browser download and older phones carry
  // no headers). The path is fixed and no user input reaches it.
  app.get("/apk", async (req, res) => {
    const viaHeader = isAuthorized(req.header("authorization"));
    if (!viaHeader && !isAuthorized(`Bearer ${String(req.query.token ?? "")}`)) {
      res.status(403).type("text/plain").send("Invalid ScreenSync pairing token.");
      return;
    }
    const apk = appApkPath(opts.root);
    if (!existsSync(apk)) {
      res.status(404).type("text/plain").send("No APK built yet. Run: flutter build apk --release");
      return;
    }
    log("INFO", "APK download", { ip: req.socket?.remoteAddress || req.ip || "", auth: viaHeader ? "bearer" : "query" });
    res.download(apk, "screensync.apk");
  });
}
