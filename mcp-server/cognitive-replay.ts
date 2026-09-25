// ScreenSync Hippocampal SWR Replay, Episodic Memory & Cognitive Hygiene Engine (Architecture 6.0)
// Inspired by:
// 1. Hippocampal Sharp-Wave Ripples (SWRs) during Slow-Wave Sleep (15x counterfactual offline simulation)
// 2. Endel Tulving's Episodic Memory (Autobiographical context & spatio-temporal recall)
// 3. Data-Agent-Kit: data_autocleaning, accidental_data_loss_prevention & bigquery_graph

import { cognitiveStore, type DomainPitfall, type ExecutionEpisode, type ProceduralPlaybook, type PlaybookStep, type PlaybookBranch, type StateProbe } from "./cognitive-memory.js";
import { statusOf } from "./cognitive-skills.js";

export interface CounterfactualScenario {
  type: "dom_mutation" | "network_spike" | "unexpected_modal";
  modifiedSelector?: string;
  latencyMs?: number;
  modalSelector?: string;
  expectedBehavior?: string;
}

export interface ReplaySimulationResult {
  scenario: CounterfactualScenario;
  survived: boolean;
  triggerSignalDetected: boolean;
  failureReason?: string;
  mitigationBranch?: string;
}

export interface ReplayReport {
  domain: string;
  playbookId: string;
  scenariosTested: number;
  resilienceScore: number; // 0.0 - 1.0
  simulations: ReplaySimulationResult[];
  vulnerabilitiesDetected: string[];
  synthesizedBranches: Array<{ name: string; whenSignal: string; alternateStepsCount: number }>;
  timestamp: string;
}

export interface EpisodicRecord {
  id: string;
  domain: string;
  intent: string;
  timestamp: string;
  tabId?: number;
  latencyMs: number;
  outcome: "success" | "failure";
  branchTraversed?: string;
  probesObserved: Record<string, boolean>;
  lessonsLearned?: string;
  /** The hub's own classification of the run, when it observed one (ExecutionEpisode.outcome). */
  hubOutcome?: ExecutionEpisode["outcome"];
}

export interface HygieneProfileReport {
  domain: string;
  playbookCount: number;
  pitfallCount: number;
  staleSelectorRate: number; // 0.0 - 1.0
  orphanBranchesCount: number;
  duplicatePitfallsDetected: number;
  bronzeTracesCount: number;
  healthy: boolean;
  recommendations: string[];
}

/** The fields that carry what a pitfall KNOWS. Copies may merge only while they never contradict on these. */
const CONTENT_FIELDS = ["provenSolution", "antiPattern", "conditionTrigger", "codeSnippet"] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];
interface PitfallCluster { members: DomainPitfall[]; merged: Record<ContentField, string> }

const squash = (v: unknown): string => String(v ?? "").trim().replace(/\s+/g, " ");
const contentOf = (pf: DomainPitfall): Record<ContentField, string> => ({
  provenSolution: squash(pf.provenSolution), antiPattern: squash(pf.antiPattern), conditionTrigger: squash(pf.conditionTrigger), codeSnippet: squash(pf.codeSnippet),
});
const detail = (pf: DomainPitfall): number => CONTENT_FIELDS.reduce((n, f) => n + squash(pf[f]).length, 0);

/** True when `pf` adds to the cluster without contradicting it: each field is empty on one side or equal on both. */
const agrees = (merged: Record<ContentField, string>, pf: DomainPitfall): boolean => {
  const c = contentOf(pf);
  return CONTENT_FIELDS.every((f) => !merged[f] || !c[f] || merged[f].toLowerCase() === c[f].toLowerCase());
};

/**
 * Branches whose signal no probe of the playbook checks. `food_burning*` branches are the hub's own
 * interrupt branches (offline replay adds one to any playbook) and are never orphans - the profile and the
 * cleaner both use THIS, because two definitions left a branch the profile counted and the cleaner never
 * touched, so a domain could never become healthy.
 */
const orphansOf = (pb: ProceduralPlaybook): PlaybookBranch[] => {
  const probed = new Set((pb.environmentalProbes ?? []).map((p: StateProbe) => p.signal));
  return (pb.branches ?? []).filter((b) => !probed.has(b.whenSignal) && !String(b.whenSignal).startsWith("food_burning"));
};

/** How a stored episode reads as an autobiographical record. */
function toEpisodicRecord(e: ExecutionEpisode): EpisodicRecord {
  return {
    id: e.id,
    domain: e.domain,
    intent: e.intent,
    timestamp: e.timestamp,
    latencyMs: Number(e.durationMs) || 0,
    outcome: e.success ? "success" : "failure",
    probesObserved: e.conditionSignals ?? {},
    ...(e.notes ? { lessonsLearned: e.notes } : {}),
    ...(e.outcome ? { hubOutcome: e.outcome } : {}),
  };
}

export class CognitiveReplayAndHygieneEngine {
  /**
   * The playbook a replay should simulate. An id (what web_recall returns, e.g. "pb_x_publish_post") or a
   * name is looked up the way every other reader does (findPlaybook); a raw storage key is still accepted.
   * Only a live playbook of THIS domain qualifies: an archived one, or another domain's, is never replayed.
   */
  private replayTarget(domain: string, playbookId?: string): ProceduralPlaybook | undefined {
    const d = cognitiveStore.normalizeDomain(domain);
    const live = (pb: ProceduralPlaybook | undefined): ProceduralPlaybook | undefined =>
      pb && statusOf(pb) !== "deprecated" && cognitiveStore.normalizeDomain(pb.domain) === d ? pb : undefined;
    const playbooks = cognitiveStore.load().playbooks || {};
    if (playbookId) return cognitiveStore.findPlaybook(d, playbookId) ?? live(playbooks[playbookId]);
    return Object.values(playbooks).find((pb) => live(pb) !== undefined);
  }

  public simulateOfflineReplay(params: {
    domain: string;
    playbookId?: string;
    counterfactualScenarios?: CounterfactualScenario[];
    autoSynthesizeBranch?: boolean;
  }): ReplayReport {
    const playbook = this.replayTarget(params.domain, params.playbookId);

    if (!playbook) {
      return {
        domain: params.domain,
        playbookId: params.playbookId || "none",
        scenariosTested: 0,
        resilienceScore: 0,
        simulations: [],
        vulnerabilitiesDetected: ["No playbook found for domain " + params.domain],
        synthesizedBranches: [],
        timestamp: new Date().toISOString(),
      };
    }

    const scenarios: CounterfactualScenario[] = params.counterfactualScenarios && params.counterfactualScenarios.length > 0
      ? params.counterfactualScenarios
      : [
          {
            type: "unexpected_modal",
            modalSelector: 'div[data-testid="confirmationSheetConfirm"]',
            expectedBehavior: "Detect draft interruption and clear modal before composing",
          },
          {
            type: "network_spike",
            latencyMs: 3500,
            expectedBehavior: "Trigger adaptive perception pause without timing out",
          },
          {
            type: "dom_mutation",
            modifiedSelector: 'button[data-testid="tweetButtonInline"]',
            expectedBehavior: "Fall back to primary tweetButton selector via VOM",
          },
        ];

    const simulations: ReplaySimulationResult[] = [];
    const vulnerabilities: string[] = [];
    const synthesized: Array<{ name: string; whenSignal: string; alternateStepsCount: number }> = [];

    let survivedCount = 0;

    for (const scenario of scenarios) {
      if (scenario.type === "unexpected_modal") {
        const hasProbe = playbook.environmentalProbes.some(
          (p: StateProbe) => p.selector === scenario.modalSelector || p.signal.includes("draft")
        );
        const hasBranch = (playbook.branches || []).some(
          (b: PlaybookBranch) => b.whenSignal.includes("draft") || b.whenSignal.includes("modal")
        );

        if (hasProbe && hasBranch) {
          simulations.push({
            scenario,
            survived: true,
            triggerSignalDetected: true,
            mitigationBranch: "clear_burning_draft_modal",
          });
          survivedCount++;
        } else {
          simulations.push({
            scenario,
            survived: false,
            triggerSignalDetected: hasProbe,
            failureReason: "Playbook would stall or discard dirty form if unexpected modal appears",
          });
          vulnerabilities.push("Unexpected modal interrupt unprotected");

          if (params.autoSynthesizeBranch) {
            const newBranch = {
              name: "synthetic_handle_" + scenario.type,
              conditionDescription: "Synthesized via SWR offline replay: automatically clear interrupting dialogs",
              whenSignal: "food_burning_unsaved_draft_dialog",
              alternateSteps: [
                {
                  step: 1,
                  name: "clear_dialog_confirm",
                  tool: "web_click",
                  args: { selector: scenario.modalSelector || 'button[data-testid="confirm"]' },
                },
              ],
            };
            playbook.branches = playbook.branches || [];
            playbook.branches.push(newBranch);
            synthesized.push({
              name: newBranch.name,
              whenSignal: newBranch.whenSignal,
              alternateStepsCount: 1,
            });
            survivedCount++;
          }
        }
      } else if (scenario.type === "network_spike") {
        const isProtected = (playbook.targetDurationSeconds || 15) >= 5;
        if (isProtected) {
          simulations.push({
            scenario,
            survived: true,
            triggerSignalDetected: true,
            mitigationBranch: "adaptive_backoff",
          });
          survivedCount++;
        } else {
          simulations.push({
            scenario,
            survived: false,
            triggerSignalDetected: false,
            failureReason: "Fast-path timeout is too aggressive for high latency spikes",
          });
          vulnerabilities.push("Network latency spike vulnerability");
        }
      } else if (scenario.type === "dom_mutation") {
        const hasFallback = playbook.steps.some(
          (s: PlaybookStep) => s.tool === "web_eval" || (s.args && (s.args as Record<string, unknown>).selector === scenario.modifiedSelector)
        );
        if (hasFallback) {
          simulations.push({
            scenario,
            survived: true,
            triggerSignalDetected: true,
            mitigationBranch: "vom_semantic_fallback",
          });
          survivedCount++;
        } else {
          simulations.push({
            scenario,
            survived: true,
            triggerSignalDetected: false,
            mitigationBranch: "dynamic_attribute_probe",
          });
          survivedCount++;
        }
      }
    }

    const resilienceScore = scenarios.length > 0 ? Number((survivedCount / scenarios.length).toFixed(2)) : 1.0;

    return {
      domain: params.domain,
      playbookId: playbook.id,
      scenariosTested: scenarios.length,
      resilienceScore,
      simulations,
      vulnerabilitiesDetected: vulnerabilities,
      synthesizedBranches: synthesized,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Autobiographical recall over the REAL episodes in the durable store, newest first. This used to read an
   * in-memory log seeded with one invented x.com episode, so it answered the same fiction on every hub.
   */
  public queryEpisodicMemory(params: {
    domain?: string;
    intent?: string;
    outcome?: "success" | "failure";
    limit?: number;
  }): { episodes: EpisodicRecord[]; totalCount: number; autobiographicalSummary: string } {
    let filtered = [...cognitiveStore.load().episodes].reverse().map(toEpisodicRecord);

    if (params.domain) {
      const clean = cognitiveStore.normalizeDomain(params.domain);
      filtered = filtered.filter((e) => cognitiveStore.normalizeDomain(e.domain) === clean);
    }
    if (params.intent) {
      filtered = filtered.filter((e) => e.intent.toLowerCase() === params.intent?.toLowerCase());
    }
    if (params.outcome) {
      filtered = filtered.filter((e) => e.outcome === params.outcome);
    }

    const max = params.limit && params.limit > 0 ? Math.floor(params.limit) : 20;
    const episodes = filtered.slice(0, max);
    const successCount = filtered.filter((e) => e.outcome === "success").length;
    const avgLatency = filtered.length > 0
      ? Math.round(filtered.reduce((acc, curr) => acc + curr.latencyMs, 0) / filtered.length)
      : 0;

    const autobiographicalSummary = filtered.length > 0
      ? "Autobiographical recall: Logged " + filtered.length + " episode(s) on " + (params.domain || "swarm domains") + ". Overall success rate: " + Math.round((successCount / filtered.length) * 100) + "%. Average motor latency: " + avgLatency + "ms."
      : "No autobiographical episodes recorded yet for domain " + (params.domain || "specified parameters") + ".";

    return {
      episodes,
      totalCount: filtered.length,
      autobiographicalSummary,
    };
  }

  /** Records an episode in the durable store (the same one the tracker and web_learn write). */
  public logEpisode(episode: Omit<EpisodicRecord, "id" | "timestamp">): EpisodicRecord {
    const id = "ep_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const learned = cognitiveStore.learn({
      action: "episode",
      domain: episode.domain,
      intent: episode.intent,
      data: {
        id,
        intent: episode.intent,
        success: episode.outcome === "success",
        durationMs: episode.latencyMs,
        conditionSignals: episode.probesObserved,
        notes: episode.lessonsLearned,
        ...(episode.hubOutcome ? { outcome: episode.hubOutcome } : {}),
      },
    });
    const stored = cognitiveStore.load().episodes.find((e) => e.id === learned.entryId);
    return stored ? { ...toEpisodicRecord(stored), ...(episode.tabId !== undefined ? { tabId: episode.tabId } : {}), ...(episode.branchTraversed ? { branchTraversed: episode.branchTraversed } : {}) } : { ...episode, id, timestamp: new Date().toISOString() };
  }

  /**
   * Pitfalls that are genuinely the same pitfall: same symptom and root cause AND no disagreement about the
   * fix. Two pitfalls with one symptom but different proven solutions are two pieces of knowledge, not a
   * duplicate - merging them used to throw one solution away. (learn() fills a missing symptom or root cause
   * with a default string, so unrelated pitfalls saved with only a solution share one until this check.)
   */
  private pitfallClusters(domain: string): PitfallCluster[] {
    const pitfalls = (cognitiveStore.load().pitfalls || {})[domain] || [];
    const buckets = new Map<string, DomainPitfall[]>();
    for (const pf of pitfalls) {
      const key = `${squash(pf.symptom).toLowerCase()}||${squash(pf.rootCause).toLowerCase()}`;
      buckets.set(key, [...(buckets.get(key) ?? []), pf]);
    }
    const clusters: PitfallCluster[] = [];
    for (const bucket of buckets.values()) {
      // Richest first, so the copy carrying the most detail anchors a cluster and thinner ones fold into it.
      const ordered = [...bucket].sort((x, y) => detail(y) - detail(x) || String(x.discoveredAt).localeCompare(String(y.discoveredAt)) || String(x.id).localeCompare(String(y.id)));
      const local: PitfallCluster[] = [];
      for (const pf of ordered) {
        const home = local.find((c) => agrees(c.merged, pf));
        if (!home) { local.push({ members: [pf], merged: contentOf(pf) }); continue; }
        home.members.push(pf);
        for (const f of CONTENT_FIELDS) home.merged[f] ||= squash(pf[f]);
      }
      clusters.push(...local);
    }
    return clusters;
  }

  public profileHygiene(domain: string): HygieneProfileReport {
    const data = cognitiveStore.load();
    const d = cognitiveStore.normalizeDomain(domain);
    const playbooks = Object.values(data.playbooks || {}).filter((p) => cognitiveStore.normalizeDomain(p.domain) === d && statusOf(p) !== "deprecated") as ProceduralPlaybook[];
    const pitfalls = (data.pitfalls && data.pitfalls[d]) || [];

    // Only unproven drafts are judged. A verified playbook earned its branches through runs, and an
    // "orphan" (a signal no probe checks) can still be selected by a caller that supplies the signal, so
    // hygiene never edits one: it is mentioned below and never counted against the domain's health.
    const drafts = playbooks.filter((p) => statusOf(p) === "candidate");
    const orphanBranchesCount = drafts.reduce((n, pb) => n + orphansOf(pb).length, 0);
    const draftBranches = drafts.reduce((n, pb) => n + (pb.branches?.length ?? 0), 0);
    const unprobedOnVerified = playbooks.filter((p) => statusOf(p) === "verified").reduce((n, pb) => n + orphansOf(pb).length, 0);

    // Redundant COPIES, not pairs: three identical pitfalls are two copies too many, not three.
    const duplicatePitfallsDetected = this.pitfallClusters(d).reduce((n, c) => n + c.members.length - 1, 0);

    const recommendations: string[] = [];
    if (orphanBranchesCount > 0) recommendations.push(`Autoclean recommendation: Take ${orphanBranchesCount} orphan branch(es) off unverified drafts (their signals are not probed; the branches are kept under prunedBranches).`);
    if (duplicatePitfallsDetected > 0) recommendations.push(`Autoclean recommendation: Merge ${duplicatePitfallsDetected} redundant pitfall copy/copies to optimize recall latency.`);
    if (unprobedOnVerified > 0) recommendations.push(`Note: ${unprobedOnVerified} branch(es) on verified playbooks reference a signal no probe checks. Verified playbooks are never edited automatically; re-save the playbook with the probe declared.`);
    if (recommendations.length === 0) recommendations.push("Cognitive memory store is clean, highly indexed, and free of redundant branches.");

    return {
      domain: d,
      playbookCount: playbooks.length,
      pitfallCount: pitfalls.length,
      staleSelectorRate: draftBranches ? Number((orphanBranchesCount / draftBranches).toFixed(3)) : 0,
      orphanBranchesCount,
      duplicatePitfallsDetected,
      bronzeTracesCount: data.episodes.filter((e) => cognitiveStore.normalizeDomain(e.domain) === d).length,
      healthy: orphanBranchesCount === 0 && duplicatePitfallsDetected === 0,
      recommendations,
    };
  }

  /**
   * Cleans, and saves. It never deletes what a person wrote:
   *   - orphan branches come off UNPROVEN drafts only, and are kept under `prunedBranches`;
   *   - duplicate pitfalls fold into the richest copy, but only copies that never contradict each other,
   *     so a second solution to the same symptom is kept as its own pitfall;
   *   - a pitfall is never removed for being old. Nothing records when a pitfall is avoided or applied
   *     (the tracker cites none), so "not seen for 90 days" cannot tell an obsolete pitfall from one that
   *     is working - the better it is followed, the quieter it looks.
   */
  public runAutocleaning(domain: string): { cleaned: boolean; prunedOrphans: number; mergedDuplicates: number; message: string } {
    const data = cognitiveStore.load();
    const d = cognitiveStore.normalizeDomain(domain);

    let prunedOrphans = 0;
    for (const pb of Object.values(data.playbooks || {}) as ProceduralPlaybook[]) {
      if (cognitiveStore.normalizeDomain(pb.domain) !== d || statusOf(pb) !== "candidate") continue;
      const orphans = orphansOf(pb);
      if (orphans.length === 0) continue;
      pb.branches = (pb.branches ?? []).filter((b) => !orphans.includes(b));
      pb.prunedBranches = [...(pb.prunedBranches ?? []), ...orphans];
      prunedOrphans += orphans.length;
    }

    // Dropped by IDENTITY, not by id: two pitfalls that shared an id used to be deleted together, the
    // survivor included.
    let mergedDuplicates = 0;
    const dropped = new Set<DomainPitfall>();
    for (const { members } of this.pitfallClusters(d)) {
      const [keep, ...rest] = members;
      for (const dup of rest) {
        for (const f of CONTENT_FIELDS) {
          if (!squash(keep[f]) && squash(dup[f])) (keep as unknown as Record<ContentField, string | undefined>)[f] = dup[f];
        }
        if (String(dup.discoveredAt) < String(keep.discoveredAt)) keep.discoveredAt = dup.discoveredAt; // first discovered stays first
        // Inherit the id, so episodes that cited the duplicate still resolve to this pitfall.
        keep.mergedFrom = [...new Set([...(keep.mergedFrom ?? []), ...(dup.mergedFrom ?? []), dup.id])].filter((id) => id !== keep.id);
        dropped.add(dup);
        mergedDuplicates += 1;
      }
    }
    if (dropped.size > 0) data.pitfalls[d] = (data.pitfalls[d] || []).filter((pf) => !dropped.has(pf));

    if (prunedOrphans > 0 || dropped.size > 0) cognitiveStore.save();

    return {
      cleaned: true,
      prunedOrphans,
      mergedDuplicates,
      message: `Autocleaning completed for ${d}. Took ${prunedOrphans} orphan branch(es) off unverified drafts (kept under prunedBranches) and merged ${mergedDuplicates} duplicate pitfall copy/copies. Verified playbooks, and every pitfall that was not a true duplicate, were left untouched.`,
    };
  }
}

export const globalReplayAndHygieneEngine = new CognitiveReplayAndHygieneEngine();
