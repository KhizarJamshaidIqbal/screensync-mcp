// ScreenSync Adolescent Identity & Adult Executive Cognition Engine (Architecture 10.0)
// Synthesizes developmental neuroscience milestones missing from Architectures 1.0-9.0:
// 1. Adolescent Synaptic Pruning (use-it-or-lose-it competitive playbook elimination, ages 12-18)
// 2. Infant Critical Periods & Sensitive Windows (experience-expectant plasticity gates)
// 3. Working Memory Digit Span Growth (Miller 7+-2 chunks -> adult chunking expertise)
// 4. Prefrontal Executive Functions (Miyake 2000: inhibition, shifting, updating)
// 5. Erikson Psychosocial Identity Stages (identity vs role confusion -> coherence)
// 6. Tulving Autonoetic Self-Awareness (remember/know recollection confidence)
// 7. Infant Error Detection & Social Referencing (ERN first-error capture, caregiver checks)
// 8. Adult Wisdom Calibration (Baltes: knowledge-rich + uncertainty-humble cognition)

export type EriksonStage =
  | "TRUST_VS_MISTRUST"          // 0-1: does this domain respond reliably at all?
  | "AUTONOMY_VS_SHAME"          // 1-3: first independent actions, shame on repeated failure
  | "INITIATIVE_VS_GUILT"        // 3-6: proposes own plans, guilt when they break things
  | "INDUSTRY_VS_INFERIORITY"    // 6-12: systematic skill building
  | "IDENTITY_VS_ROLE_CONFUSION" // 12-18: coherent domain identity or scattered confusion
  | "INTIMACY_VS_ISOLATION"      // 18-25: deep committed mastery of a few domains
  | "GENERATIVITY_VS_STAGNATION" // 25-50: teaches others (transfers playbooks) vs stagnation
  | "EGO_INTEGRITY_VS_DESPAIR";  // 50+: calm wisdom, accepts past burns as lessons

export interface CriticalWindow {
  id: string;
  opensAtAge: number;
  closesAtAge: number;
  bonusXpMultiplier: number; // learning inside the window sticks harder
  label: string;
}

export interface AdolescentProfile {
  domain: string;
  eriksonStage: EriksonStage;
  identityCoherence: number; // 0..1: do playbooks/probes form one coherent self-story?
  prunedPlaybooks: string[]; // eliminated by synaptic pruning
  digitSpanChunks: number;   // working memory capacity in chunks (2 infant -> 7 adult)
  executiveScore: { inhibition: number; shifting: number; updating: number }; // 0..1
  firstErrorSigned: boolean; // infant error-negativity signature captured at least once
  socialReferences: number;  // times it checked back with the human before a risky act
  wisdomScore: number;       // Baltes wisdom: high knowledge AND calibrated uncertainty
  updatedAt: string;
}

const CRITICAL_WINDOWS: CriticalWindow[] = [
  { id: "sensory_calibration", opensAtAge: 0.1, closesAtAge: 2.0, bonusXpMultiplier: 2.0, label: "Sensory motor calibration window (infancy)" },
  { id: "procedural_imprint", opensAtAge: 2.0, closesAtAge: 7.0, bonusXpMultiplier: 1.75, label: "Procedural imprinting window (early childhood)" },
  { id: "abstract_transfer", opensAtAge: 7.0, closesAtAge: 16.0, bonusXpMultiplier: 1.5, label: "Abstract rule & cross-domain transfer window (adolescence)" },
  { id: "expert_intuition", opensAtAge: 16.0, closesAtAge: 40.0, bonusXpMultiplier: 1.25, label: "Expert intuition crystallization window (adulthood)" },
];

function eriksonStageForAge(age: number): EriksonStage {
  if (age < 1) return "TRUST_VS_MISTRUST";
  if (age < 3) return "AUTONOMY_VS_SHAME";
  if (age < 6) return "INITIATIVE_VS_GUILT";
  if (age < 12) return "INDUSTRY_VS_INFERIORITY";
  if (age < 18) return "IDENTITY_VS_ROLE_CONFUSION";
  if (age < 25) return "INTIMACY_VS_ISOLATION";
  if (age < 50) return "GENERATIVITY_VS_STAGNATION";
  return "EGO_INTEGRITY_VS_DESPAIR";
}

function digitSpanForAge(age: number): number {
  if (age < 2) return 2;
  if (age < 5) return 3;
  if (age < 8) return 4;
  if (age < 12) return 5;
  if (age < 16) return 6;
  return 7;
}
export class AdolescentCognitionEngine {
  private profiles: Map<string, AdolescentProfile> = new Map();

  private getOrCreate(domain: string): AdolescentProfile {
    const clean = domain.toLowerCase().trim();
    let p = this.profiles.get(clean);
    if (!p) {
      p = {
        domain: clean,
        eriksonStage: "TRUST_VS_MISTRUST",
        identityCoherence: 0.1,
        prunedPlaybooks: [],
        digitSpanChunks: 2,
        executiveScore: { inhibition: 0.15, shifting: 0.1, updating: 0.1 },
        firstErrorSigned: false,
        socialReferences: 0,
        wisdomScore: 0.05,
        updatedAt: new Date().toISOString(),
      };
      this.profiles.set(clean, p);
    }
    return p;
  }

  /** 1. Adolescent synaptic pruning: eliminate weak/redundant playbooks so the strong myelinate. */
  public synapticPrune(domain: string, playbooks: Array<{ id: string; successCount: number; lastExecutedAt?: string }>): {
    domain: string; pruned: string[]; myelinated: string[]; pruningIntensity: number;
  } {
    const p = this.getOrCreate(domain);
    const now = Date.now();
    const pruned: string[] = [];
    const myelinated: string[] = [];
    for (const pb of playbooks) {
      const staleDays = pb.lastExecutedAt ? (now - new Date(pb.lastExecutedAt).getTime()) / 86400000 : 0;
      const isWeak = pb.successCount <= 1;
      // Only a *tracked* playbook can be judged stale — never prune a proven one just
      // because its last run was not timestamped (absence of data is not staleness).
      const isStale = pb.lastExecutedAt ? staleDays > 30 : false;
      if (isWeak || isStale) pruned.push(pb.id);
      else if (pb.successCount >= 5) myelinated.push(pb.id);
    }
    p.prunedPlaybooks = Array.from(new Set([...p.prunedPlaybooks, ...pruned]));
    p.identityCoherence = Math.min(1, p.identityCoherence + pruned.length * 0.05 + myelinated.length * 0.02);
    p.updatedAt = new Date().toISOString();
    return {
      domain: p.domain,
      pruned,
      myelinated,
      pruningIntensity: playbooks.length ? pruned.length / playbooks.length : 0,
    };
  }

  /** 2. Critical period gating: XP earned inside a sensitive window is amplified. */
  public criticalPeriodBoost(cognitiveAgeYears: number, baseXp: number): {
    activeWindow: CriticalWindow | null; effectiveXp: number; windowOpen: boolean;
  } {
    const w = CRITICAL_WINDOWS.find((w) => cognitiveAgeYears >= w.opensAtAge && cognitiveAgeYears < w.closesAtAge) || null;
    return { activeWindow: w, effectiveXp: w ? baseXp * w.bonusXpMultiplier : baseXp, windowOpen: Boolean(w) };
  }

  /** 3. Working-memory digit span from cognitive age: chunk budget for a single execution plan. */
  public workingMemorySpan(domain: string, cognitiveAgeYears: number): {
    digitSpanChunks: number; recommendedMaxStepsPerPlan: number; chunkingAdvice: string;
  } {
    const p = this.getOrCreate(domain);
    p.digitSpanChunks = digitSpanForAge(cognitiveAgeYears);
    p.updatedAt = new Date().toISOString();
    return {
      digitSpanChunks: p.digitSpanChunks,
      recommendedMaxStepsPerPlan: p.digitSpanChunks,
      chunkingAdvice:
        p.digitSpanChunks <= 3
          ? "Infant/toddler span: break every plan into <=3-step micro-chunks with verification between each."
          : p.digitSpanChunks <= 5
          ? "Child span: use <=5-step plans; insert an aria-snapshot checkpoint mid-plan."
          : "Adult span: 7+-2 chunks; group steps into named sub-routines (chunking) before executing long macros.",
    };
  }

  /** 4. Prefrontal executive battery (Miyake): inhibition, shifting, updating scored from telemetry. */
  public executiveFunctionBattery(domain: string, telemetry: {
    resistedDistractionClicks?: number; totalDistractions?: number;
    strategySwitchesAfterFailure?: number; failedAttempts?: number;
    stateRefreshCount?: number; actionCount?: number;
  }): { domain: string; executiveScore: AdolescentProfile["executiveScore"]; prefrontalMaturity: string } {
    const p = this.getOrCreate(domain);
    const inhibition = telemetry.totalDistractions
      ? (telemetry.resistedDistractionClicks || 0) / telemetry.totalDistractions : p.executiveScore.inhibition;
    const shifting = telemetry.failedAttempts
      ? Math.min(1, (telemetry.strategySwitchesAfterFailure || 0) / telemetry.failedAttempts) : p.executiveScore.shifting;
    const updating = telemetry.actionCount
      ? Math.min(1, (telemetry.stateRefreshCount || 0) / telemetry.actionCount) : p.executiveScore.updating;
    p.executiveScore = {
      inhibition: Math.max(p.executiveScore.inhibition, inhibition),
      shifting: Math.max(p.executiveScore.shifting, shifting),
      updating: Math.max(p.executiveScore.updating, updating),
    };
    const mean = (p.executiveScore.inhibition + p.executiveScore.shifting + p.executiveScore.updating) / 3;
    p.updatedAt = new Date().toISOString();
    return {
      domain: p.domain,
      executiveScore: p.executiveScore,
      prefrontalMaturity: mean < 0.3 ? "IMMATURE_CHILD" : mean < 0.6 ? "DEVELOPING_ADOLESCENT" : mean < 0.85 ? "ADULT_EXECUTIVE" : "SAGE_EXECUTIVE",
    };
  }

  /** 5. Erikson identity: reconcile developmental stage with coherence of learned knowledge. */
  public eriksonIdentity(domain: string, cognitiveAgeYears: number, knowledgePieces: number, contradictions: number): AdolescentProfile {
    const p = this.getOrCreate(domain);
    p.eriksonStage = eriksonStageForAge(cognitiveAgeYears);
    const coherence = knowledgePieces > 0 ? Math.max(0, Math.min(1, 1 - contradictions / Math.max(1, knowledgePieces))) : p.identityCoherence;
    p.identityCoherence = coherence; // current measured coherence wins: contradictions must lower it
    p.updatedAt = new Date().toISOString();
    return p;
  }

  /** 6. Tulving autonoetic consciousness: remember (relive, certain) vs know (familiar, uncertain). */
  public autonoeticTag(domain: string, episodeIds: string[], recallSource: "replay" | "semantic"): {
    domain: string; remember: string[]; know: string[]; autonoeticConfidence: number;
  } {
    const clean = domain.toLowerCase().trim();
    const remember = recallSource === "replay" ? episodeIds : [];
    const know = recallSource === "semantic" ? episodeIds : [];
    return { domain: clean, remember, know, autonoeticConfidence: recallSource === "replay" ? 0.95 : 0.65 };
  }

  /** 7. Infant error-negativity + social referencing: first error imprints; risky acts check the caregiver. */
  public infantErrorSignature(domain: string, event: {
    errorOccurred: boolean; riskyActionPlanned?: boolean;
  }): { ernSignature: string | null; socialReferencingAdvised: boolean; caregiverPrompt: string | null } {
    const p = this.getOrCreate(domain);
    let ernSignature: string | null = null;
    if (event.errorOccurred && !p.firstErrorSigned) {
      p.firstErrorSigned = true;
      ernSignature = `ERN_${p.domain}_${Date.now()}`; // error-related negativity: first mistake imprints deepest
    }
    const socialReferencingAdvised = Boolean(event.riskyActionPlanned)
      && p.eriksonStage !== "EGO_INTEGRITY_VS_DESPAIR"
      && p.eriksonStage !== "GENERATIVITY_VS_STAGNATION";
    if (socialReferencingAdvised) p.socialReferences += 1;
    p.updatedAt = new Date().toISOString();
    return {
      ernSignature,
      socialReferencingAdvised,
      caregiverPrompt: socialReferencingAdvised
        ? "Developmental stage advises social referencing: ask the human to glance at this risky action before executing (like a child checking a parent's face)."
        : null,
    };
  }

  /** 8. Baltes adult wisdom: deep knowledge PLUS humble uncertainty calibration. */
  public wisdomCalibration(domain: string, knowledgeDepth: number, statedConfidence: number, measuredAccuracy: number): {
    domain: string; wisdomScore: number; calibrationGap: number; verdict: string;
  } {
    const p = this.getOrCreate(domain);
    const calibrationGap = Math.abs(statedConfidence - measuredAccuracy);
    p.wisdomScore = Math.max(0, Math.min(1, knowledgeDepth * (1 - calibrationGap)));
    p.updatedAt = new Date().toISOString();
    return {
      domain: p.domain,
      wisdomScore: p.wisdomScore,
      calibrationGap,
      verdict:
        p.wisdomScore >= 0.8 ? "WISE_ADULT: knowledge-rich and well-calibrated"
        : statedConfidence > measuredAccuracy + 0.2 ? "ADOLESCENT_OVERCONFIDENCE: dial back confidence until accuracy catches up"
        : measuredAccuracy > statedConfidence + 0.2 ? "IMPOSTER_CHILD: accuracy is high; allow more autonomy"
        : "DEVELOPING: keep gathering evidence",
    };
  }
}

export const globalAdolescentEngine = new AdolescentCognitionEngine();
