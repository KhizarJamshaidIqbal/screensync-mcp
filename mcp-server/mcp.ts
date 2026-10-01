import { appManifest } from "./app-update.js";
import { collectDeviceStatus, fetchHubPhoneOnline } from "./device-status.js";
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
  catalogFor,
  getSkillsContent,
  promptDefinitions,
  resourceDefinitions,
  SERVER_NAME,
  SERVER_VERSION,
  toolDefinitions,
  getToolsForMode,
  isConsolidatedMode,
  resolveConsolidatedCall,
} from "./catalog.js";
import { log } from "./config.js";
import { emitHubEvent } from "./events.js";
import { promptMessage } from "./prompts.js";
import { captureMetaText } from "./web-capture-meta.js";
import {
  latestFrame,
  listFrames,
  saveInspection,
  savePatch,
  type BugRegion,
  type InspectionResult,
  type PatchResult,
} from "./storage.js";
import { isControlTool, runControlAction, toMcpContent } from "./mcp-control.js";
// web_* tools round-trip through the HTTP hub; hub-web-call.ts also says what a failed round trip means.
import { callHubWebTool } from "./hub-web-call.js";

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

export function createMcpServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolsForMode(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (isConsolidatedMode()) {
      const resolved = resolveConsolidatedCall(
        request.params.name,
        (request.params.arguments ?? {}) as { action: string; args?: Record<string, unknown> }
      );
      if ("toolName" in resolved) {
        request = {
          ...request,
          params: {
            ...request.params,
            name: resolved.toolName,
            arguments: resolved.args,
          },
        };
      } else if ("error" in resolved) {
        return textResult({ success: false, error: resolved.error }, true);
      }
    }

    // B3: surface every tool call on the phone's AI activity timeline.
    // (web_* tools emit their own timeline event after the bridge round trip.)
    if (!request.params.name.startsWith("web_")) {
      emitHubEvent("tool", request.params.name, true);
    }
    try {
      // ── Web bridge (browser access for AI agents) ──
      if (request.params.name.startsWith("web_")) {
        const r = await callHubWebTool(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
        // The code (APPROVAL_TIMEOUT, USER_DECLINED, TIMEOUT, HUB_UNREACHABLE, ...) says what to do next.
        if (!r.ok) return textResult({ success: false, error: r.error, ...(r.code ? { code: r.code } : {}), ...(r.retryable !== undefined ? { retryable: r.retryable } : {}) }, true);
        if (request.params.name === "web_screenshot" || request.params.name === "web_full_screenshot" || request.params.name === "web_element_screenshot") {
          const d = r.data as { imageDataUrl?: string; [k: string]: unknown } | undefined;
          const dataUrl = d?.imageDataUrl ?? "";
          const [meta = "image/jpeg", base64 = ""] = dataUrl.includes(",") ? [dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl.split(",", 2)[1]] : [];
          return {
            content: [
              { type: "image" as const, data: base64, mimeType: meta || "image/jpeg" },
              // url/title/fullPage/selector as before, plus degraded/warning/paintConfirmed/... when the capture sent them.
              { type: "text" as const, text: captureMetaText(d) },
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
        if (request.params.name === "web_pixel_diff") {
          const d = r.data as { diffImageDataUrl?: string; [k: string]: unknown } | undefined;
          const dataUrl = d?.diffImageDataUrl ?? "";
          const [meta = "image/jpeg", base64 = ""] = dataUrl.includes(",") ? [dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl.split(",", 2)[1]] : [];
          const { diffImageDataUrl: _omit, ...summary } = d ?? {};
          const content: Array<{ type: "image"; data: string; mimeType: string } | { type: "text"; text: string }> = [];
          if (base64) {
            content.push({ type: "image" as const, data: base64, mimeType: meta || "image/jpeg" });
          }
          content.push({ type: "text" as const, text: JSON.stringify(summary, null, 2) });
          return { content };
        }
        return textResult({ success: true, ...((r.data ?? {}) as object) });
      }
      if (request.params.name === "get_mcp_catalog") {
        return textResult(catalogFor(request.params.arguments));
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
      if (request.params.name === "check_app_update") {
        const manifest = await appManifest();
        if (!manifest) {
          return textResult({
            available: false,
            error: "No release APK has been built yet. Run: flutter build apk --release",
          });
        }
        const updateArgs = (request.params.arguments ?? {}) as { versionCode?: number };
        const installed = typeof updateArgs.versionCode === "number" ? updateArgs.versionCode : null;
        return textResult({
          available: true,
          versionName: manifest.versionName,
          versionCode: manifest.versionCode,
          sha256: manifest.sha256,
          sizeBytes: manifest.sizeBytes,
          builtAt: manifest.builtAt,
          versionSource: manifest.versionSource,
          installedVersionCode: installed,
          updateAvailable: installed === null ? null : manifest.versionCode > installed,
        });
      }
      if (request.params.name === "get_device_status") {
        // Same definition as GET /api/device/status (device-status.ts). The phone's SSE link lives in the hub process,
        // which may not be this one, so it is asked over HTTP; connected means a frame arrived in the last minute.
        return textResult(await collectDeviceStatus(() => fetchHubPhoneOnline()));
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
      // ── Phone control, ADB inspection and the OS plane (catalog-control.ts, answered in mcp-control.ts) ──
      if (isControlTool(request.params.name)) {
        return toMcpContent(await runControlAction(request.params.name, request.params.arguments));
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
