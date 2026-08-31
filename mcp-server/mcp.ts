import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  buildCatalog,
  getSkillsContent,
  promptDefinitions,
  resourceDefinitions,
  SERVER_NAME,
  SERVER_VERSION,
  toolDefinitions,
} from "./catalog.js";
import { AUTH_TOKEN, HTTP_PORT, log } from "./config.js";
import { emitHubEvent } from "./events.js";
import { promptMessage } from "./prompts.js";
import {
  latestFrame,
  listFrames,
  saveInspection,
  savePatch,
  type BugRegion,
  type InspectionResult,
  type PatchResult,
} from "./storage.js";
import {
  compareFrames,
  controlDeviceInfo,
  getLogcat,
  launchApp,
  longPress,
  openUrl,
  pressKey,
  recordScreen,
  screenshotNow,
  scroll,
  swipe,
  swipeUntil,
  tap,
  tapText,
  typeText,
  uiHierarchy,
} from "./control.js";

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

/**
 * Round-trips a web_* tool through the HTTP hub, which relays it over SSE to
 * the ScreenSync browser extension. Goes through HTTP (not in-process calls)
 * so it also works when this stdio server runs MCP-only beside another hub
 * instance.
 */
async function callHubWebTool(tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `http://127.0.0.1:${HTTP_PORT}/api/web/tool`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify({ tool, args, timeoutMs: 45_000 }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return { ok: false, error: `ScreenSync hub is not reachable at ${url} (${String(error)}). Start the hub with 'npm start' and make sure the browser extension is connected.` };
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: unknown; error?: string };
  return { ok: body.ok === true, data: body.data, error: body.error ?? (res.ok ? undefined : `Hub replied ${res.status}`) };
}

export function createMcpServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // B3: surface every tool call on the phone's AI activity timeline.
    // (web_* tools emit their own timeline event after the bridge round trip.)
    if (!request.params.name.startsWith("web_")) {
      emitHubEvent("tool", request.params.name, true);
    }
    try {
      // ── Web bridge (browser access for AI agents) ──
      if (request.params.name.startsWith("web_")) {
        const r = await callHubWebTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
        if (!r.ok) return textResult({ success: false, error: r.error }, true);
        if (request.params.name === "web_screenshot") {
          const d = r.data as { imageDataUrl?: string; url?: string; title?: string } | undefined;
          const dataUrl = d?.imageDataUrl ?? "";
          const [meta = "image/jpeg", base64 = ""] = dataUrl.includes(",") ? [dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl.split(",", 2)[1]] : [];
          return {
            content: [
              { type: "image" as const, data: base64, mimeType: meta || "image/jpeg" },
              { type: "text" as const, text: JSON.stringify({ url: d?.url ?? null, title: d?.title ?? null }, null, 2) },
            ],
          };
        }
        if (request.params.name === "web_watch") {
          // Realtime watch: hand every changed frame to the AI as an image, in
          // capture order, so it can narrate the sequence like a video.
          const d = r.data as { frames?: Array<{ index: number; ts: number; imageDataUrl: string }>; [k: string]: unknown } | undefined;
          const frames = d?.frames ?? [];
          const content: Array<{ type: "image"; data: string; mimeType: string } | { type: "text"; text: string }> = [];
          for (const f of frames.slice(0, 12)) {
            const du = f.imageDataUrl || "";
            const [mime = "image/jpeg", b64 = ""] = du.includes(",") ? [du.slice(5, du.indexOf(";")), du.split(",", 2)[1]] : [];
            content.push({ type: "image", data: b64, mimeType: mime || "image/jpeg" });
          }
          const { frames: _omit, ...summary } = d ?? {};
          content.push({
            type: "text",
            text: JSON.stringify({ framesReturned: Math.min(frames.length, 12), frameTimestampsMs: frames.map((f) => f.ts), ...summary }, null, 2),
          });
          return { content };
        }
        return textResult({ success: true, ...((r.data ?? {}) as object) });
      }
      if (request.params.name === "get_mcp_catalog") {
        return textResult(buildCatalog());
      }
      if (request.params.name === "get_skills") {
        return textResult(getSkillsContent());
      }
      if (request.params.name === "get_recent_screenshots") {
        const args = request.params.arguments as { limit?: number; includeMetadata?: boolean } | undefined;
        const limit = typeof args?.limit === "number" ? Math.max(1, Math.min(6, Math.trunc(args.limit))) : 2;
        const includeMetadata = args?.includeMetadata !== false;
        const frames = (await listFrames()).slice(0, limit);
        if (frames.length === 0) {
          return textResult({ success: false, error: "No screenshots yet. Tap the floating bubble on the phone." }, true);
        }
        const content: Array<{ type: "image"; data: string; mimeType: string } | { type: "text"; text: string }> = [];
        for (const f of frames) {
          const bytes = await readFile(f.filePath);
          content.push({ type: "image", data: bytes.toString("base64"), mimeType: f.mimeType });
        }
        if (includeMetadata) {
          content.push({
            type: "text",
            text: JSON.stringify(
              frames.map((f) => ({ id: f.id, timestamp: f.receivedAt, resolution: f.screenResolution, size: f.byteLength })),
              null,
              2,
            ),
          });
        }
        return { content };
      }
      if (request.params.name === "get_latest_screenshot") {
        const frame = await latestFrame();
        if (!frame) return textResult({ success: false, error: "No screenshot available. Start capture and tap the floating bubble." }, true);
        const bytes = await readFile(frame.filePath);
        const includeMetadata = request.params.arguments?.includeMetadata !== false;
        return {
          content: [
            { type: "image" as const, data: bytes.toString("base64"), mimeType: frame.mimeType },
            ...(includeMetadata ? [{ type: "text" as const, text: JSON.stringify(frame, null, 2) }] : []),
          ],
        };
      }
      if (request.params.name === "list_recent_screens") {
        const limitValue = request.params.arguments?.limit;
        const limit = typeof limitValue === "number" ? Math.max(1, Math.min(20, Math.trunc(limitValue))) : 5;
        return textResult((await listFrames()).slice(0, limit));
      }
      if (request.params.name === "get_device_status") {
        const frame = await latestFrame();
        const ageMs = frame ? Date.now() - Date.parse(frame.receivedAt) : null;
        return textResult({
          connected: frame !== undefined,
          transport: "local-http",
          lastFrameAt: frame?.receivedAt ?? null,
          lastFrameAgeMs: ageMs,
          stale: ageMs === null || ageMs > 60_000,
          deviceModel: frame?.deviceModel ?? null,
          retainedFrames: (await listFrames()).length,
        });
      }
      if (request.params.name === "publish_inspection") {
        const args = request.params.arguments as { bugs: BugRegion[]; summary: string } | undefined;
        if (!args?.bugs || !args?.summary) {
          return textResult({ success: false, error: "bugs and summary are required." }, true);
        }
        const result: InspectionResult = {
          bugs: args.bugs,
          summary: args.summary,
          inspectedAt: new Date().toISOString(),
        };
        await saveInspection(result);
        log("INFO", "Inspection published", { bugCount: args.bugs.length });
        return textResult({ success: true, bugCount: args.bugs.length, inspectedAt: result.inspectedAt });
      }
      if (request.params.name === "publish_patch") {
        const args = request.params.arguments as { patch: string; description: string; filesTouched?: string[] } | undefined;
        if (!args?.patch || !args?.description) {
          return textResult({ success: false, error: "patch and description are required." }, true);
        }
        const result: PatchResult = {
          patch: args.patch,
          description: args.description,
          filesTouched: args.filesTouched ?? [],
          createdAt: new Date().toISOString(),
        };
        await savePatch(result);
        log("INFO", "Patch published", { bytes: args.patch.length, files: result.filesTouched });
        return textResult({ success: true, createdAt: result.createdAt });
      }
      // ── Remote control (gesture / input) ──
      if (request.params.name === "control_status") {
        return textResult(await controlDeviceInfo());
      }
      if (request.params.name === "control_screenshot") {
        const shot = await screenshotNow();
        return { content: [{ type: "image" as const, data: shot.base64, mimeType: shot.mimeType }] };
      }
      if (request.params.name === "control_tap") {
        const a = request.params.arguments as { x: number; y: number };
        return textResult({ success: true, detail: await tap(a.x, a.y) });
      }
      if (request.params.name === "control_long_press") {
        const a = request.params.arguments as { x: number; y: number; durationMs?: number };
        return textResult({ success: true, detail: await longPress(a.x, a.y, a.durationMs) });
      }
      if (request.params.name === "control_swipe") {
        const a = request.params.arguments as { x1: number; y1: number; x2: number; y2: number; durationMs?: number };
        return textResult({ success: true, detail: await swipe(a.x1, a.y1, a.x2, a.y2, a.durationMs) });
      }
      if (request.params.name === "control_scroll") {
        const a = request.params.arguments as { direction: "up" | "down" | "left" | "right"; amount?: number };
        return textResult({ success: true, detail: await scroll(a.direction, a.amount) });
      }
      if (request.params.name === "control_type") {
        const a = request.params.arguments as { text: string };
        return textResult({ success: true, detail: await typeText(a.text) });
      }
      if (request.params.name === "control_key") {
        const a = request.params.arguments as { key: string };
        return textResult({ success: true, detail: await pressKey(a.key) });
      }
      if (request.params.name === "control_launch_app") {
        const a = request.params.arguments as { package: string };
        return textResult({ success: true, detail: await launchApp(a.package) });
      }
      // ── Advanced control / inspection (v2.6) ──
      if (request.params.name === "get_ui_hierarchy") {
        const a = request.params.arguments as { onlyClickable?: boolean; filter?: string } | undefined;
        let nodes = await uiHierarchy();
        if (a?.onlyClickable) nodes = nodes.filter((n) => n.clickable);
        if (a?.filter) {
          const f = a.filter.toLowerCase();
          nodes = nodes.filter((n) => `${n.text} ${n.desc}`.toLowerCase().includes(f));
        }
        return textResult({ success: true, count: nodes.length, nodes });
      }
      if (request.params.name === "control_tap_text") {
        const a = request.params.arguments as { query: string; exact?: boolean };
        return textResult({ success: true, detail: await tapText(a.query, a.exact ?? false) });
      }
      if (request.params.name === "control_swipe_until") {
        const a = request.params.arguments as {
          query: string; direction?: "up" | "down" | "left" | "right"; maxSwipes?: number;
        };
        return textResult({ success: true, detail: await swipeUntil(a.query, a.direction ?? "down", a.maxSwipes ?? 8) });
      }
      if (request.params.name === "control_open_url") {
        const a = request.params.arguments as { url: string };
        return textResult({ success: true, detail: await openUrl(a.url) });
      }
      if (request.params.name === "compare_frames") {
        const a = request.params.arguments as { delayMs?: number } | undefined;
        const r = await compareFrames(a?.delayMs ?? 1200);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ changedRatio: r.changedRatio, changed: r.changedRatio > 0.02 }, null, 2) },
            { type: "image" as const, data: r.before, mimeType: r.mimeType },
            { type: "image" as const, data: r.after, mimeType: r.mimeType },
          ],
        };
      }
      if (request.params.name === "wait_for_frame") {
        const a = request.params.arguments as { timeoutMs?: number } | undefined;
        const timeoutMs = Math.max(1000, Math.min(a?.timeoutMs ?? 30000, 120000));
        const startLatest = (await latestFrame())?.receivedAt ?? "";
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const now = await latestFrame();
          if (now && now.receivedAt !== startLatest) {
            const bytes = await readFile(now.filePath);
            return {
              content: [
                { type: "text" as const, text: JSON.stringify({ success: true, receivedAt: now.receivedAt, frame: now }, null, 2) },
                { type: "image" as const, data: bytes.toString("base64"), mimeType: now.mimeType },
              ],
            };
          }
          await new Promise((r) => setTimeout(r, 700));
        }
        return textResult({ success: false, error: "No new frame arrived before timeout. Ask the user to tap the floating bubble." }, true);
      }
      if (request.params.name === "get_logcat") {
        const a = request.params.arguments as { pkg?: string; grep?: string; lines?: number } | undefined;
        const text = await getLogcat({ pkg: a?.pkg, grep: a?.grep, lines: a?.lines });
        return textResult({ success: true, logcat: text });
      }
      if (request.params.name === "record_screen") {
        const a = request.params.arguments as { seconds?: number } | undefined;
        const clip = await recordScreen(a?.seconds ?? 5);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: true, seconds: clip.seconds }, null, 2) },
            { type: "image" as const, data: clip.base64, mimeType: clip.mimeType },
          ],
        };
      }
      return textResult({ success: false, error: `Unknown tool: ${request.params.name}` }, true);
    } catch (error) {
      log("ERROR", "MCP tool failed", { tool: request.params.name, error: String(error) });
      return textResult({ success: false, error: String(error) }, true);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceDefinitions(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "screensync://status") {
      const frame = await latestFrame();
      return {
        contents: [{ uri: request.params.uri, mimeType: "application/json", text: JSON.stringify({ latest: frame ?? null, retainedFrames: (await listFrames()).length }, null, 2) }],
      };
    }
    if (request.params.uri === "screensync://workflow") {
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: "text/markdown",
          text: "Call get_device_status first. If a fresh frame exists, call get_latest_screenshot and inspect the returned image. Explain visible defects with evidence, separate observation from inference, and request a new bubble capture after the UI changes.",
        }],
      };
    }
    if (request.params.uri === "screensync://skills") {
      return {
        contents: [{
          uri: request.params.uri,
          mimeType: "text/markdown",
          text: JSON.stringify(getSkillsContent(), null, 2),
        }],
      };
    }
    throw new Error(`Unknown resource: ${request.params.uri}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptDefinitions(),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const result = promptMessage(request.params.name, (request.params.arguments ?? {}) as Record<string, string>);
    if (!result) throw new Error(`Unknown prompt: ${request.params.name}`);
    return result;
  });

  return server;
}
