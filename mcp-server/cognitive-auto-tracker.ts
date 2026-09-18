// ScreenSync Cognitive Auto-Tracker: Instant Inline Telemetry & Lifespan Maturation
// Automatically tracks every tool execution, updates domain maturity XP,
// logs execution episodes, and penalizes failures with trauma burns.

import { cognitiveStore } from "./cognitive-memory.js";
import { globalMaturationEngine } from "./cognitive-maturation.js";
import { globalLifespanEngine } from "./cognitive-lifespan.js";
import type { WebToolResult } from "./web.js";

export function trackToolExecution(
  tool: string,
  args: Record<string, unknown>,
  result: WebToolResult,
  durationMs: number
): void {
  try {
    const rawTarget = String(args.url || args.origin || (result.data as any)?.url || args.domain || "");
    let domain = "";
    if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://")) {
      try {
        domain = new URL(rawTarget).hostname.replace(/^www\./, "").toLowerCase();
      } catch {}
    } else if (rawTarget.includes(".") && !rawTarget.includes(" ") && !rawTarget.includes("/")) {
      domain = rawTarget.replace(/^www\./, "").toLowerCase();
    }

    if (!domain || domain === "localhost" || domain === "127.0.0.1") return;

    // 1. Auto-record execution episode into cognitiveStore
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

    // 2. Instant maturation & lifespan progression
    if (result.ok) {
      globalMaturationEngine.getOrEvolveProfile(domain, { outcome: "success", xpGain: 5 });
      globalLifespanEngine.evaluateLifespan(domain, { outcome: "success" });
    } else {
      globalMaturationEngine.getOrEvolveProfile(domain, { outcome: "trauma", xpGain: 0 });
      globalLifespanEngine.evaluateLifespan(domain, { outcome: "burn" });
    }
  } catch {
    // Non-blocking inline telemetry
  }
}
