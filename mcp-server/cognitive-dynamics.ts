// ScreenSync Motivated Learning Dynamics & Prospective Memory Engine (Architecture 11.0)
// Synthesizes the memory-dynamics layer missing from Architectures 1.0-10.0:
// 1. Piaget Assimilation vs Accommodation (does new evidence fit the schema or rewrite it?)
// 2. Ebbinghaus Forgetting Curve + Spaced Repetition review scheduling
// 3. Operant Conditioning Reinforcement Schedules (continuous -> fixed -> variable interval)
// 4. Prospective Memory (Gollwitzer implementation intentions: "when event X, do Y")
// 5. Source Monitoring (Johnson: where did this fact come from? misattribution detection)
// 6. Proactive/Retroactive Interference between similar-domain playbooks
// 7. Dopaminergic Reward Prediction Error (Schultz: outcome - expectation modulates learning)
// 8. Sweller Cognitive Load Theory budgeting (intrinsic + extraneous + germane vs capacity)

import { asRecord, toMap } from "./cognitive-serial.js";

export interface ForgettingItem {
  id: string;
  learnedAt: string;
  reviewCount?: number;
  strength?: number; // memory stability S (higher = slower decay)
}

export interface ProspectiveIntention {
  id: string;
  domain: string;
  triggerEvent: string; // e.g. 'modal_appears', 'login_wall', 'toast_success'
  actionPlan: string;   // what to execute when the trigger fires
  registeredAt: string;
  fired: number;
}

export class CognitiveDynamicsEngine {
  private intentions: Map<string, ProspectiveIntention[]> = new Map();
  private sourceTrust: Map<string, Map<string, number>> = new Map();

  /** 1. Piaget equilibration: assimilate evidence into a schema or accommodate the schema to it. */
  public assimilateOrAccommodate(domain: string, observation: {
    matchesExistingSchema: boolean; schemaId?: string; noveltyScore?: number;
  }): { domain: string; process: string; schemaAction: string; confidenceDelta: number; advice: string } {
    const clean = domain.toLowerCase().trim();
    if (observation.matchesExistingSchema) {
      return {
        domain: clean, process: "ASSIMILATION", schemaAction: "reinforce", confidenceDelta: +0.05,
        advice: "Evidence fits the existing schema. Reinforce the playbook (LTP) — no rewrite needed.",
      };
    }
    const novelty = observation.noveltyScore ?? 0.5;
    if (novelty >= 0.7) {
      return {
        domain: clean, process: "ACCOMMODATION", schemaAction: "create", confidenceDelta: -0.1,
        advice: "Radically new structure detected. Create a NEW schema/playbook instead of distorting the old one (disequilibrium resolved by growth).",
      };
    }
    return {
      domain: clean, process: "ACCOMMODATION", schemaAction: "rewrite", confidenceDelta: -0.05,
      advice: "Partial mismatch. Rewrite the failing step/selector in the existing playbook (heal), then re-verify.",
    };
  }

  /** 2. Ebbinghaus forgetting curve R = e^(-t/S) with spaced-repetition review scheduling. */
  public forgettingCurve(domain: string, items: ForgettingItem[]): {
    domain: string; retained: Array<{ id: string; retention: number }>;
    reviewDue: string[]; nextReviewSchedule: Record<string, string>;
  } {
    const clean = domain.toLowerCase().trim();
    const now = Date.now();
    const intervalsDays = [1, 3, 7, 16, 35]; // expanding spaced repetition ladder
    const retained: Array<{ id: string; retention: number }> = [];
    const reviewDue: string[] = [];
    const nextReviewSchedule: Record<string, string> = {};
    for (const item of items) {
      const days = Math.max(0, (now - new Date(item.learnedAt).getTime()) / 86400000);
      const S = (item.strength ?? 1) * (1 + (item.reviewCount ?? 0)); // each review doubles stability base
      const retention = Math.exp(-days / Math.max(0.5, S));
      retained.push({ id: item.id, retention: Math.round(retention * 1000) / 1000 });
      if (retention < 0.6) reviewDue.push(item.id);
      const nextIdx = Math.min((item.reviewCount ?? 0), intervalsDays.length - 1);
      nextReviewSchedule[item.id] = new Date(now + intervalsDays[nextIdx] * 86400000).toISOString();
    }
    return { domain: clean, retained, reviewDue, nextReviewSchedule };
  }
  /** 3. Operant conditioning reinforcement schedule for practice cadence. */
  public reinforcementSchedule(domain: string, context: {
    successStreak: number; totalAttempts: number; hoursSinceLastPractice?: number;
  }): {
    domain: string; schedule: "CONTINUOUS" | "FIXED_INTERVAL" | "VARIABLE_INTERVAL";
    practiceDueNow: boolean; resistanceToExtinction: number; rationale: string;
  } {
    const clean = domain.toLowerCase().trim();
    const streak = context.successStreak;
    const attempts = context.totalAttempts;
    const hours = context.hoursSinceLastPractice ?? 999;
    if (attempts < 5 || streak < 3) {
      return {
        domain: clean, schedule: "CONTINUOUS", practiceDueNow: true, resistanceToExtinction: 0.2,
        rationale: "Early acquisition phase: reinforce EVERY attempt (like training a child — every success gets rewarded).",
      };
    }
    if (streak >= 3 && streak < 10) {
      return {
        domain: clean, schedule: "FIXED_INTERVAL", practiceDueNow: hours >= 24, resistanceToExtinction: 0.5,
        rationale: "Consolidation phase: daily spaced practice. Skill decays if untouched >24h.",
      };
    }
    return {
      domain: clean, schedule: "VARIABLE_INTERVAL", practiceDueNow: hours >= 72, resistanceToExtinction: 0.9,
      rationale: "Mastery phase: unpredictable-interval practice builds extinction-resistant habits (the skill survives long gaps).",
    };
  }

  /** 4. Prospective memory: register implementation intentions, or fire matching ones. */
  public prospectiveMemory(params: {
    domain: string; action: "register" | "check";
    intention?: { triggerEvent: string; actionPlan: string };
    observedEvent?: string;
  }): {
    domain: string; registered?: string; totalIntentions: number; fired?: ProspectiveIntention[];
  } {
    const clean = params.domain.toLowerCase().trim();
    const list = this.intentions.get(clean) || [];
    if (params.action === "register") {
      if (!params.intention) throw new Error("prospective register requires intention { triggerEvent, actionPlan }");
      const it: ProspectiveIntention = {
        id: `pros_${Date.now()}_${list.length}`,
        domain: clean,
        triggerEvent: params.intention.triggerEvent,
        actionPlan: params.intention.actionPlan,
        registeredAt: new Date().toISOString(),
        fired: 0,
      };
      list.push(it);
      if (list.length > 50) list.shift();
      this.intentions.set(clean, list);
      return { domain: clean, registered: it.id, totalIntentions: list.length };
    }
    const observed = (params.observedEvent || "").toLowerCase();
    const fired: ProspectiveIntention[] = [];
    for (const it of list) {
      if (observed && it.triggerEvent.toLowerCase().includes(observed)) {
        it.fired += 1;
        fired.push(it);
      }
    }
    this.intentions.set(clean, list);
    return { domain: clean, totalIntentions: list.length, fired };
  }
  /** 5. Source monitoring (Johnson): verify where each fact actually came from; detect misattribution. */
  public sourceMonitoring(domain: string, facts: Array<{
    id: string; claimedSource: string; actualEvidenceSource?: string;
  }>): {
    domain: string; verified: string[]; misattributed: Array<{ id: string; claimed: string; actual: string }>;
    sourceTrust: Record<string, number>;
  } {
    const clean = domain.toLowerCase().trim();
    const trust = this.sourceTrust.get(clean) || new Map<string, number>();
    const verified: string[] = [];
    const misattributed: Array<{ id: string; claimed: string; actual: string }> = [];
    for (const f of facts) {
      const actual = f.actualEvidenceSource || f.claimedSource;
      if (!trust.has(actual)) trust.set(actual, 0.5);
      if (f.actualEvidenceSource && f.actualEvidenceSource !== f.claimedSource) {
        misattributed.push({ id: f.id, claimed: f.claimedSource, actual: f.actualEvidenceSource });
        trust.set(f.claimedSource, Math.max(0, (trust.get(f.claimedSource) ?? 0.5) - 0.2));
        trust.set(actual, Math.min(1, (trust.get(actual) ?? 0.5) + 0.1));
      } else {
        verified.push(f.id);
        trust.set(actual, Math.min(1, (trust.get(actual) ?? 0.5) + 0.05));
      }
    }
    this.sourceTrust.set(clean, trust);
    return { domain: clean, verified, misattributed, sourceTrust: Object.fromEntries(trust) };
  }
  /** 6. Proactive/retroactive interference between similar-domain playbooks. */
  public interferenceCheck(domain: string, others: Array<{
    domain: string; sharedSelectors: number; conflictingSteps: number;
  }>): {
    domain: string; interferences: Array<{
      otherDomain: string; proactiveInterference: number; retroactiveInterference: number; advice: string;
    }>;
  } {
    const clean = domain.toLowerCase().trim();
    const interferences = others.map((o) => {
      const proactive = Math.min(1, o.sharedSelectors * 0.15);
      const retroactive = Math.min(1, o.conflictingSteps * 0.2);
      const advice =
        proactive > 0.6 || retroactive > 0.6
          ? `HIGH interference with ${o.domain}: namespace selectors per domain and re-run web_synaptic_pruning before executing.`
          : proactive > 0.3 || retroactive > 0.3
          ? `Moderate interference with ${o.domain}: add an explicit context probe (which site am I on?) before step 1.`
          : `Low interference with ${o.domain}: safe to transfer playbooks.`;
      return { otherDomain: o.domain, proactiveInterference: proactive, retroactiveInterference: retroactive, advice };
    });
    return { domain: clean, interferences };
  }

  /** 7. Dopaminergic reward prediction error (Schultz): outcome vs expectation sets the learning rate. */
  public rewardPredictionError(domain: string, signal: {
    expectedReward: number; actualReward: number;
  }): {
    domain: string; rpe: number; dopamineState: string; learningRateBoost: number; advice: string;
  } {
    const clean = domain.toLowerCase().trim();
    const rpe = signal.actualReward - signal.expectedReward;
    const dopamineState =
      rpe > 0.3 ? "PHASIC_BURST_POSITIVE_SURPRISE"
      : rpe < -0.3 ? "PHASIC_DIP_NEGATIVE_SURPRISE"
      : "TONIC_BASELINE_EXPECTED";
    const learningRateBoost = Math.min(2, Math.max(0.5, 1 + Math.abs(rpe)));
    const advice =
      rpe > 0.3 ? "Positive surprise: consolidate hard (LTP) — the outcome beat expectations; capture WHY."
      : rpe < -0.3 ? "Negative surprise: run web_learn pitfall NOW — the expectation violated reality; this is the richest learning moment."
      : "Outcome matched prediction: no new learning signal, maintain the current playbook.";
    return { domain: clean, rpe, dopamineState, learningRateBoost, advice };
  }

  /** 8. Sweller Cognitive Load Theory: budget intrinsic + extraneous + germane load against capacity. */
  public cognitiveLoadBudget(domain: string, load: {
    intrinsic: number; extraneous: number; germane: number; capacityChunks?: number;
  }): {
    domain: string; totalLoad: number; capacity: number; overloaded: boolean;
    verdict: string; simplificationAdvice: string;
  } {
    const clean = domain.toLowerCase().trim();
    const capacity = load.capacityChunks ?? 7;
    const total = load.intrinsic + load.extraneous + load.germane;
    const overloaded = total > capacity;
    const verdict = overloaded
      ? "COGNITIVE_OVERLOAD"
      : load.germane > capacity * 0.5 ? "OPTIMAL_LEARNING_ZONE"
      : load.extraneous > capacity * 0.3 ? "EXTRANEOUS_NOISE_HIGH"
      : "COMFORTABLE";
    const simplificationAdvice = overloaded
      ? "Split the plan into smaller chunks (see web_working_memory_span), strip decorative DOM noise (extraneous), and automate the routine sub-steps first."
      : load.extraneous > capacity * 0.3
      ? "Reduce extraneous load: use web_page_digest or web_reader_mode before reasoning over raw DOM."
      : "Load within budget: spend remaining capacity on germane learning (schema building).";
    return { domain: clean, totalLoad: total, capacity, overloaded, verdict, simplificationAdvice };
  }

  /** Durable state (see cognitive-persistence.ts). */
  public snapshotState(): unknown {
    return {
      intentions: [...this.intentions.entries()],
      sourceTrust: [...this.sourceTrust.entries()].map(([domain, trust]) => [domain, [...trust.entries()]]),
    };
  }

  public restoreState(raw: unknown): void {
    const s = asRecord(raw, "dynamics");
    const intentions = toMap<ProspectiveIntention[]>(s.intentions, "dynamics.intentions");
    const sourceTrust = new Map<string, Map<string, number>>();
    for (const [domain, entries] of toMap<Array<[string, number]>>(s.sourceTrust, "dynamics.sourceTrust")) {
      const inner = new Map<string, number>();
      for (const e of entries) {
        if (!Array.isArray(e) || typeof e[0] !== "string" || typeof e[1] !== "number") {
          throw new Error("dynamics.sourceTrust: malformed trust entry");
        }
        inner.set(e[0], e[1]);
      }
      sourceTrust.set(domain, inner);
    }
    this.intentions = intentions;
    this.sourceTrust = sourceTrust;
  }
}

export const globalDynamicsEngine = new CognitiveDynamicsEngine();
