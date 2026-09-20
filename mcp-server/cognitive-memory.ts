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
import { HUB_OWNED_FIELDS, applyOutcome, asCandidate, isFastPath, statusOf, type OutcomeResult, type Provenance, type SkillStatus, type Verification } from "./cognitive-skills.js";
import { scorePlaybooks } from "./cognitive-recall-score.js";
import { freeEditKey, keyOf, storageKey, uniqueId } from "./cognitive-playbook-keys.js";

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
  // Lifecycle (cognitive-skills.ts). All hub-owned: a caller cannot set them. Absent on a playbook saved
  // before they existed; statusOf() then derives the status from successCount.
  status?: SkillStatus;
  provenance?: Provenance;
  createdAt?: string;
  verifications?: Verification[];
  verifiedAt?: string;
  failureCount?: number;
  consecutiveFailures?: number;
  deprecatedAt?: string;
  deprecatedReason?: string;
  /**
   * Storage key of the verified playbook this one is an edit of. Set by the hub when an edit is stored,
   * and the ONLY thing supersede() trusts. It used to be inferred from a "~candidate" suffix on the name,
   * which a caller could simply type: naming a playbook "flow~candidate" evicted the real "flow", even on
   * another domain. A relationship between records belongs in a field, never in a string a caller writes.
   */
  supersedes?: string;
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
  version: "1.2.0";
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
    // Trimmed, because the tool layer passes the caller's string through untouched: an intent of "post "
    // used to match nothing at all and hide a verified playbook completely.
    const intent = (cue.intent || "").trim().toLowerCase();

    const domainFacts = domain ? (data.domains[domain] || null) : null;
    const domainPitfalls = domain ? (data.pitfalls[domain] || []) : [];

    const matchingPlaybooks = Object.values(data.playbooks).filter((pb) => {
      if (statusOf(pb) === "deprecated") return false;
      if (domain && this.normalizeDomain(pb.domain) !== domain) return false;
      if (intent && pb.intent.toLowerCase() !== intent) return false;
      return true;
    });

    // Ranked by recency + importance + relevance instead of "whichever was stored first", then the pick
    // prefers a playbook that is actually USABLE. Taking the top-scored one outright kept recommending a
    // proven playbook that had just failed three times over the working replacement the agent had gone to
    // the trouble of getting verified - it still out-scored the newcomer on importance.
    const ranked = scorePlaybooks(matchingPlaybooks, { intent, detectedSignals: cue.detectedSignals }, Date.now());
    const best = ranked.find((r) => isFastPath(r.playbook)) ?? ranked[0] ?? null;
    const recommendedPlaybook: ProceduralPlaybook | null = best ? best.playbook : null;
    const hasPlaybook = recommendedPlaybook !== null;
    const playbookStatus = recommendedPlaybook ? statusOf(recommendedPlaybook) : null;
    let selectedBranch: PlaybookBranch | null = null;

    if (recommendedPlaybook && cue.detectedSignals) {
      const matched = recommendedPlaybook.branches?.find(
        (b) => cue.detectedSignals?.[b.whenSignal] === true
      );
      if (matched) selectedBranch = matched;
    }

    // Only a VERIFIED playbook (and not one on a run of reported failures) is a fast path.
    const fastPathAvailable = recommendedPlaybook !== null && isFastPath(recommendedPlaybook);
    let guidance: string | undefined;
    if (recommendedPlaybook && !fastPathAvailable) {
      guidance = playbookStatus === "candidate"
        ? "This playbook is an UNVERIFIED draft. Run it deliberately, confirm each step with web_expect, then report web_learn {action:'outcome', data:{playbook, success:true}}. Two hub-confirmed runs in two sessions make it verified."
        : "This playbook has failed several times in a row. Run it deliberately and re-verify it before trusting it as a fast path.";
    }

    return {
      found: Boolean(domainFacts || domainPitfalls.length > 0 || hasPlaybook),
      domain,
      intent: intent || undefined,
      domainFacts,
      pitfalls: domainPitfalls,
      recommendedPlaybook,
      playbookStatus,
      selectedBranch,
      environmentalProbes: recommendedPlaybook?.environmentalProbes || [],
      fastPathAvailable,
      ...(guidance ? { guidance } : {}),
      alternatives: ranked.slice(0, 3).map((r) => ({ id: r.playbook.id, name: r.playbook.name, status: statusOf(r.playbook), score: r.score, components: r.components })),
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
    let ignored: string[] = [];
    let note: string | undefined;

    switch (params.action) {
      case "playbook": {
        const pb = params.data as Partial<ProceduralPlaybook>;
        const name = String(pb.name || pb.id || "custom");
        const drafted: ProceduralPlaybook = {
          id: "",
          name,
          domain,
          intent: pb.intent || params.intent || "general",
          description: pb.description || "Learned procedural playbook",
          environmentalProbes: Array.isArray(pb.environmentalProbes) ? pb.environmentalProbes : [],
          branches: Array.isArray(pb.branches) ? pb.branches : [],
          preconditions: Array.isArray(pb.preconditions) ? pb.preconditions : [],
          steps: Array.isArray(pb.steps) ? (pb.steps as PlaybookStep[]) : [],
          successCount: 0,
          targetDurationSeconds: pb.targetDurationSeconds || 30
        };
        // Voyager's rule: a skill is checked BEFORE it enters the library. Whatever status, success count
        // or verifications the caller sent is ignored; the hub decides all of it.
        const playbook = asCandidate(drafted, new Date().toISOString());
        ignored = HUB_OWNED_FIELDS.filter((k) => (pb as Record<string, unknown>)[k] !== undefined).map((k) => `data.${k}`);
        if (pb.id !== undefined) ignored.push("data.id");
        playbook.id = uniqueId(mem.playbooks, domain, name);

        // What this would replace, looked up the way a reader does: by (domain, name). Reading
        // mem.playbooks[name] instead used to find ANOTHER domain's entry and then overwrite this
        // domain's verified playbook without so much as an archive copy.
        const existing = this.findPlaybook(domain, name);
        if (existing && statusOf(existing) === "verified") {
          // A proven playbook is never touched in place. The edit waits its turn as a candidate that
          // records, explicitly, which record it would replace.
          const targetKey = keyOf(mem.playbooks, existing)!;
          playbook.supersedes = targetKey;
          entryId = playbook.id;
          mem.playbooks[freeEditKey(mem.playbooks, targetKey, domain, name)] = playbook;
          note = "A verified playbook of this name exists and is untouched. This edit is stored as a candidate and replaces it only after two hub-confirmed runs in two sessions.";
        } else {
          // Nothing proven here: this draft simply takes the slot (its own, or a fresh one).
          const key = existing ? keyOf(mem.playbooks, existing)! : storageKey(mem.playbooks, domain, name);
          if (existing) playbook.supersedes = existing.supersedes; // an edit of a pending edit keeps its target
          mem.playbooks[key] = playbook;
          entryId = playbook.id;
          note = "Stored as an unverified candidate. It becomes a fast path after two hub-confirmed runs in two sessions (web_learn {action:'outcome'}).";
        }
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
    return {
      learned: true, action: params.action, domain, entryId,
      ...(params.action === "playbook" ? { status: "candidate" as SkillStatus } : {}),
      ...(ignored.length ? { argsIgnored: ignored } : {}),
      ...(note ? { note } : {}),
    };
  }

  /**
   * Finds a playbook of THIS domain by its id or its name. Ids are unique across the store (see uniqueId),
   * so an id match is unambiguous; a name is unique within a domain. Ids are tried first, because a caller
   * that named one playbook the same as another's id would otherwise silently steer outcomes to the wrong
   * record. Deprecated archives are skipped: only a live playbook can be reported on.
   */
  public findPlaybook(domain: string, key: string): ProceduralPlaybook | null {
    const wanted = key.trim();
    if (!wanted) return null;
    const d = this.normalizeDomain(domain);
    const mine = Object.values(this.load().playbooks).filter((pb) => this.normalizeDomain(pb.domain) === d && statusOf(pb) !== "deprecated");
    return mine.find((pb) => pb.id === wanted) ?? mine.find((pb) => pb.name === wanted) ?? null;
  }


  /**
   * Folds a reported execution into a playbook (see cognitive-skills.ts). `hubConfirmed` must come from the
   * hub having OBSERVED a verified success, never from the caller. A candidate that reaches verified
   * replaces the proven playbook it was an edit of, which is kept as deprecated.
   */
  public recordOutcome(params: { domain: string; playbook: string; success: boolean; session: string; hubConfirmed: boolean }): OutcomeResult & { playbook: string } {
    const mem = this.load();
    const pb = this.findPlaybook(params.domain, params.playbook);
    if (!pb) throw new Error(`no playbook "${params.playbook}" is stored for ${this.normalizeDomain(params.domain)}`);
    const now = new Date().toISOString();
    const result = applyOutcome(pb, { success: params.success, session: params.session, hubConfirmed: params.hubConfirmed, now });
    if (result.promoted && pb.supersedes) this.supersede(mem, pb, now);
    if (result.recorded) this.save();
    return { ...result, playbook: pb.name };
  }

  /**
   * A newly verified edit takes the place of the playbook it was an edit of, which is kept as a deprecated
   * archive rather than deleted. The target comes from pb.supersedes (hub-set) and must still be a live
   * playbook of the SAME domain: this used to be inferred by slicing a suffix off the name, so a caller
   * could name its playbook "flow~candidate" and evict an unrelated verified "flow" on another domain.
   */
  private supersede(mem: CognitiveMemoryData, pb: ProceduralPlaybook, now: string): void {
    const targetKey = pb.supersedes;
    delete pb.supersedes; // whatever happens below, it is no longer an edit of anything
    if (!targetKey) return;
    const old = mem.playbooks[targetKey];
    if (!old || old === pb) return; // already superseded by an earlier edit, or removed meanwhile
    if (this.normalizeDomain(old.domain) !== this.normalizeDomain(pb.domain)) {
      log("ERROR", "Refusing to supersede a playbook of another domain", { edit: pb.id, target: old.id });
      return;
    }
    if (statusOf(old) === "deprecated") return;

    mem.playbooks[targetKey] = { ...old, status: "deprecated", deprecatedAt: now, deprecatedReason: `superseded by ${pb.id}` };
    // Any other pending edit of the same target is now an edit of nothing in particular.
    for (const other of Object.values(mem.playbooks)) if (other !== pb && other.supersedes === targetKey) delete other.supersedes;
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
