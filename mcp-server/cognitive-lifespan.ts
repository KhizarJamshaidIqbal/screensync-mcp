// ScreenSync Lifespan Cognitive Ontogeny & Epistemic Property Graph 2.0 Engine (Architecture 9.0)
// Synthesizes:
// 1. Lifespan Cognitive Development (Infant Sensorimotor -> Child Scaffold -> Youth Inference -> Adult RPD -> Sovereign Sage)
// 2. BigQuery/Property Graph GQL Pattern Matching & Topological Path Optimization (data-agent-kit-plugin parity)
// 3. Infant Motor Babbling & DOM Physical Calibration
// 4. Gentner's Structure-Mapping Analogical Metaphoric Transfer

import { asRecord, toMap } from "./cognitive-serial.js";
import { rekeyByDomain } from "./cognitive-domain.js";

export type LifespanStage =
  | "LEVEL_1_INFANT_REFLEX"
  | "LEVEL_2_CHILD_SCAFFOLD"
  | "LEVEL_3_YOUTH_INFERENCE"
  | "LEVEL_4_ADULT_RPD"
  | "LEVEL_5_SAGE_SYNTHESIS";

export interface LifespanProfile {
  domain: string;
  stage: LifespanStage;
  cognitiveAgeYears: number; // 0.1 (infant) to 50.0 (sage)
  nociceptiveBurns: number; // hot-stove error penalties
  successfulMilestones: number;
  scaffoldingLevel: "MAXIMAL_INFANT" | "GUIDED_CHILD" | "COLLABORATIVE_YOUTH" | "AUTONOMOUS_ADULT" | "SOVEREIGN_SAGE";
  parameters: {
    deliberatePauseMs: number;
    requireParentalConsent: boolean;
    allowMotorMacros: boolean;
    theoryOfMindActive: boolean;
    graphReasoningActive: boolean;
  };
}

export interface GraphPatternQuery {
  startNodeId: string;
  targetNodeType?: string;
  targetNodeId?: string;
  relationshipTypes?: string[];
  maxDepth?: number;
}

export interface MotorCalibrationProfile {
  domain: string;
  recommendedDispatchType: "pointer_synthetic" | "direct_mouse" | "native_execCommand";
  inputLagMs: number;
  dprScale: number;
  coordinateAccuracy: number; // 0.0 to 1.0
  verifiedAt: string;
}

export interface MetaphoricMapping {
  sourceDomain: string;
  targetDomain: string;
  similarityScore: number;
  transferredPlaybooks: string[];
  componentAnalogies: Array<{ sourceRole: string; targetSelector: string }>;
}

/** Stage, scaffolding and parameters per level (index = level - 1): the one definition of them. */
const LEVELS: Array<Pick<LifespanProfile, "stage" | "scaffoldingLevel" | "parameters">> = [
  { stage: "LEVEL_1_INFANT_REFLEX", scaffoldingLevel: "MAXIMAL_INFANT", parameters: { deliberatePauseMs: 2500, requireParentalConsent: true, allowMotorMacros: false, theoryOfMindActive: false, graphReasoningActive: false } },
  { stage: "LEVEL_2_CHILD_SCAFFOLD", scaffoldingLevel: "GUIDED_CHILD", parameters: { deliberatePauseMs: 1200, requireParentalConsent: true, allowMotorMacros: false, theoryOfMindActive: false, graphReasoningActive: false } },
  { stage: "LEVEL_3_YOUTH_INFERENCE", scaffoldingLevel: "COLLABORATIVE_YOUTH", parameters: { deliberatePauseMs: 600, requireParentalConsent: false, allowMotorMacros: true, theoryOfMindActive: true, graphReasoningActive: false } },
  { stage: "LEVEL_4_ADULT_RPD", scaffoldingLevel: "AUTONOMOUS_ADULT", parameters: { deliberatePauseMs: 150, requireParentalConsent: false, allowMotorMacros: true, theoryOfMindActive: true, graphReasoningActive: true } },
  { stage: "LEVEL_5_SAGE_SYNTHESIS", scaffoldingLevel: "SOVEREIGN_SAGE", parameters: { deliberatePauseMs: 50, requireParentalConsent: false, allowMotorMacros: true, theoryOfMindActive: true, graphReasoningActive: true } },
];

function setLevel(profile: LifespanProfile, level: number): void {
  const def = LEVELS[Math.max(1, Math.min(5, level)) - 1];
  profile.stage = def.stage;
  profile.scaffoldingLevel = def.scaffoldingLevel;
  profile.parameters = { ...def.parameters };
}

export class CognitiveLifespanEngine {
  private lifespanProfiles: Map<string, LifespanProfile> = new Map();
  private motorProfiles: Map<string, MotorCalibrationProfile> = new Map();
  private metaphoricMappings: Map<string, MetaphoricMapping[]> = new Map();

  /**
   * 1. Lifespan Cognitive Ontogeny: Evaluate or advance domain developmental lifespan
   */
  public evaluateLifespan(domain: string, event?: { outcome: "success" | "burn"; milestoneName?: string }): LifespanProfile {
    const clean = domain.toLowerCase().trim();
    let profile = this.lifespanProfiles.get(clean);

    if (!profile) {
      profile = {
        domain: clean,
        cognitiveAgeYears: 0.5,
        nociceptiveBurns: 0,
        successfulMilestones: 0,
        ...LEVELS[0],
        parameters: { ...LEVELS[0].parameters },
      };
      this.lifespanProfiles.set(clean, profile);
    }

    if (event) {
      if (event.outcome === "success") {
        profile.successfulMilestones++;
        profile.cognitiveAgeYears = Math.min(50.0, Number((profile.cognitiveAgeYears + 1.2).toFixed(1)));
      } else if (event.outcome === "burn") {
        profile.nociceptiveBurns++;
        // Painful regression: decreases age temporarily, heightens scaffolding
        profile.cognitiveAgeYears = Math.max(0.2, Number((profile.cognitiveAgeYears - 3.5).toFixed(1)));
      }

      // Re-evaluate stage and Vygotskian scaffolding
      const age = profile.cognitiveAgeYears;
      let level = 1;
      if (age >= 35.0 && profile.nociceptiveBurns < 4) level = 5;
      else if (age >= 18.0 && profile.nociceptiveBurns < 8) level = 4;
      else if (age >= 7.0) level = 3;
      else if (age >= 2.0) level = 2;
      setLevel(profile, level);
    }

    return profile;
  }

  /**
   * The spine owns a domain's level; this engine only DISPLAYS it. Sets the stage and scaffolding from
   * that level (not from the age, so a burn count cannot make the two disagree) and copies the evidence.
   */
  public applySpine(domain: string, view: { level: number; ageYears: number; milestones: number; burns: number }): LifespanProfile {
    const profile = this.evaluateLifespan(domain);
    profile.cognitiveAgeYears = view.ageYears;
    profile.successfulMilestones = view.milestones;
    profile.nociceptiveBurns = view.burns;
    setLevel(profile, view.level);
    return profile;
  }

  /**
   * 2. BigQuery/Property Graph GQL Pattern Matcher (data-agent-kit-plugin parity)
   */
  public matchGraphPattern(
    nodes: Array<{ id: string; type: string; properties?: Record<string, unknown> }>,
    edges: Array<{ fromId: string; toId: string; type: string; weight?: number }>,
    query: GraphPatternQuery
  ): {
    matchedPaths: Array<{ pathNodes: string[]; pathEdges: string[]; cumulativeRisk: number }>;
    shortestSafePath?: { pathNodes: string[]; cumulativeRisk: number };
    cycleDetected: boolean;
  } {
    const adjacency: Map<string, Array<{ toId: string; type: string; weight: number }>> = new Map();
    for (const edge of edges) {
      const list = adjacency.get(edge.fromId) || [];
      list.push({ toId: edge.toId, type: edge.type, weight: edge.weight || 0.1 });
      adjacency.set(edge.fromId, list);
    }

    const matchedPaths: Array<{ pathNodes: string[]; pathEdges: string[]; cumulativeRisk: number }> = [];
    let cycleDetected = false;

    // Depth-First Search for path matching
    const dfs = (currentId: string, visited: Set<string>, currentPath: string[], edgePath: string[], risk: number, depth: number) => {
      if (depth > (query.maxDepth || 6)) return;

      const currentNode = nodes.find((n) => n.id === currentId);
      const isTarget =
        (query.targetNodeId && currentId === query.targetNodeId) ||
        (query.targetNodeType && currentNode && currentNode.type === query.targetNodeType);

      if (isTarget && currentPath.length > 1) {
        matchedPaths.push({
          pathNodes: [...currentPath],
          pathEdges: [...edgePath],
          cumulativeRisk: Number(risk.toFixed(2)),
        });
      }

      const neighbors = adjacency.get(currentId) || [];
      for (const edge of neighbors) {
        if (query.relationshipTypes && !query.relationshipTypes.includes(edge.type)) continue;

        if (visited.has(edge.toId)) {
          cycleDetected = true;
          continue;
        }

        visited.add(edge.toId);
        dfs(
          edge.toId,
          visited,
          [...currentPath, edge.toId],
          [...edgePath, edge.type],
          risk + edge.weight,
          depth + 1
        );
        visited.delete(edge.toId);
      }
    };

    const startVisited = new Set<string>([query.startNodeId]);
    dfs(query.startNodeId, startVisited, [query.startNodeId], [], 0, 0);

    matchedPaths.sort((a, b) => a.cumulativeRisk - b.cumulativeRisk);

    return {
      matchedPaths,
      shortestSafePath: matchedPaths[0],
      cycleDetected,
    };
  }

  /**
   * 3. Infant Motor Babbling & Coordinate Calibration
   */
  public calibrateMotorBabbling(params: {
    domain: string;
    sampleLatencyMs?: number;
    devicePixelRatio?: number;
    targetElementType?: "canvas" | "shadow_dom" | "contenteditable" | "standard_form";
  }): MotorCalibrationProfile {
    const clean = params.domain.toLowerCase().trim();
    const type = params.targetElementType || "standard_form";

    let recommendedDispatch: MotorCalibrationProfile["recommendedDispatchType"] = "direct_mouse";
    if (type === "contenteditable") recommendedDispatch = "native_execCommand";
    else if (type === "shadow_dom" || type === "canvas") recommendedDispatch = "pointer_synthetic";

    const profile: MotorCalibrationProfile = {
      domain: clean,
      recommendedDispatchType: recommendedDispatch,
      inputLagMs: params.sampleLatencyMs || 35,
      dprScale: params.devicePixelRatio || 1.0,
      coordinateAccuracy: 0.98,
      verifiedAt: new Date().toISOString(),
    };

    this.motorProfiles.set(clean, profile);
    return profile;
  }

  /**
   * 4. Gentner's Structure-Mapping Analogical Metaphoric Transfer
   */
  public transferMetaphor(sourceDomain: string, targetDomain: string): MetaphoricMapping {
    const src = sourceDomain.toLowerCase().trim();
    const tgt = targetDomain.toLowerCase().trim();

    const isSocialTarget = tgt.includes("threads") || tgt.includes("linkedin") || tgt.includes("bsky");
    const isEcommerceTarget = tgt.includes("shop") || tgt.includes("store") || tgt.includes("cart");

    const analogies: Array<{ sourceRole: string; targetSelector: string }> = isSocialTarget
      ? [
          { sourceRole: "composer_editor", targetSelector: "div[contenteditable='true']" },
          { sourceRole: "submit_post_btn", targetSelector: "button[type='submit'], div[role='button']:has-text('Post')" },
          { sourceRole: "account_avatar", targetSelector: "img[alt*='profile'], div[data-testid*='avatar']" },
        ]
      : isEcommerceTarget
      ? [
          { sourceRole: "checkout_btn", targetSelector: "button:has-text('Checkout'), a[href*='checkout']" },
          { sourceRole: "place_order_btn", targetSelector: "button:has-text('Place Order')" },
        ]
      : [
          { sourceRole: "main_nav", targetSelector: "nav, header" },
          { sourceRole: "search_input", targetSelector: "input[type='search'], input[name='q']" },
        ];

    const mapping: MetaphoricMapping = {
      sourceDomain: src,
      targetDomain: tgt,
      similarityScore: isSocialTarget ? 0.91 : isEcommerceTarget ? 0.86 : 0.74,
      transferredPlaybooks: isSocialTarget ? ["x_publish_post -> social_feed_compose"] : ["generic_navigation_playbook"],
      componentAnalogies: analogies,
    };

    const existing = this.metaphoricMappings.get(tgt) || [];
    existing.push(mapping);
    this.metaphoricMappings.set(tgt, existing);

    return mapping;
  }

  /**
   * Durable state (see cognitive-persistence.ts): motor calibration and learned metaphors, which tools
   * really write. Profiles are NOT saved: they are derived from the spine on every read.
   * A file from before that change still loads; its `lifespanProfiles` key is simply ignored.
   */
  public snapshotState(): unknown {
    return {
      motorProfiles: [...this.motorProfiles.entries()],
      metaphoricMappings: [...this.metaphoricMappings.entries()],
    };
  }

  public restoreState(raw: unknown): void {
    const s = asRecord(raw, "lifespan");
    const motorProfiles = toMap<MotorCalibrationProfile>(s.motorProfiles, "lifespan.motorProfiles");
    const metaphoricMappings = toMap<MetaphoricMapping[]>(s.metaphoricMappings, "lifespan.metaphoricMappings");
    // Re-keyed by the canonical domain (the tool layer canonicalizes args.domain now): the newer calibration wins,
    // and two spellings' metaphors are kept together.
    this.motorProfiles = rekeyByDomain(motorProfiles, (a, b) => (String(b.verifiedAt) >= String(a.verifiedAt) ? b : a), {
      fix: (p, key) => (p && typeof p === "object" ? { ...p, domain: key } : p),
    });
    this.metaphoricMappings = rekeyByDomain(metaphoricMappings, (a, b) => [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
  }
}

export const globalLifespanEngine = new CognitiveLifespanEngine();
