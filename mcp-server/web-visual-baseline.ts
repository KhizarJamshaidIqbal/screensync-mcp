// ScreenSync Web Bridge - web_visual_baseline: Playwright toHaveScreenshot parity (save / compare / list / clear
// baselines under DATA_DIR/baselines). Split out of web.ts, which is over the repo's 500-line limit; behaviour is
// unchanged.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { DATA_DIR } from "./config.js";
import type { DispatchDecision } from "./profile-registry.js";
import { sendRouteRefusal } from "./web-multi-dispatch.js";
import type { WebRelay } from "./web-flows.js";

type Deps = { resolveDispatch: (args: Record<string, unknown>) => DispatchDecision; request: WebRelay };

/** Handles one web_visual_baseline call; always sends a response. */
export async function handleVisualBaseline(args: Record<string, unknown>, res: Response, { resolveDispatch, request }: Deps): Promise<void> {
  const action = String(args.action || "save");
  const BASELINES_DIR = path.join(DATA_DIR, "baselines");

  if (action === "list") {
    const files = existsSync(BASELINES_DIR) ? readdirSync(BASELINES_DIR).filter((f) => f.endsWith(".json")) : [];
    const items = files.map((f) => {
      try { return JSON.parse(readFileSync(path.join(BASELINES_DIR, f), "utf8")); } catch { return { name: f, corrupted: true }; }
    });
    res.json({ success: true, ok: true, data: { baselines: items, count: items.length } });
    return;
  }

  const name = String(args.name || "").trim().replace(/[^a-z0-9_-]+/gi, "_");
  if (!name) {
    res.status(400).json({ success: false, ok: false, error: "web_visual_baseline requires name for " + action + "." });
    return;
  }
  const basePng = path.join(BASELINES_DIR, name + ".png");
  const baseMeta = path.join(BASELINES_DIR, name + ".json");
  if (action === "clear") {
    if (existsSync(basePng)) unlinkSync(basePng);
    if (existsSync(baseMeta)) unlinkSync(baseMeta);
    res.json({ success: true, ok: true, data: { cleared: name } });
    return;
  }
  if (action !== "save" && action !== "compare") {
    res.status(400).json({ success: false, ok: false, error: "Unknown web_visual_baseline action: " + action + ". Supported: save, compare, list, clear." });
    return;
  }

  // Capture the CURRENT viewport as PNG via the extension. The browser is routed ONCE, like any call, and that
  // same decision takes the screenshot and runs the pixel diff below.
  const route = resolveDispatch(args);
  if (!route.ok) { sendRouteRefusal(res, route); return; }
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 45_000, 5_000), 60_000);
  const shot = await request("web_screenshot", { format: "png", ...(args.tabId ? { tabId: args.tabId } : {}) }, timeoutMs, undefined, route);
  const shotData = shot.data as { imageDataUrl?: string; url?: string; title?: string } | undefined;
  const dataUrl = shotData?.imageDataUrl ?? "";
  if (!shot.ok || !dataUrl.startsWith("data:image/")) {
    res.json({ success: true, ok: false, data: { error: "Could not capture a PNG screenshot: " + (shot.error ?? "no image") } });
    return;
  }
  const b64png = dataUrl.split(",", 2)[1];

  if (action === "save") {
    mkdirSync(BASELINES_DIR, { recursive: true });
    writeFileSync(basePng, Buffer.from(b64png, "base64"));
    const meta = { name, savedAt: new Date().toISOString(), url: shotData?.url ?? null, title: shotData?.title ?? null, bytes: b64png.length };
    writeFileSync(baseMeta, JSON.stringify(meta, null, 2));
    res.json({ success: true, ok: true, data: { saved: true, name, file: basePng, url: meta.url } });
    return;
  }

  // compare
  const rawThreshold = Number(args.threshold);
  const threshold = Number.isFinite(rawThreshold) ? Math.min(Math.max(rawThreshold, 0), 1) : 0.05;
  if (!existsSync(basePng)) {
    // toHaveScreenshot parity: first run creates the baseline.
    mkdirSync(BASELINES_DIR, { recursive: true });
    writeFileSync(basePng, Buffer.from(b64png, "base64"));
    writeFileSync(baseMeta, JSON.stringify({ name, savedAt: new Date().toISOString(), url: shotData?.url ?? null, title: shotData?.title ?? null, bytes: b64png.length, autoCreated: true }, null, 2));
    res.json({ success: true, ok: true, data: { compared: false, created: true, name, message: "No baseline existed — the current screenshot was saved as the new baseline. Run compare again." } });
    return;
  }
  const baselineDataUrl = "data:image/png;base64," + readFileSync(basePng).toString("base64");
  const diff = await request("web_pixel_diff", { imageA: baselineDataUrl, imageB: dataUrl, threshold }, timeoutMs, undefined, route);
  const dd = diff.data as { identical?: boolean; diffPercent?: number; diffImageDataUrl?: string } | undefined;
  if (!diff.ok || !dd) {
    res.json({ success: true, ok: false, data: { error: "pixel diff failed: " + (diff.error ?? "no data") } });
    return;
  }
  const passed = (dd.diffPercent ?? 100) <= threshold * 100;
  let updatedBaseline = false;
  if (args.updateBaseline === true && !passed) {
    writeFileSync(basePng, Buffer.from(b64png, "base64"));
    writeFileSync(baseMeta, JSON.stringify({ name, savedAt: new Date().toISOString(), url: shotData?.url ?? null, title: shotData?.title ?? null, bytes: b64png.length, autoUpdated: true }, null, 2));
    updatedBaseline = true;
  }
  const { diffImageDataUrl: heat, ...diffSummary } = dd;
  res.json({
    success: true, ok: true,
    data: { compared: true, name, passed, threshold, ...diffSummary, heatmap: heat, updatedBaseline },
  });
}
