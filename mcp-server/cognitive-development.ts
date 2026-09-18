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

export class CognitiveDevelopmentEngine {
  private domainMaturityMap: Map<string, DomainMaturity> = new Map();

  constructor() {
    this.seedDefaultMaturities();
  }

  private seedDefaultMaturities(): void {
    // x.com has high mastery
    this.domainMaturityMap.set("x.com", {
      domain: "x.com",
      stage: 5,
      stageName: "SOVEREIGN_SAGE_MASTER",
      humanAnalogy: "Master Adult / Sovereign Sage (Intuitive habituation, sub-3s atomic execution)",
      xp: 320,
      episodesCount: 22,
      successCount: 22,
      consecutiveFailures: 0,
      scaffolding: {
        requireHumanConfirm: false,
        perceptionPauseMs: 0,
        allowFastBranchSkip: true,
        allowSystem1Reflex: true,
        crossDomainTransferEnabled: true,
        maxExecutionTimeoutMs: 15000,
      },
      unlockedCapabilities: [
        "sub_second_atomic_execCommand",
        "fast_path_branch_skipping",
        "dom_self_healing",
        "cross_domain_export",
        "federated_lakehouse_sync",
      ],
      recentRegression: false,
      updatedAt: "2026-09-18T10:43:12.000Z",
    });
  }

  public getMaturity(domain: string): DomainMaturity {
    const cleanDomain = domain.toLowerCase().trim();
    const existing = this.domainMaturityMap.get(cleanDomain);
    if (existing) return existing;

    // Default Level 1: SENSORIMOTOR (Infant)
    const infant: DomainMaturity = {
      domain: cleanDomain,
      stage: 1,
      stageName: "SENSORIMOTOR_INFANT",
      humanAnalogy: "Infant (Sensorimotor: Basic exploratory reflex, maximum safety scaffolding)",
      xp: 0,
      episodesCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
      scaffolding: {
        requireHumanConfirm: true,
        perceptionPauseMs: 3000,
        allowFastBranchSkip: false,
        allowSystem1Reflex: false,
        crossDomainTransferEnabled: false,
        maxExecutionTimeoutMs: 30000,
      },
      unlockedCapabilities: ["sensory_probes", "raw_clicks", "perception_recording"],
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
      if (m.xp >= 200 && successRate >= 0.95 && m.episodesCount >= 15) {
        m.stage = 5;
        m.stageName = "SOVEREIGN_SAGE_MASTER";
        m.humanAnalogy = "Master Adult / Sovereign Sage (Full autonomy, atomic reflex, zero amnesia)";
        m.scaffolding = {
          requireHumanConfirm: false,
          perceptionPauseMs: 0,
          allowFastBranchSkip: true,
          allowSystem1Reflex: true,
          crossDomainTransferEnabled: true,
          maxExecutionTimeoutMs: 15000,
        };
      } else if (m.xp >= 100 && successRate >= 0.88 && m.episodesCount >= 7) {
        m.stage = 4;
        m.stageName = "FORMAL_OPERATIONAL_ADULT";
        m.humanAnalogy = "Adult (Formal Operational: Metacognitive confidence, cross-domain transfer)";
        m.scaffolding = {
          requireHumanConfirm: false,
          perceptionPauseMs: 500,
          allowFastBranchSkip: true,
          allowSystem1Reflex: true,
          crossDomainTransferEnabled: true,
          maxExecutionTimeoutMs: 20000,
        };
      } else if (m.xp >= 50 && successRate >= 0.75 && m.episodesCount >= 3) {
        m.stage = 3;
        m.stageName = "CONCRETE_OPERATIONAL_CHILD";
        m.humanAnalogy = "Child (Concrete Operational: Structured branch skipping, form contracts)";
        m.scaffolding = {
          requireHumanConfirm: false,
          perceptionPauseMs: 1500,
          allowFastBranchSkip: true,
          allowSystem1Reflex: false,
          crossDomainTransferEnabled: false,
          maxExecutionTimeoutMs: 25000,
        };
      } else if (m.xp >= 15) {
        m.stage = 2;
        m.stageName = "PREOPERATIONAL_TODDLER";
        m.humanAnalogy = "Toddler (Preoperational: Basic linear playback, pitfall imprinting)";
        m.scaffolding = {
          requireHumanConfirm: true,
          perceptionPauseMs: 2500,
          allowFastBranchSkip: false,
          allowSystem1Reflex: false,
          crossDomainTransferEnabled: false,
          maxExecutionTimeoutMs: 30000,
        };
      }
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
}

export const globalDevelopmentEngine = new CognitiveDevelopmentEngine();
