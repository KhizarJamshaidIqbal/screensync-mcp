// ScreenSync Ontogenetic Cognitive Maturation & Epistemic Property Graph Engine (Architecture 8.0)
// Synthesizes:
// 1. Ontogenetic Developmental Stages (Infant -> Child -> Adolescent -> Adult -> Sovereign Sage)
// 2. BigQuery/Property-Graph Epistemic Topology & Causal Lineage (data-agent-kit-plugin parity)
// 3. Epistemic Curiosity Frontier (Childhood Entropy Reduction & Safe Exploration)
// 4. Biological Homeostatic Regulation & Allostatic Resilience

import { asRecord, capTail, toArray, toMap } from "./cognitive-serial.js";

export type CognitiveStage =
  | "STAGE_1_INFANT_SENSORIMOTOR"
  | "STAGE_2_CHILD_SYMBOLIC"
  | "STAGE_3_ADOLESCENT_FORMAL"
  | "STAGE_4_ADULT_RPD_MASTER"
  | "STAGE_5_SAGE_EPISTEMIC_FABRIC";

export interface OntogeneticProfile {
  domain: string;
  stage: CognitiveStage;
  stageLevel: number; // 1 to 5
  cognitiveXp: number;
  successfulActions: number;
  traumaIncidents: number; // hot-stove burns (403, WAF challenges, fatal DOM crashes)
  lastStageTransition: string;
  policy: {
    sensoryProbeRateMs: number;
    exploratoryCaution: "extreme_nociceptive" | "guarded_curious" | "balanced" | "autonomous_high" | "effortless_sage";
    allowAutonomousBatching: boolean;
    requireUndoPreflight: boolean;
    recommendedDeliberationMs: number;
  };
}

export interface GraphNode {
  id: string;
  label: "PAGE" | "COMPONENT" | "ACTION" | "STATE" | "INCIDENT";
  properties: Record<string, unknown>;
  createdAt: string;
}

export interface GraphEdge {
  fromId: string;
  toId: string;
  label: "NAVIGATES_TO" | "CONTAINS_COMPONENT" | "MUTATES_STATE" | "TRIGGERS_MODAL" | "CAUSED_BY" | "DEPENDS_ON";
  weight: number; // 0.0 to 1.0 (cost or risk)
  properties?: Record<string, unknown>;
}

export interface FrontierElement {
  selector: string;
  type: "link" | "button" | "tab" | "dropdown" | "form_input";
  epistemicGain: number; // 0.0 to 1.0 (novelty value)
  riskScore: number; // 0.0 to 1.0
  recommendedAction: "inspect" | "safe_click" | "skip_destructive";
}

export class CognitiveMaturationEngine {
  private profiles: Map<string, OntogeneticProfile> = new Map();
  private graphNodes: Map<string, GraphNode> = new Map();
  private graphEdges: GraphEdge[] = [];

  constructor() {
    this.seedDefaultProfiles();
  }

  private seedDefaultProfiles(): void {
    this.profiles.set("x.com", {
      domain: "x.com",
      stage: "STAGE_4_ADULT_RPD_MASTER",
      stageLevel: 4,
      cognitiveXp: 2850,
      successfulActions: 184,
      traumaIncidents: 2,
      lastStageTransition: new Date().toISOString(),
      policy: {
        sensoryProbeRateMs: 500,
        exploratoryCaution: "autonomous_high",
        allowAutonomousBatching: true,
        requireUndoPreflight: false,
        recommendedDeliberationMs: 150,
      },
    });
  }

  private computeStagePolicy(stageLevel: number): OntogeneticProfile["policy"] {
    switch (stageLevel) {
      case 1:
        return {
          sensoryProbeRateMs: 2500,
          exploratoryCaution: "extreme_nociceptive",
          allowAutonomousBatching: false,
          requireUndoPreflight: true,
          recommendedDeliberationMs: 1200,
        };
      case 2:
        return {
          sensoryProbeRateMs: 1500,
          exploratoryCaution: "guarded_curious",
          allowAutonomousBatching: false,
          requireUndoPreflight: true,
          recommendedDeliberationMs: 800,
        };
      case 3:
        return {
          sensoryProbeRateMs: 900,
          exploratoryCaution: "balanced",
          allowAutonomousBatching: true,
          requireUndoPreflight: true,
          recommendedDeliberationMs: 400,
        };
      case 4:
        return {
          sensoryProbeRateMs: 500,
          exploratoryCaution: "autonomous_high",
          allowAutonomousBatching: true,
          requireUndoPreflight: false,
          recommendedDeliberationMs: 150,
        };
      case 5:
      default:
        return {
          sensoryProbeRateMs: 300,
          exploratoryCaution: "effortless_sage",
          allowAutonomousBatching: true,
          requireUndoPreflight: false,
          recommendedDeliberationMs: 50,
        };
    }
  }

  /**
   * 1. Cognitive Maturation: Retrieve or evolve domain developmental stage
   */
  public getOrEvolveProfile(domain: string, event?: { outcome: "success" | "trauma"; xpGain?: number }): OntogeneticProfile {
    const clean = domain.toLowerCase().trim();
    let profile = this.profiles.get(clean);

    if (!profile) {
      profile = {
        domain: clean,
        stage: "STAGE_1_INFANT_SENSORIMOTOR",
        stageLevel: 1,
        cognitiveXp: 0,
        successfulActions: 0,
        traumaIncidents: 0,
        lastStageTransition: new Date().toISOString(),
        policy: this.computeStagePolicy(1),
      };
      this.profiles.set(clean, profile);
    }

    if (event) {
      if (event.outcome === "success") {
        profile.successfulActions++;
        profile.cognitiveXp += event.xpGain || 25;
      } else if (event.outcome === "trauma") {
        profile.traumaIncidents++;
        // Nociceptive trauma penalty
        profile.cognitiveXp = Math.max(0, profile.cognitiveXp - 150);
      }

      // Check for developmental stage promotion / demotion
      const prevLevel = profile.stageLevel;
      let newLevel = 1;
      if (profile.cognitiveXp >= 3500 && profile.traumaIncidents < 5) newLevel = 5;
      else if (profile.cognitiveXp >= 1500 && profile.traumaIncidents < 8) newLevel = 4;
      else if (profile.cognitiveXp >= 500) newLevel = 3;
      else if (profile.cognitiveXp >= 100) newLevel = 2;

      // Trauma regression guard: multiple traumas demote stage
      if (event.outcome === "trauma" && profile.traumaIncidents >= 3 && newLevel > 2) {
        newLevel = Math.max(1, newLevel - 1);
      }

      if (newLevel !== prevLevel) {
        profile.stageLevel = newLevel;
        const stageNames: CognitiveStage[] = [
          "STAGE_1_INFANT_SENSORIMOTOR",
          "STAGE_2_CHILD_SYMBOLIC",
          "STAGE_3_ADOLESCENT_FORMAL",
          "STAGE_4_ADULT_RPD_MASTER",
          "STAGE_5_SAGE_EPISTEMIC_FABRIC",
        ];
        profile.stage = stageNames[newLevel - 1];
        profile.policy = this.computeStagePolicy(newLevel);
        profile.lastStageTransition = new Date().toISOString();
      }
    }

    return profile;
  }

  /**
   * 2. Epistemic Property Graph: Add Node
   */
  public addNode(node: Omit<GraphNode, "createdAt">): GraphNode {
    const fullNode: GraphNode = {
      ...node,
      createdAt: new Date().toISOString(),
    };
    this.graphNodes.set(node.id, fullNode);
    return fullNode;
  }

  /**
   * 2. Epistemic Property Graph: Add Edge
   */
  public addEdge(edge: GraphEdge): GraphEdge {
    this.graphEdges.push(edge);
    return edge;
  }

  /**
   * 2. Epistemic Property Graph: Backward Causal Lineage Tracing (Data-Agent-Kit / BigQuery Lineage)
   */
  public traceLineage(targetNodeId: string): {
    targetNodeId: string;
    lineageChain: Array<{ node: GraphNode; viaEdge: GraphEdge }>;
    rootCauseNode?: GraphNode;
  } {
    const chain: Array<{ node: GraphNode; viaEdge: GraphEdge }> = [];
    const visited = new Set<string>();
    let currentId = targetNodeId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const incomingEdge = this.graphEdges.find((e) => e.toId === currentId);
      if (!incomingEdge) break;

      const sourceNode = this.graphNodes.get(incomingEdge.fromId);
      if (!sourceNode) break;

      chain.push({ node: sourceNode, viaEdge: incomingEdge });
      currentId = sourceNode.id;
    }

    return {
      targetNodeId,
      lineageChain: chain,
      rootCauseNode: chain.length > 0 ? chain[chain.length - 1].node : undefined,
    };
  }

  /**
   * 2. Epistemic Property Graph: Summary Statistics
   */
  public getGraphStats(): { nodeCount: number; edgeCount: number; nodeTypes: Record<string, number> } {
    const nodeTypes: Record<string, number> = {};
    for (const node of this.graphNodes.values()) {
      nodeTypes[node.label] = (nodeTypes[node.label] || 0) + 1;
    }
    return {
      nodeCount: this.graphNodes.size,
      edgeCount: this.graphEdges.length,
      nodeTypes,
    };
  }

  /**
   * 3. Epistemic Curiosity Frontier: Evaluates novelty vs risk for unvisited elements
   */
  public evaluateCuriosityFrontier(elements: Array<{ selector: string; text?: string; tag?: string }>): {
    frontier: FrontierElement[];
    recommendedNextStep?: FrontierElement;
    entropyReductionEstimate: number;
  } {
    const frontier: FrontierElement[] = elements.map((el) => {
      const text = (el.text || "").toLowerCase();
      const selector = el.selector.toLowerCase();
      const isDestructive =
        text.includes("delete") ||
        text.includes("remove") ||
        text.includes("cancel") ||
        selector.includes("danger") ||
        selector.includes("destroy");

      const isNav = el.tag === "a" || selector.includes("nav") || selector.includes("tab");
      const isButton = el.tag === "button" || selector.includes("btn");

      let epistemicGain = 0.5;
      if (isNav) epistemicGain = 0.85;
      if (text.includes("settings") || text.includes("dashboard")) epistemicGain = 0.95;

      const riskScore = isDestructive ? 0.95 : isButton ? 0.35 : 0.1;
      const recommendedAction = isDestructive ? "skip_destructive" : epistemicGain > 0.7 ? "safe_click" : "inspect";

      return {
        selector: el.selector,
        type: isNav ? "link" : isButton ? "button" : "dropdown",
        epistemicGain,
        riskScore,
        recommendedAction,
      };
    });

    const safeFrontier = frontier.filter((f) => f.recommendedAction !== "skip_destructive");
    safeFrontier.sort((a, b) => b.epistemicGain - a.epistemicGain);

    return {
      frontier,
      recommendedNextStep: safeFrontier[0],
      entropyReductionEstimate: Number((safeFrontier.length * 0.12).toFixed(2)),
    };
  }

  /**
   * 4. Biological Homeostatic Regulation & Allostatic Resilience
   */
  public evaluateHomeostasis(params: {
    domNodeCount: number;
    actionsPerMinute: number;
    recentErrorRate: number; // 0.0 to 1.0
    averageLatencyMs: number;
    threatSuspicionScore: number; // 0.0 to 1.0
  }): {
    stressIndex: number; // 0.0 to 1.0
    allostaticState: "OPTIMAL" | "STRAINED" | "OVERLOADED" | "CRITICAL_EXHAUSTION";
    recommendedInterventions: {
      injectCalmPauseMs: number;
      flushWorkingMemoryCache: boolean;
      attenuateSensoryPolling: boolean;
      escalateToHumanOperator: boolean;
    };
    explanation: string;
  } {
    let stress = 0.05;
    if (params.domNodeCount > 4000) stress += 0.25;
    if (params.actionsPerMinute > 60) stress += 0.25;
    if (params.recentErrorRate > 0.2) stress += 0.3;
    if (params.threatSuspicionScore > 0.5) stress += 0.2;
    if (params.averageLatencyMs > 2000) stress += 0.15;

    stress = Math.min(1.0, Number(stress.toFixed(2)));

    const allostaticState =
      stress >= 0.85
        ? "CRITICAL_EXHAUSTION"
        : stress >= 0.65
        ? "OVERLOADED"
        : stress >= 0.35
        ? "STRAINED"
        : "OPTIMAL";

    const interventions = {
      injectCalmPauseMs: allostaticState === "CRITICAL_EXHAUSTION" ? 5000 : allostaticState === "OVERLOADED" ? 2000 : allostaticState === "STRAINED" ? 500 : 0,
      flushWorkingMemoryCache: stress >= 0.65,
      attenuateSensoryPolling: stress >= 0.5,
      escalateToHumanOperator: allostaticState === "CRITICAL_EXHAUSTION",
    };

    return {
      stressIndex: stress,
      allostaticState,
      recommendedInterventions: interventions,
      explanation: `Allostatic state is ${allostaticState} (stress index: ${stress}). ${
        stress > 0.65
          ? "High sensory load or rate limit pressure detected. Regulating pace to preserve agent resilience."
          : "System operating within healthy cognitive homeostasis."
      }`,
    };
  }

  /** Durable state (see cognitive-persistence.ts). Pristine, read-created profiles are omitted: they are recreated on demand. */
  public snapshotState(): unknown {
    return {
      profiles: [...this.profiles.entries()].filter(([, p]) => p.cognitiveXp > 0 || p.successfulActions > 0 || p.traumaIncidents > 0 || p.stageLevel > 1),
      graphNodes: [...this.graphNodes.entries()],
      graphEdges: capTail(this.graphEdges, 5000),
    };
  }

  public restoreState(raw: unknown): void {
    const s = asRecord(raw, "maturation");
    const profiles = toMap<OntogeneticProfile>(s.profiles, "maturation.profiles");
    const graphNodes = toMap<GraphNode>(s.graphNodes, "maturation.graphNodes");
    const graphEdges = toArray<GraphEdge>(s.graphEdges, "maturation.graphEdges");
    this.profiles = profiles;
    this.graphNodes = graphNodes;
    this.graphEdges = graphEdges;
  }
}

export const globalMaturationEngine = new CognitiveMaturationEngine();
