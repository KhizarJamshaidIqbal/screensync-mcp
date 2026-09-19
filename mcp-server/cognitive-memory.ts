// ScreenSync Cognitive Memory & Auto-Learning Engine (Enhanced Multi-Condition Model)
// Direct human-mind & child cognitive development model:
// 1. Sensory Perception & Condition Probes (Is flame lit? Is steam rising? Proximity warmth test?)
// 2. State-Dependent Episodic Memory (Recognizing environment before acting)
// 3. Semantic Memory (Abstract facts & framework rules)
// 4. Adaptive Procedural Memory (Playbooks with conditional branches)

import path from "node:path";
import { DATA_DIR, log } from "./config.js";
import { atomicWriteJson, quarantine, readJsonSafe } from "./cognitive-state.js";
import { migrateMemory } from "./cognitive-memory-migrate.js";
import { getDefaultSeededMemory } from "./cognitive-memory-seed.js";
import { runHippocampalConsolidation, type ConsolidationReport } from "./cognitive-consolidation.js";
import { speculativeWarm, globalCircuitBreaker, type SpeculativeWarmResult } from "./cognitive-warming.js";
import { healPlaybookStep, type HealCandidate, type HealResult } from "./cognitive-healer.js";

export interface PlaybookStep {
  step: number;
  name: string;
  tool: string;
  args?: Record<string, unknown>;
  codeSnippet?: string;
  expectedOutcome?: string;
}

export interface StateProbe {
  signal: string;
  selector?: string;
  expected: "present" | "absent" | "matches";
  pattern?: string;
  humanAnalogy: string;
}

export interface PlaybookBranch {
  name: string;
  conditionDescription: string;
  whenSignal: string;
  skipToStep?: number;
  alternateSteps?: PlaybookStep[];
}

export interface ProceduralPlaybook {
  id: string;
  name: string;
  domain: string;
  intent: string;
  description: string;
  environmentalProbes: StateProbe[];
  preconditions: string[];
  steps: PlaybookStep[];
  branches?: PlaybookBranch[];
  successCount: number;
  lastExecutedAt?: string;
  targetDurationSeconds?: number;
}

export interface DomainPitfall {
  id: string;
  domain: string;
  symptom: string;
  rootCause: string;
  conditionTrigger?: string;
  antiPattern: string;
  provenSolution: string;
  codeSnippet?: string;
  discoveredAt: string;
}

export interface DomainSemanticMemory {
  domain: string;
  framework?: string;
  authRequired?: boolean;
  cspRestricted?: boolean;
  preferredInputMethod?: "execCommand" | "fill" | "type" | "cdp";
  keySelectors?: Record<string, string>;
  lastVerifiedAt?: string;
}

export interface ExecutionEpisode {
  id: string;
  timestamp: string;
  domain: string;
  intent: string;
  profile?: string;
  conditionSignals?: Record<string, boolean>;
  success: boolean;
  durationMs: number;
  pitfallsEncountered?: string[];
  notes?: string;
}

export interface CognitiveMemoryData {
  version: "1.1.0";
  updatedAt: string;
  domains: Record<string, DomainSemanticMemory>;
  playbooks: Record<string, ProceduralPlaybook>;
  pitfalls: Record<string, DomainPitfall[]>;
  episodes: ExecutionEpisode[];
}

const MEMORY_FILE = path.join(DATA_DIR, "cognitive-memory.json");

export class CognitiveMemoryStore {
  private data: CognitiveMemoryData | null = null;

  /** `file` is injectable so tests can point a store at a scratch path instead of the real one. */
  constructor(private readonly file: string = MEMORY_FILE) {}

  /**
   * Loads the store, lazily and once.
   *
   *   file missing                     -> seed a fresh one (first run)
   *   file parses and is recognisable  -> use it, migrated if it was older. NEVER reseeded.
   *   file unreadable, unrecognised, or from a newer build
   *                                    -> set aside as <file>.corrupt-<ts>, then seed fresh
   *
   * The previous version overwrote the real file with defaults whenever a seeded playbook had
   * lost its probes, so a routine schema bump or pruning pass could erase everything learned.
   */
  public load(): CognitiveMemoryData {
    if (this.data) return this.data;

    const read = readJsonSafe(this.file);
    if (read.status === "ok") {
      const migrated = migrateMemory(read.value);
      if (migrated) {
        this.data = migrated.data;
        if (migrated.changed) this.save();
        return this.data;
      }
      quarantine(this.file, "unrecognised or newer cognitive memory schema");
    } else if (read.status === "corrupt") {
      quarantine(this.file, read.error);
    }

    this.data = getDefaultSeededMemory();
    this.save();
    return this.data;
  }

  public save(): void {
    if (!this.data) return;
    try {
      this.data.updatedAt = new Date().toISOString();
      atomicWriteJson(this.file, this.data);
    } catch (e) {
      log("ERROR", "Failed to save cognitive memory", { error: String(e) });
    }
  }

  public normalizeDomain(input?: string): string {
    if (!input) return "";
    try {
      const u = new URL(input.startsWith("http") ? input : `https://${input}`);
      return u.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return String(input).replace(/^www\./, "").toLowerCase();
    }
  }

  public recall(cue: {
    domain?: string;
    url?: string;
    intent?: string;
    profile?: string;
    detectedSignals?: Record<string, boolean>;
  }) {
    const data = this.load();
    const domain = this.normalizeDomain(cue.domain || cue.url);
    const intent = (cue.intent || "").toLowerCase();

    const domainFacts = domain ? (data.domains[domain] || null) : null;
    const domainPitfalls = domain ? (data.pitfalls[domain] || []) : [];

    const matchingPlaybooks = Object.values(data.playbooks).filter((pb) => {
      if (domain && this.normalizeDomain(pb.domain) !== domain) return false;
      if (intent && pb.intent.toLowerCase() !== intent) return false;
      return true;
    });

    const hasPlaybook = matchingPlaybooks.length > 0;
    let recommendedPlaybook: ProceduralPlaybook | null = hasPlaybook ? matchingPlaybooks[0] : null;
    let selectedBranch: PlaybookBranch | null = null;

    if (recommendedPlaybook && cue.detectedSignals) {
      const matched = recommendedPlaybook.branches?.find(
        (b) => cue.detectedSignals?.[b.whenSignal] === true
      );
      if (matched) selectedBranch = matched;
    }

    return {
      found: Boolean(domainFacts || domainPitfalls.length > 0 || hasPlaybook),
      domain,
      intent: intent || undefined,
      domainFacts,
      pitfalls: domainPitfalls,
      recommendedPlaybook,
      selectedBranch,
      environmentalProbes: recommendedPlaybook?.environmentalProbes || [],
      fastPathAvailable: Boolean(recommendedPlaybook),
      estimatedSeconds: selectedBranch?.skipToStep ? 5 : (recommendedPlaybook?.targetDurationSeconds || 15)
    };
  }

  public learn(params: {
    action: "playbook" | "pitfall" | "fact" | "episode";
    domain: string;
    intent?: string;
    data: Record<string, any>;
  }) {
    const mem = this.load();
    const domain = this.normalizeDomain(params.domain);
    if (!domain) throw new Error("domain is required for learning");

    let entryId = "";

    switch (params.action) {
      case "playbook": {
        const pb = params.data as Partial<ProceduralPlaybook>;
        const id = pb.id || `pb_${domain.replace(/\./g, "_")}_${pb.name || "custom"}`;
        const playbook: ProceduralPlaybook = {
          id,
          name: pb.name || id,
          domain,
          intent: pb.intent || params.intent || "general",
          description: pb.description || "Learned procedural playbook",
          environmentalProbes: Array.isArray(pb.environmentalProbes) ? pb.environmentalProbes : [],
          branches: Array.isArray(pb.branches) ? pb.branches : [],
          preconditions: Array.isArray(pb.preconditions) ? pb.preconditions : [],
          steps: Array.isArray(pb.steps) ? (pb.steps as PlaybookStep[]) : [],
          successCount: (pb.successCount || 1),
          lastExecutedAt: new Date().toISOString(),
          targetDurationSeconds: pb.targetDurationSeconds || 30
        };
        mem.playbooks[playbook.name] = playbook;
        entryId = id;
        break;
      }
      case "pitfall": {
        const pf = params.data;
        const id = pf.id || `pitfall_${domain.replace(/\./g, "_")}_${Date.now()}`;
        const pitfall: DomainPitfall = {
          id,
          domain,
          symptom: String(pf.symptom || "Unexpected failure"),
          rootCause: String(pf.rootCause || "Unknown root cause"),
          conditionTrigger: pf.conditionTrigger ? String(pf.conditionTrigger) : undefined,
          antiPattern: String(pf.antiPattern || ""),
          provenSolution: String(pf.provenSolution || ""),
          codeSnippet: pf.codeSnippet ? String(pf.codeSnippet) : undefined,
          discoveredAt: new Date().toISOString()
        };
        if (!mem.pitfalls[domain]) mem.pitfalls[domain] = [];
        mem.pitfalls[domain].push(pitfall);
        entryId = id;
        break;
      }
      case "fact": {
        const existing = mem.domains[domain] || { domain };
        mem.domains[domain] = {
          ...existing,
          ...params.data,
          domain,
          lastVerifiedAt: new Date().toISOString()
        };
        entryId = domain;
        break;
      }
      case "episode": {
        const ep = params.data;
        const id = ep.id || `ep_${Date.now()}`;
        const episode: ExecutionEpisode = {
          id,
          timestamp: new Date().toISOString(),
          domain,
          intent: ep.intent || params.intent || "task",
          profile: ep.profile,
          conditionSignals: ep.conditionSignals || {},
          success: Boolean(ep.success),
          durationMs: Number(ep.durationMs) || 0,
          pitfallsEncountered: Array.isArray(ep.pitfallsEncountered) ? ep.pitfallsEncountered : [],
          notes: ep.notes
        };
        mem.episodes.push(episode);
        if (mem.episodes.length > 200) mem.episodes.shift();
        entryId = id;
        break;
      }
      default:
        throw new Error(`Unknown learn action: ${params.action}`);
    }

    this.save();
    return { learned: true, action: params.action, domain, entryId };
  }

  public consolidate(): ConsolidationReport {
    const mem = this.load();
    const { report } = runHippocampalConsolidation(mem);
    this.save();
    return report;
  }

  public warm(params: {
    domain: string;
    intent: string;
    profile?: string;
    detectedSignals?: Record<string, boolean>;
  }): SpeculativeWarmResult {
    return speculativeWarm({ store: this, ...params });
  }

  public heal(params: {
    playbookId: string;
    stepIndex: number;
    failingSelector: string;
    candidate: HealCandidate;
  }): HealResult {
    return healPlaybookStep({ store: this, ...params });
  }
}

export const cognitiveStore = new CognitiveMemoryStore();
