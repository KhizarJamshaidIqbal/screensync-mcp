// ScreenSync Developmental Epistemology & Recognition-Primed Decision Engine (Architecture 7.0)
// Synthesizes:
// 1. Piagetian Object Permanence (Spatial Tracking & Occlusion Resolution)
// 2. Theory of Mind (ToM) & Anti-Bot Behavioral Cadence Projection
// 3. Cognitive Reversibility & Transactional Undo (accidental_data_loss_prevention)
// 4. Gary Klein's Recognition-Primed Decision (RPD) Prototype Archetypes

import { asRecord, capTail, toMap } from "./cognitive-serial.js";

export type WebPageArchetype =
  | "ARCHETYPE_RICH_FEED"
  | "ARCHETYPE_DATA_TABLE"
  | "ARCHETYPE_MULTI_STEP_WIZARD"
  | "ARCHETYPE_DASHBOARD_ANALYTICS"
  | "ARCHETYPE_SETTINGS_ADMIN"
  | "ARCHETYPE_AUTH_CHECKPOINT"
  | "ARCHETYPE_GENERIC_DOCUMENT";

export interface ArchetypeStrategy {
  archetype: WebPageArchetype;
  confidence: number;
  recommendedInputMethod: "execCommand" | "direct_click" | "form_change";
  recommendedSensoryRateMs: number;
  safetyProfile: "high_risk_destructive" | "medium_transactional" | "low_exploratory";
  invariants: string[];
}

export interface SpatialElementMemory {
  selector: string;
  lastSeenRect: { top: number; left: number; width: number; height: number };
  containerSelector?: string;
  scrollOffsetWhenSeen: { x: number; y: number };
  observedAt: string;
}

export interface ReversibilityAssessment {
  action: string;
  category: "REVERSIBLE" | "CONDITIONAL_REVERSIBLE" | "IRREVERSIBLE_DESTRUCTIVE";
  riskScore: number; // 0.0 to 1.0
  inverseAction?: {
    tool: string;
    args: Record<string, unknown>;
    description: string;
  };
  requiresExplicitConsent: boolean;
}

export class CognitiveRpdEngine {
  private spatialMemoryMap: Map<string, SpatialElementMemory[]> = new Map();

  /**
   * 1. Object Permanence: Register an observed element's spatial footprint
   */
  public registerSpatialLocation(domain: string, element: SpatialElementMemory): void {
    const clean = domain.toLowerCase().trim();
    const existing = this.spatialMemoryMap.get(clean) || [];
    const index = existing.findIndex((e) => e.selector === element.selector);
    if (index >= 0) {
      existing[index] = element;
    } else {
      existing.push(element);
    }
    this.spatialMemoryMap.set(clean, existing);
  }

  /**
   * 1. Object Permanence: Resolve offscreen or occluded element location
   */
  public resolveOffscreenElement(domain: string, selector: string, currentViewport: { width: number; height: number; scrollX: number; scrollY: number }): {
    foundInPermanenceMemory: boolean;
    recommendedScrollVector?: { deltaX: number; deltaY: number };
    approximateLocation?: { top: number; left: number };
    message: string;
  } {
    const clean = domain.toLowerCase().trim();
    const elements = this.spatialMemoryMap.get(clean) || [];
    const match = elements.find((e) => e.selector === selector);

    if (!match) {
      return {
        foundInPermanenceMemory: false,
        message: "Element has not been previously observed in this domain's spatial permanence memory.",
      };
    }

    const deltaY = match.lastSeenRect.top - currentViewport.scrollY;
    const deltaX = match.lastSeenRect.left - currentViewport.scrollX;

    return {
      foundInPermanenceMemory: true,
      recommendedScrollVector: { deltaX, deltaY },
      approximateLocation: { top: match.lastSeenRect.top, left: match.lastSeenRect.left },
      message: `Object permanence active: ${selector} was previously recorded at top:${match.lastSeenRect.top}px. Scroll by deltaY:${deltaY}px to restore to sensory field.`,
    };
  }

  /**
   * 2. Theory of Mind: Evaluate server suspicion and calculate natural humanized typing/clicking cadence
   */
  public evaluateTheoryOfMind(params: {
    domain: string;
    actionCountInLastMinute: number;
    hasCaptchaOrWafDetected: boolean;
    averageLatencyMs?: number;
  }): {
    suspicionScore: number;
    threatAssessment: "benign" | "elevated_monitoring" | "challenge_imminent";
    recommendedKeystrokeDelayMs: { mean: number; stdDev: number; punctuationBonusMs: number };
    recommendedMouseCurve: "direct_linear" | "bezier_humanized" | "hesitation_jitter";
  } {
    let suspicion = 0.1;
    if (params.actionCountInLastMinute > 40) suspicion += 0.4;
    if (params.actionCountInLastMinute > 80) suspicion += 0.3;
    if (params.hasCaptchaOrWafDetected) suspicion += 0.4;
    suspicion = Math.min(1.0, Number(suspicion.toFixed(2)));

    const threatAssessment = suspicion >= 0.7
      ? "challenge_imminent"
      : suspicion >= 0.4
      ? "elevated_monitoring"
      : "benign";

    const recommendedKeystrokeDelayMs = threatAssessment === "challenge_imminent"
      ? { mean: 140, stdDev: 45, punctuationBonusMs: 300 }
      : threatAssessment === "elevated_monitoring"
      ? { mean: 95, stdDev: 25, punctuationBonusMs: 180 }
      : { mean: 65, stdDev: 15, punctuationBonusMs: 90 };

    const recommendedMouseCurve = threatAssessment === "challenge_imminent"
      ? "hesitation_jitter"
      : threatAssessment === "elevated_monitoring"
      ? "bezier_humanized"
      : "direct_linear";

    return {
      suspicionScore: suspicion,
      threatAssessment,
      recommendedKeystrokeDelayMs,
      recommendedMouseCurve,
    };
  }

  /**
   * 3. Cognitive Reversibility & Transactional Undo
   * Classifies actions into Reversible vs Destructive (Inspired by accidental_data_loss_prevention)
   */
  public assessReversibility(params: {
    tool: string;
    args?: Record<string, unknown>;
    targetSelector?: string;
  }): ReversibilityAssessment {
    const tool = params.tool;
    const selector = String(params.targetSelector || (params.args && params.args.selector) || "").toLowerCase();

    // High-risk destructive detection
    const isDestructive =
      selector.includes("delete") ||
      selector.includes("remove") ||
      selector.includes("purge") ||
      selector.includes("destroy") ||
      selector.includes("discard") ||
      selector.includes("cancel-account");

    if (isDestructive) {
      return {
        action: `${tool} on ${selector}`,
        category: "IRREVERSIBLE_DESTRUCTIVE",
        riskScore: 0.95,
        requiresExplicitConsent: true,
      };
    }

    if (tool === "web_fill" || tool === "web_type") {
      const fieldSelector = String((params.args && params.args.selector) || selector);
      return {
        action: `${tool} on ${fieldSelector}`,
        category: "REVERSIBLE",
        riskScore: 0.15,
        requiresExplicitConsent: false,
        inverseAction: {
          tool: "web_key",
          args: { key: "z", ctrl: true },
          description: "Press Ctrl+Z to undo text entry",
        },
      };
    }

    if (tool === "web_check") {
      return {
        action: `${tool} on ${selector}`,
        category: "REVERSIBLE",
        riskScore: 0.1,
        requiresExplicitConsent: false,
        inverseAction: {
          tool: "web_check",
          args: { selector, checked: false },
          description: "Uncheck checkbox to restore initial state",
        },
      };
    }

    return {
      action: `${tool}`,
      category: "CONDITIONAL_REVERSIBLE",
      riskScore: 0.35,
      requiresExplicitConsent: false,
    };
  }

  /**
   * 4. Recognition-Primed Decision (RPD): Instant Page Archetype Classification
   */
  public classifyPageArchetype(params: {
    url: string;
    domSignature?: {
      hasTable?: boolean;
      hasInfiniteScroll?: boolean;
      hasContentEditable?: boolean;
      hasStepper?: boolean;
      hasCharts?: boolean;
      hasLoginForm?: boolean;
    };
  }): ArchetypeStrategy {
    const url = params.url.toLowerCase();
    const sig = params.domSignature || {};

    if (sig.hasLoginForm || url.includes("login") || url.includes("signin") || url.includes("auth")) {
      return {
        archetype: "ARCHETYPE_AUTH_CHECKPOINT",
        confidence: 0.95,
        recommendedInputMethod: "direct_click",
        recommendedSensoryRateMs: 2000,
        safetyProfile: "medium_transactional",
        invariants: ["Never cache passwords or 2FA codes", "Check for bot challenge before entering credentials"],
      };
    }

    if (sig.hasInfiniteScroll || sig.hasContentEditable || url.includes("x.com") || url.includes("threads") || url.includes("feed")) {
      return {
        archetype: "ARCHETYPE_RICH_FEED",
        confidence: 0.92,
        recommendedInputMethod: "execCommand",
        recommendedSensoryRateMs: 500,
        safetyProfile: "low_exploratory",
        invariants: ["Use native input events for contenteditable", "Avoid blind infinite scrolls"],
      };
    }

    if (sig.hasTable || url.includes("table") || url.includes("list") || url.includes("insights")) {
      return {
        archetype: "ARCHETYPE_DATA_TABLE",
        confidence: 0.88,
        recommendedInputMethod: "direct_click",
        recommendedSensoryRateMs: 800,
        safetyProfile: "low_exploratory",
        invariants: ["Extract table via web_table_extract", "Verify pagination offset"],
      };
    }

    if (sig.hasStepper || url.includes("wizard") || url.includes("setup") || url.includes("checkout")) {
      return {
        archetype: "ARCHETYPE_MULTI_STEP_WIZARD",
        confidence: 0.90,
        recommendedInputMethod: "form_change",
        recommendedSensoryRateMs: 1200,
        safetyProfile: "medium_transactional",
        invariants: ["Verify form data contract with web_contract_check", "Confirm stepper step before navigation"],
      };
    }

    if (sig.hasCharts || url.includes("dashboard") || url.includes("analytics")) {
      return {
        archetype: "ARCHETYPE_DASHBOARD_ANALYTICS",
        confidence: 0.87,
        recommendedInputMethod: "direct_click",
        recommendedSensoryRateMs: 1500,
        safetyProfile: "low_exploratory",
        invariants: ["Wait for SVG/Canvas chart render", "Check date range filter"],
      };
    }

    return {
      archetype: "ARCHETYPE_GENERIC_DOCUMENT",
      confidence: 0.70,
      recommendedInputMethod: "direct_click",
      recommendedSensoryRateMs: 1000,
      safetyProfile: "low_exploratory",
      invariants: ["Use VOM AX tree for robust element discovery"],
    };
  }

  /** Durable state (see cognitive-persistence.ts). */
  public snapshotState(): unknown {
    return {
      spatialMemoryMap: [...this.spatialMemoryMap.entries()].map(([domain, list]) => [domain, capTail(list, 500)]),
    };
  }

  public restoreState(raw: unknown): void {
    const s = asRecord(raw, "rpd");
    const spatialMemoryMap = toMap<SpatialElementMemory[]>(s.spatialMemoryMap, "rpd.spatialMemoryMap");
    this.spatialMemoryMap = spatialMemoryMap;
  }
}

export const globalRpdEngine = new CognitiveRpdEngine();
