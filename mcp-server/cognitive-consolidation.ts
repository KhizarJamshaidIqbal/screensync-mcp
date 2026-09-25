// ScreenSync Hippocampal Memory Consolidation (AP-CE Tier 4)
// Medallion Lakehouse Architecture for Cognitive Memory:
// - Bronze: Ephemeral sensory traces & raw execution episodes (50-run retention per domain)
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

/** Bronze episodes kept PER DOMAIN. A global limit let one busy domain erase every other domain's history. */
const BRONZE_RETENTION_LIMIT = 50;
/** A playbook with at least this many reported runs is judged on its own record, not its intent's episodes. */
const MIN_OWN_RUNS = 3;
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
 * 3. Applies Long-Term Depression (LTD) on failing playbooks. Advisory only: consolidation never archives
 *    or deletes a playbook (the outcome ledger in cognitive-skills.ts owns a playbook's lifecycle).
 * 4. Flags cold playbooks (>30 days inactive) as cold_standby.
 * 5. Prunes the raw Bronze buffer to the newest BRONZE_RETENTION_LIMIT episodes of each domain.
 *
 * A playbook is judged on its OWN outcome counters once it has MIN_OWN_RUNS runs. Before that it falls back
 * to the success rate of episodes with the same domain::intent - which rarely matches, because tracker
 * episodes carry the tool name ("click") as their intent while playbooks carry a task ("post").
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

    const ownRuns = (pb.successCount ?? 0) + (pb.failureCount ?? 0);
    let rate: number | null = null;
    let failingStreak = false;
    if (ownRuns >= MIN_OWN_RUNS) {
      rate = (pb.successCount ?? 0) / ownRuns;
      failingStreak = (pb.consecutiveFailures ?? 0) >= 3;
    } else {
      const metric = silverStore[`${pb.domain}::${pb.intent}`];
      if (metric) rate = metric.successRate;
    }

    if (rate !== null) {
      if (failingStreak || rate < 0.5) {
        meta.confidenceScore = Math.max(0.0, Number((meta.confidenceScore - 0.25).toFixed(2)));
        meta.consecutiveFailures += 1;
        decayed.push(pbId);
        if (meta.consecutiveFailures >= 3 || meta.confidenceScore < 0.2) {
          meta.status = "deprecated";
        }
      } else if (rate >= 0.8) {
        meta.confidenceScore = Math.min(1.0, Number((meta.confidenceScore + 0.1).toFixed(2)));
        meta.consecutiveFailures = 0;
        meta.status = "active";
        strengthened.push(pbId);
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

  // 3. No synaptic pruning here. This used to archive a playbook whose gold meta reached "deprecated", but
  //    the meta is rebuilt empty on every call, so the path was unreachable; judging playbooks on their own
  //    counters would have made it live and let a summary pass retire a recipe the outcome ledger still
  //    trusts. A playbook is retired by its outcomes (cognitive-skills.ts) or by hygiene, never here.

  // 4. Bronze Layer Pruning (the newest BRONZE_RETENTION_LIMIT traces of each domain; stored oldest first)
  const seen = new Map<string, number>();
  const keep = new Array<boolean>(episodes.length).fill(false);
  for (let i = episodes.length - 1; i >= 0; i -= 1) {
    const n = (seen.get(episodes[i].domain) ?? 0) + 1;
    seen.set(episodes[i].domain, n);
    keep[i] = n <= BRONZE_RETENTION_LIMIT;
  }
  const retained = episodes.filter((_, i) => keep[i]);
  const prunedCount = episodes.length - retained.length;
  if (prunedCount > 0) memData.episodes = retained;

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
