// ScreenSync Neuro-Developmental Memory Stages (Architecture 5.0)
// Synthesizes Piaget's Cognitive Development Stages & Vygotsky's Zone of Proximal Development (ZPD)
// Inspired by ML Best Practices continuous drift monitoring and model maturity progression.

export type StageName =
  | "SENSORIMOTOR_INFANT"
  | "PREOPERATIONAL_TODDLER"
  | "CONCRETE_OPERATIONAL_CHILD"
  | "FORMAL_OPERATIONAL_ADULT"
  | "SOVEREIGN_SAGE_MASTER";

export interface StageScaffolding {
  requireHumanConfirm: boolean;
  perceptionPauseMs: number;
  allowFastBranchSkip: boolean;
  allowSystem1Reflex: boolean;
  crossDomainTransferEnabled: boolean;
  maxExecutionTimeoutMs: number;
}

export interface DomainMaturity {
  domain: string;
  stage: number;
  stageName: StageName;
  humanAnalogy: string;
  xp: number;
  episodesCount: number;
  successCount: number;
  consecutiveFailures: number;
  scaffolding: StageScaffolding;
  unlockedCapabilities: string[];
  recentRegression: boolean;
  updatedAt: string;
}

interface StageDef {
  name: StageName;
  analogy: string;
  scaffolding: StageScaffolding;
  capabilities: string[];
}

/** The one place a stage's name, autonomy limits and unlocked capabilities are defined (index = stage - 1). */
const STAGES: StageDef[] = [
  {
    name: "SENSORIMOTOR_INFANT",
    analogy: "Infant (Sensorimotor: Basic exploratory reflex, maximum safety scaffolding)",
    scaffolding: { requireHumanConfirm: true, perceptionPauseMs: 3000, allowFastBranchSkip: false, allowSystem1Reflex: false, crossDomainTransferEnabled: false, maxExecutionTimeoutMs: 30000 },
    capabilities: ["sensory_probes", "raw_clicks", "perception_recording"],
  },
  {
    name: "PREOPERATIONAL_TODDLER",
    analogy: "Toddler (Preoperational: Basic linear playback, pitfall imprinting)",
    scaffolding: { requireHumanConfirm: true, perceptionPauseMs: 2500, allowFastBranchSkip: false, allowSystem1Reflex: false, crossDomainTransferEnabled: false, maxExecutionTimeoutMs: 30000 },
    capabilities: ["sensory_probes", "raw_clicks", "perception_recording", "linear_playback", "pitfall_imprinting"],
  },
  {
    name: "CONCRETE_OPERATIONAL_CHILD",
    analogy: "Child (Concrete Operational: Structured branch skipping, form contracts)",
    scaffolding: { requireHumanConfirm: false, perceptionPauseMs: 1500, allowFastBranchSkip: true, allowSystem1Reflex: false, crossDomainTransferEnabled: false, maxExecutionTimeoutMs: 25000 },
    capabilities: ["sensory_probes", "raw_clicks", "perception_recording", "linear_playback", "pitfall_imprinting", "fast_path_branch_skipping", "form_contracts"],
  },
  {
    name: "FORMAL_OPERATIONAL_ADULT",
    analogy: "Adult (Formal Operational: Metacognitive confidence, cross-domain transfer)",
    scaffolding: { requireHumanConfirm: false, perceptionPauseMs: 500, allowFastBranchSkip: true, allowSystem1Reflex: true, crossDomainTransferEnabled: true, maxExecutionTimeoutMs: 20000 },
    capabilities: ["sensory_probes", "raw_clicks", "perception_recording", "linear_playback", "pitfall_imprinting", "fast_path_branch_skipping", "form_contracts", "dom_self_healing", "cross_domain_transfer"],
  },
  {
    name: "SOVEREIGN_SAGE_MASTER",
    analogy: "Master Adult / Sovereign Sage (Full autonomy, atomic reflex, zero amnesia)",
    scaffolding: { requireHumanConfirm: false, perceptionPauseMs: 0, allowFastBranchSkip: true, allowSystem1Reflex: true, crossDomainTransferEnabled: true, maxExecutionTimeoutMs: 15000 },
    capabilities: ["sub_second_atomic_execCommand", "fast_path_branch_skipping", "dom_self_healing", "cross_domain_export", "federated_lakehouse_sync"],
  },
];

/** The stage-derived fields of a DomainMaturity (fresh copies, safe to assign). */
function stageFields(stage: number): Pick<DomainMaturity, "stage" | "stageName" | "humanAnalogy" | "scaffolding" | "unlockedCapabilities"> {
  const level = Math.max(1, Math.min(5, Math.round(stage)));
  const def = STAGES[level - 1];
  return { stage: level, stageName: def.name, humanAnalogy: def.analogy, scaffolding: { ...def.scaffolding }, unlockedCapabilities: [...def.capabilities] };
}

export class CognitiveDevelopmentEngine {
  private domainMaturityMap: Map<string, DomainMaturity> = new Map();

  public getMaturity(domain: string): DomainMaturity {
    const cleanDomain = domain.toLowerCase().trim();
    const existing = this.domainMaturityMap.get(cleanDomain);
    if (existing) return existing;

    // Default Level 1: SENSORIMOTOR (Infant)
    const infant: DomainMaturity = {
      domain: cleanDomain,
      ...stageFields(1),
      xp: 0,
      episodesCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
      recentRegression: false,
      updatedAt: new Date().toISOString(),
    };

    this.domainMaturityMap.set(cleanDomain, infant);
    return infant;
  }

  public recordEpisode(params: {
    domain: string;
    success: boolean;
    durationMs?: number;
    drift?: boolean;
  }): DomainMaturity {
    const m = this.getMaturity(params.domain);
    m.episodesCount++;

    if (params.success) {
      m.successCount++;
      m.consecutiveFailures = 0;
      m.recentRegression = false;
      let earnedXp = 15;
      if (params.durationMs && params.durationMs < 5000) earnedXp += 10;
      if (!params.drift) earnedXp += 5;
      m.xp += earnedXp;

      // Check Level Up criteria
      const successRate = m.successCount / m.episodesCount;
      let earned: number | null = null;
      if (m.xp >= 200 && successRate >= 0.95 && m.episodesCount >= 15) earned = 5;
      else if (m.xp >= 100 && successRate >= 0.88 && m.episodesCount >= 7) earned = 4;
      else if (m.xp >= 50 && successRate >= 0.75 && m.episodesCount >= 3) earned = 3;
      else if (m.xp >= 15) earned = 2;
      if (earned !== null) Object.assign(m, stageFields(earned));
    } else {
      m.consecutiveFailures++;
      // Stress Regression under repeated failure (Down-level autonomy to protect user data)
      if (m.consecutiveFailures >= 2 && m.stage > 2) {
        m.stage -= 1;
        m.recentRegression = true;
        m.scaffolding.requireHumanConfirm = true;
        m.scaffolding.allowSystem1Reflex = false;
        m.scaffolding.perceptionPauseMs = Math.max(m.scaffolding.perceptionPauseMs, 2000);
      }
    }

    m.updatedAt = new Date().toISOString();
    return m;
  }

  public overrideStage(domain: string, stage: number): DomainMaturity {
    const m = this.getMaturity(domain);
    m.stage = Math.max(1, Math.min(5, stage));
    m.updatedAt = new Date().toISOString();
    return m;
  }

  /**
   * The spine (cognitive-spine.ts) owns a domain's level; this engine only DISPLAYS it. Sets the stage
   * and its scaffolding from that level and copies the evidence counters, so every level tool agrees.
   */
  public applySpine(domain: string, view: { level: number; xp: number; episodes: number; successes: number; consecutiveFailures: number; regressed: boolean }): DomainMaturity {
    const m = this.getMaturity(domain);
    Object.assign(m, stageFields(view.level));
    m.xp = view.xp;
    m.episodesCount = view.episodes;
    m.successCount = view.successes;
    m.consecutiveFailures = view.consecutiveFailures;
    m.recentRegression = view.regressed;
    m.updatedAt = new Date().toISOString();
    return m;
  }
}

export const globalDevelopmentEngine = new CognitiveDevelopmentEngine();
