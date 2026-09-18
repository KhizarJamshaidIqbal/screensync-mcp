// ScreenSync Lifespan Cognitive Ontogeny & Epistemic Property Graph 2.0 Catalog (Architecture 9.0)
// Declares schemas for:
// 1. web_cognitive_lifespan (Lifespan developmental ontogeny)
// 2. web_graph_pattern_match (BigQuery GQL path matching & cycle detection)
// 3. web_motor_babbling (Infant physical coordinate & event calibration)
// 4. web_metaphoric_transfer (Gentner structure-mapping cross-domain analogies)

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function lifespanToolDefinitions(): Tool[] {
  return [
    {
      name: "web_cognitive_lifespan",
      description:
        "Lifespan Cognitive Development engine (Architecture 9.0). Evaluates domain-specific cognitive age (0.1 infant to 50.0 sage), Vygotskian scaffolding barriers, nociceptive burn penalties, and developmental milestone progression.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain or application URL."
          },
          event: {
            type: "object",
            description: "Optional developmental event ({ outcome: 'success' | 'burn', milestoneName: string })."
          }
        }
      }
    },
    {
      name: "web_graph_pattern_match",
      description:
        "BigQuery/Property-Graph GQL Pattern Matcher (Architecture 9.0, data-agent-kit-plugin parity). Performs topological path querying, cycle detection (redirect loop prevention), and minimum-risk path computation.",
      inputSchema: {
        type: "object",
        required: ["startNodeId", "nodes", "edges"],
        properties: {
          startNodeId: {
            type: "string",
            description: "Origin node ID to begin graph traversal."
          },
          targetNodeType: {
            type: "string",
            description: "Target node type to match (e.g. 'PAGE', 'BUTTON', 'STATE')."
          },
          targetNodeId: {
            type: "string",
            description: "Target node ID to reach."
          },
          nodes: {
            type: "array",
            description: "Array of graph nodes ({ id, type, properties })."
          },
          edges: {
            type: "array",
            description: "Array of graph edges ({ fromId, toId, type, weight })."
          },
          maxDepth: {
            type: "integer",
            description: "Maximum traversal depth (default 6)."
          }
        }
      }
    },
    {
      name: "web_motor_babbling",
      description:
        "Infant Motor Babbling & Coordinate Precision Calibration engine (Architecture 9.0). Probes synthetic pointer dispatch latency, sub-pixel bounding offsets, and input methods (execCommand vs pointerdown) before high-stakes macros.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain URL."
          },
          sampleLatencyMs: {
            type: "number",
            description: "Observed event dispatch latency."
          },
          devicePixelRatio: {
            type: "number",
            description: "Screen device pixel ratio (DPR)."
          },
          targetElementType: {
            type: "string",
            enum: ["canvas", "shadow_dom", "contenteditable", "standard_form"],
            description: "Type of element to calibrate motor dispatch for."
          }
        }
      }
    },
    {
      name: "web_metaphoric_transfer",
      description:
        "Gentner's Structure-Mapping Analogical Metaphoric Transfer engine (Architecture 9.0). Maps proven procedural playbooks and component roles from familiar source domains (e.g. x.com) to unfamiliar targets (e.g. threads.net, linkedin.com).",
      inputSchema: {
        type: "object",
        required: ["sourceDomain", "targetDomain"],
        properties: {
          sourceDomain: {
            type: "string",
            description: "Familiar domain with established playbooks (e.g. 'x.com')."
          },
          targetDomain: {
            type: "string",
            description: "Unfamiliar target domain to inherit schemas (e.g. 'threads.net')."
          }
        }
      }
    }
  ];
}
