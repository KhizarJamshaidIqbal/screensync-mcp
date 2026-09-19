// ScreenSync Cognitive Auto-Tracker: instant inline telemetry for every relayed tool result.
//
// Two things happen to each result:
//   1. The competence spine observes it (cognitive-spine-observer.ts). That is the ONLY way a domain's
//      level can move from hub-seen behaviour, and it is stricter than this file used to be: it used to
//      hand out +5 XP and +1.2 "cognitive years" for any ok:true, including a web_expect that FAILED
//      (which returns ok:true with passed:false), and it scored the safety layer's own refusals as trauma.
//   2. The execution is logged as an episode in the durable memory store, as before.

import { cognitiveStore } from "./cognitive-memory.js";
import { hostOf, observeToolResult } from "./cognitive-spine-observer.js";
import type { WebToolResult } from "./web.js";

export function trackToolExecution(
  tool: string,
  args: Record<string, unknown>,
  result: WebToolResult,
  durationMs: number,
  session: string = "http",
): void {
  try {
    observeToolResult(tool, args, result, session);
  } catch {
    // Non-blocking inline telemetry
  }

  try {
    const domain = hostOf(args.url) || hostOf(args.origin) || hostOf((result.data as { url?: unknown } | null | undefined)?.url) || hostOf(args.domain);
    if (!domain) return;

    cognitiveStore.learn({
      action: "episode",
      domain,
      intent: tool.replace(/^web_/, ""),
      data: {
        success: result.ok,
        durationMs,
        profile: typeof args.profile === "string" ? args.profile : undefined,
        notes: result.ok
          ? `Instant telemetry: ${tool} completed in ${durationMs}ms`
          : `Instant telemetry: ${tool} failed: ${result.error || "unknown"}`
      }
    });
  } catch {
    // Non-blocking inline telemetry
  }
}
