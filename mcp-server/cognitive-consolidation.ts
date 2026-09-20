// ScreenSync Hippocampal Memory Consolidation (AP-CE Tier 4)
// Medallion Lakehouse Architecture for Cognitive Memory:
// - Bronze: Ephemeral sensory traces & raw execution episodes (50-run retention)
// - Silver: Structured domain/intent telemetry, probe accuracy & latency distributions
// - Gold: Consolidated Master Playbooks with Long-Term Potentiation (LTP) & Synaptic Decay (LTD)

import type { CognitiveMemoryData, ExecutionEpisode, ProceduralPlaybook } from "./cognitive-memory.js";

export interface BronzeTrace extends ExecutionEpisode {
  rawTelemetry?: Record<string, unknown>;
  errorTrace?: string;
}

export interface SilverDomainMetric {
  domain: string;
  intent: string;
  totalExecutions: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  probeReliability: Record<string, number>; // signal -> accuracy ratio 0.0 - 1.0
  lastRecordedAt: string;
}

export interface GoldPlaybookMeta {
  confidenceScore: number; // 0.0 to 1.0
  consecutiveFailures: number;
  status: "active" | "cold_standby" | "deprecated";
  lastConsolidatedAt: string;
}

export interface ConsolidationReport {
  timestamp: string;
  bronzePrunedCount: number;
  bronzeRetainedCount: number;
  silverMetricsUpdated: number;
  strengthenedPlaybooks: string[];
  decayedPlaybooks: string[];
  prunedPlaybooks: string[];
  sanitizedWisdomEntries: number;
}

const BRONZE_RETENTION_LIMIT = 50;
const COLD_STANDBY_DAYS = 30;

/**
 * Strips user-specific credentials, emails, session cookies, and personal text
 * before wisdom is promoted to the cross-profile Gold knowledge tier.
 */
export function sanitizeSwarmWisdom<T>(obj: T): T {
  if (typeof obj === "string") {
    let s = obj as string;
    // Sanitize email addresses
    s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[USER_EMAIL]");
    // Sanitize Bearer tokens / auth strings
    s = s.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi, "Bearer [REDACTED]");
    // Sanitize session cookie strings
    s = s.replace(/(auth_token|ct0|sessionid|authToken)=([^;]+)/gi, "$1=[REDACTED]");
    return s as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeSwarmWisdom(item)) as unknown as T;
  }
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (/password|secret|auth_token|cookie|token/i.test(k) && typeof v === "string") {
        out[k] = "[REDACTED]";
      } else {
        out[k] = sanitizeSwarmWisdom(v);
      }
    }
    return out as unknown as T;
  }
  return obj;
}

/**
 * Runs Hippocampal Consolidation across the Cognitive Memory Store:
 * 1. Aggregates Bronze episodes into Silver performance metrics.
 * 2. Applies Long-Term Potentiation (LTP) on successful playbooks.
 * 3. Applies Long-Term Depression (LTD) & synaptic pruning on failing branches.
 * 4. Flags cold playbooks (>30 days inactive) as cold_standby.
 * 5. Prunes raw Bronze buffer to BRONZE_RETENTION_LIMIT.
 */
export function runHippocampalConsolidation(
  memData: CognitiveMemoryData,
  silverStore: Record<string, SilverDomainMetric> = {},
  goldMetaStore: Record<string, GoldPlaybookMeta> = {}
): {
  data: CognitiveMemoryData;
  silver: Record<string, SilverDomainMetric>;
  goldMeta: Record<string, GoldPlaybookMeta>;
  report: ConsolidationReport;
} {
  const episodes = memData.episodes || [];
  const playbooks = memData.playbooks || {};
  const strengthened: string[] = [];
  const decayed: string[] = [];
  const pruned: string[] = [];

  // 1. Silver Layer Aggregation
  for (const ep of episodes) {
    const key = `${ep.domain}::${ep.intent || "general"}`;
    const existing = silverStore[key] || {
      domain: ep.domain,
      intent: ep.intent || "general",
      totalExecutions: 0,
      successCount: 0,
      successRate: 0,
      avgDurationMs: 0,
      minDurationMs: ep.durationMs,
      maxDurationMs: ep.durationMs,
      probeReliability: {},
      lastRecordedAt: ep.timestamp
    };

    existing.totalExecutions += 1;
    if (ep.success) existing.successCount += 1;
    existing.successRate = Number((existing.successCount / existing.totalExecutions).toFixed(3));
    existing.avgDurationMs = Math.round(
      (existing.avgDurationMs * (existing.totalExecutions - 1) + ep.durationMs) / existing.totalExecutions
    );
    existing.minDurationMs = Math.min(existing.minDurationMs, ep.durationMs);
    existing.maxDurationMs = Math.max(existing.maxDurationMs, ep.durationMs);
    existing.lastRecordedAt = ep.timestamp;

    if (ep.conditionSignals) {
      for (const [sig, active] of Object.entries(ep.conditionSignals)) {
        const curScore = existing.probeReliability[sig] ?? 0.8;
        const updatedScore = ep.success && active ? Math.min(1.0, curScore + 0.05) : Math.max(0.1, curScore - 0.05);
        existing.probeReliability[sig] = Number(updatedScore.toFixed(2));
      }
    }

    silverStore[key] = existing;
  }

  // 2. Gold Layer Potentiation & Depression (LTP / LTD)
  const now = Date.now();
  for (const [pbId, pb] of Object.entries(playbooks)) {
    const meta = goldMetaStore[pbId] || {
      confidenceScore: 0.8,
      consecutiveFailures: 0,
      status: "active",
      lastConsolidatedAt: new Date().toISOString()
    };

    const metricKey = `${pb.domain}::${pb.intent}`;
    const metric = silverStore[metricKey];

    if (metric) {
      if (metric.successRate >= 0.8) {
        meta.confidenceScore = Math.min(1.0, Number((meta.confidenceScore + 0.1).toFixed(2)));
        meta.consecutiveFailures = 0;
        meta.status = "active";
        strengthened.push(pbId);
      } else if (metric.successRate < 0.5) {
        meta.confidenceScore = Math.max(0.0, Number((meta.confidenceScore - 0.25).toFixed(2)));
        meta.consecutiveFailures += 1;
        decayed.push(pbId);
        if (meta.consecutiveFailures >= 3 || meta.confidenceScore < 0.2) {
          meta.status = "deprecated";
        }
      }
    }

    if (pb.lastExecutedAt) {
      const elapsedDays = (now - new Date(pb.lastExecutedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (elapsedDays > COLD_STANDBY_DAYS && meta.status === "active") {
        meta.status = "cold_standby";
      }
    }

    meta.lastConsolidatedAt = new Date().toISOString();
    goldMetaStore[pbId] = meta;
  }

  // 3. Synaptic pruning of dead playbooks - by ARCHIVING them, never by deleting.
  //    This used to `delete playbooks[pbId]`, destroying a recipe a human may have spent real effort on,
  //    with no way back. It was reachable only because goldMetaStore is rebuilt empty on every call, so
  //    no playbook ever accumulated enough failures to qualify; a persisted store would have started
  //    erasing them. Deprecated is the honest state: kept, never offered (cognitive-skills.ts).
  for (const [pbId, meta] of Object.entries(goldMetaStore)) {
    const pb = playbooks[pbId];
    if (!pb || pb.status === "deprecated") continue;
    if (meta.status === "deprecated" && meta.confidenceScore <= 0.1) {
      playbooks[pbId] = {
        ...pb,
        status: "deprecated",
        deprecatedAt: new Date().toISOString(),
        deprecatedReason: `consolidation: confidence fell to ${meta.confidenceScore} after ${meta.consecutiveFailures} consecutive failing passes`,
      };
      pruned.push(pbId);
    }
  }

  // 4. Bronze Layer Pruning (Preserve latest BRONZE_RETENTION_LIMIT traces)
  let prunedCount = 0;
  if (episodes.length > BRONZE_RETENTION_LIMIT) {
    prunedCount = episodes.length - BRONZE_RETENTION_LIMIT;
    memData.episodes = episodes.slice(-BRONZE_RETENTION_LIMIT);
  }

  const report: ConsolidationReport = {
    timestamp: new Date().toISOString(),
    bronzePrunedCount: prunedCount,
    bronzeRetainedCount: memData.episodes.length,
    silverMetricsUpdated: Object.keys(silverStore).length,
    strengthenedPlaybooks: strengthened,
    decayedPlaybooks: decayed,
    prunedPlaybooks: pruned,
    sanitizedWisdomEntries: Object.keys(playbooks).length
  };

  return {
    data: memData,
    silver: silverStore,
    goldMeta: goldMetaStore,
    report
  };
}
