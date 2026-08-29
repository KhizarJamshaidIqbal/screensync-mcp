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
import { log } from "./config.js";
import { emitHubEvent } from "./events.js";
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
    emitHubEvent("tool", request.params.name, true);
    try {
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
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const userMsg = (text: string, description: string) => ({
      description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
    });

    if (name === "inspect_latest_mobile_screen") {
      const focus = args.focus || "layout, rendering, accessibility, and interaction defects";
      return userMsg(
        `Use get_device_status, then get_latest_screenshot. Inspect the actual image for ${focus}. Report evidence, severity, likely Flutter cause, and a concrete fix. Ask for another bubble capture to verify the fix.`,
        "Inspect the latest captured mobile screen",
      );
    }

    if (name === "autonomous_ui_test") {
      const target = args.target || "the current screen";
      const goal = args.goal || "find any layout, rendering, or interaction defects";
      return userMsg(
        [
          `You are driving a real Android phone via ScreenSync. Autonomously UI-test: ${target}.`,
          `Goal: ${goal}.`,
          "",
          "Loop:",
          "1. Open the target (control_launch_app for a package, or control_open_url for a URL).",
          "2. control_screenshot to SEE the screen; get_ui_hierarchy to know what's tappable.",
          "3. Inspect the image for defects (overflow, clipping, contrast, spacing, broken images).",
          "4. Navigate with control_tap_text / control_swipe_until (never guess coordinates — use the hierarchy).",
          "5. After each action, use compare_frames to confirm the UI changed as expected.",
          "6. Check get_logcat (grep 'exception'/'error') for runtime errors after risky actions.",
          "Report a concise findings list with severity + evidence. Stop when the goal is met or no new screens remain.",
        ].join("\n"),
        "Autonomous UI test driver",
      );
    }

    if (name === "reproduce_bug") {
      const steps = args.steps || "(no steps provided)";
      const expected = args.expected ? `Expected behaviour: ${args.expected}.` : "";
      return userMsg(
        [
          "Reproduce this bug on the live phone via ScreenSync, documenting each step.",
          `Steps:\n${steps}`,
          expected,
          "",
          "For EACH step: control_screenshot before, perform the action (prefer control_tap_text), then compare_frames after.",
          "After the final step, call get_logcat (grep 'exception') to capture any stack trace.",
          "Report: what actually happened vs expected, the exact step where it diverged, the screenshot evidence, and the logcat lines. Then propose a likely root cause and a fix (publish_patch if you can).",
        ].join("\n"),
        "Reproduce a bug step-by-step",
      );
    }

    if (name === "accessibility_audit") {
      const standard = args.standard || "WCAG AA";
      return userMsg(
        [
          `Audit the current phone screen for accessibility against ${standard}.`,
          "1. control_screenshot to see it; get_ui_hierarchy for element sizes and labels.",
          "2. Flag tap targets smaller than 48x48dp (use the node bounds).",
          "3. Flag low text/background contrast from the image.",
          "4. Flag interactive elements with empty text AND empty content-desc (missing labels for screen readers).",
          "5. Note any text likely to clip when the user scales font size up.",
          "Report each issue with the element, its bounds, severity, and a concrete fix. Use publish_inspection to overlay the regions on the phone.",
        ].join("\n"),
        "Accessibility audit of the current screen",
      );
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  return server;
}
