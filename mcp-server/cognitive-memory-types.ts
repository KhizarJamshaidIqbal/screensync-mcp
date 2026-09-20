// ScreenSync Cognitive Memory - the shape of what is stored. Types only: no runtime code lives here.
//
// Split out of cognitive-memory.ts so that file keeps to one job (loading, saving and the operations on
// the store) and stays inside the repo's 500-line limit. cognitive-memory.ts re-exports every one of
// these, so nothing that imports them from there has to change.

import type { Provenance, SkillStatus, Verification } from "./cognitive-skills.js";
import type { Reflection } from "./cognitive-reflection.js";

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
  /**
   * Branches hygiene took off an UNPROVEN draft because no probe checks their signal. Kept here, not
   * discarded: a branch is hand-written recovery logic, and a caller can supply its signal directly, so
   * "nothing probes it" is a hint, not proof it is dead. Never read by recall.
   */
  prunedBranches?: PlaybookBranch[];
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
  /**
   * Ids of duplicate pitfalls merged INTO this one. Episodes reference a pitfall by id, so dropping a
   * duplicate's id outright would orphan every episode that cited it.
   */
  mergedFrom?: string[];
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
  /**
   * How the hub classified this run (cognitive-spine-observer.ts). "neutral" means a refusal or outage
   * that says nothing about the agent or the domain - the permission layer declining, the human's
   * confirmation pending, no browser attached. Reflection ignores those: counting them as failures
   * taught the hub that a domain was unreliable when the user had simply not granted permission.
   */
  outcome?: "verified" | "weak" | "reported" | "failure" | "breaker" | "neutral";
}

export interface CognitiveMemoryData {
  version: "1.3.0";
  updatedAt: string;
  domains: Record<string, DomainSemanticMemory>;
  playbooks: Record<string, ProceduralPlaybook>;
  pitfalls: Record<string, DomainPitfall[]>;
  episodes: ExecutionEpisode[];
  /** What the hub has worked out for itself, per domain (cognitive-reflection.ts). */
  reflections: Record<string, Reflection[]>;
}
