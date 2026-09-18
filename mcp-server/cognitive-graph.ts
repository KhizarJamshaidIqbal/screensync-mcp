// ScreenSync Cognitive Associative Knowledge Graph (CAG - AP-CE Tier 3)
// Inspired by BigQuery Graph (GQL property graph topology)
// Enables Cross-Domain Skill Transfer across web applications sharing common frameworks.

import type { CognitiveMemoryStore, ProceduralPlaybook } from "./cognitive-memory.js";

export interface GraphNode {
  id: string;
  type: "domain" | "framework" | "primitive" | "auth" | "challenge";
  label: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: "RUNS_ON" | "SHARES_PRIMITIVE" | "AUTHENTICATES_VIA" | "PROTECTED_BY" | "TRANSFERS_TO";
  weight?: number; // 0.0 to 1.0 confidence
}

export interface SkillTransferResult {
  transferred: boolean;
  targetDomain: string;
  sourceDomain?: string;
  sharedFramework?: string;
  adaptedPlaybook?: ProceduralPlaybook;
  confidence: number;
  reason: string;
}

export class CognitiveAssociativeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  constructor() {
    this.seedDefaultGraph();
  }

  private seedDefaultGraph(): void {
    // Domains
    this.addNode({ id: "domain:x.com", type: "domain", label: "x.com" });
    this.addNode({ id: "domain:threads.net", type: "domain", label: "threads.net" });
    this.addNode({ id: "domain:facebook.com", type: "domain", label: "facebook.com" });
    this.addNode({ id: "domain:reddit.com", type: "domain", label: "reddit.com" });

    // Frameworks
    this.addNode({
      id: "framework:lexical_draftjs",
      type: "framework",
      label: "Lexical / Draft.js ContentEditable",
      properties: { requiresSyntheticInputEvent: true, ignoresValueSetter: true }
    });
    this.addNode({
      id: "framework:standard_textarea",
      type: "framework",
      label: "Standard HTML5 Form Input",
      properties: { nativeInput: true }
    });

    // Input Primitives
    this.addNode({
      id: "primitive:execcommand_insert",
      type: "primitive",
      label: "Atomic execCommand insertText",
      properties: {
        method: "execCommand",
        code: "el.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); document.execCommand('insertText', false, text); el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: '' }));"
      }
    });

    // Edges
    this.addEdge("domain:x.com", "framework:lexical_draftjs", "RUNS_ON", 1.0);
    this.addEdge("domain:threads.net", "framework:lexical_draftjs", "RUNS_ON", 0.9);
    this.addEdge("domain:facebook.com", "framework:lexical_draftjs", "RUNS_ON", 0.85);
    this.addEdge("domain:reddit.com", "framework:standard_textarea", "RUNS_ON", 0.95);

    this.addEdge("framework:lexical_draftjs", "primitive:execcommand_insert", "SHARES_PRIMITIVE", 1.0);
  }

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  public addEdge(source: string, target: string, relationship: GraphEdge["relationship"], weight = 1.0): void {
    this.edges.push({ source, target, relationship, weight });
  }

  public getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public getEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Traverses graph to locate shared frameworks and transfer motor playbooks
   * from an experienced domain (e.g. x.com) to an unknown domain (e.g. threads.net).
   */
  public transferSkill(targetDomain: string, intent: string, store: CognitiveMemoryStore): SkillTransferResult {
    const normTarget = store.normalizeDomain(targetDomain);
    const targetNodeId = `domain:${normTarget}`;

    // 1. Find framework for target domain
    const frameworkEdge = this.edges.find((e) => e.source === targetNodeId && e.relationship === "RUNS_ON");
    if (!frameworkEdge) {
      return {
        transferred: false,
        targetDomain: normTarget,
        confidence: 0,
        reason: `Target domain ${normTarget} has no framework mapping in associative graph.`
      };
    }

    const frameworkId = frameworkEdge.target;
    const frameworkNode = this.nodes.get(frameworkId);

    // 2. Find other domains sharing this framework that have an existing playbook
    const siblingEdges = this.edges.filter(
      (e) => e.target === frameworkId && e.relationship === "RUNS_ON" && e.source !== targetNodeId
    );

    const memory = store.load();
    for (const sib of siblingEdges) {
      const sourceDomain = sib.source.replace(/^domain:/, "");
      const sourcePlaybook = Object.values(memory.playbooks).find(
        (pb) => store.normalizeDomain(pb.domain) === sourceDomain && pb.intent.toLowerCase() === intent.toLowerCase()
      );

      if (sourcePlaybook) {
        // 3. Adapt playbook for the target domain
        const adaptedPlaybook: ProceduralPlaybook = {
          id: `pb_${normTarget.replace(/\./g, "_")}_transferred_${intent}`,
          name: `${normTarget}_${intent}_transferred`,
          domain: normTarget,
          intent,
          description: `Cross-domain transferred playbook from ${sourceDomain} via shared ${frameworkNode?.label || "framework"}.`,
          environmentalProbes: sourcePlaybook.environmentalProbes,
          preconditions: sourcePlaybook.preconditions,
          steps: sourcePlaybook.steps.map((s) => ({ ...s })),
          branches: sourcePlaybook.branches ? sourcePlaybook.branches.map((b) => ({ ...b })) : undefined,
          successCount: 1,
          lastExecutedAt: new Date().toISOString(),
          targetDurationSeconds: sourcePlaybook.targetDurationSeconds || 15
        };

        return {
          transferred: true,
          targetDomain: normTarget,
          sourceDomain,
          sharedFramework: frameworkNode?.label,
          adaptedPlaybook,
          confidence: Number((frameworkEdge.weight! * sib.weight!).toFixed(2)),
          reason: `Successfully transferred motor recipe from ${sourceDomain} (shares ${frameworkNode?.label}).`
        };
      }
    }

    return {
      transferred: false,
      targetDomain: normTarget,
      sharedFramework: frameworkNode?.label,
      confidence: 0,
      reason: `No sibling domain with a proven playbook found for framework ${frameworkNode?.label}.`
    };
  }
}

export const globalAssociativeGraph = new CognitiveAssociativeGraph();
