// ScreenSync Cognitive Memory MCP Tool Declarations - the developmental and hygiene tools
// (Architectures 5.0-9.0): stage, replay, episodic recall, hygiene, object permanence, theory of mind,
// undo, RPD, maturation, the epistemic graph, curiosity and homeostasis.
//
// Split out of catalog-cognitive.ts, which had grown past the repo's 500-line limit. The order is
// unchanged: cognitiveToolDefinitions() lists the core tools first and these after them.

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function cognitiveExtendedToolDefinitions(): Tool[] {
  return [
    {
      name: "web_cognitive_stage",
      description:
        "Neuro-Developmental Memory Stage inspector & scaffolding manager (Architecture 5.0). Tracks agent cognitive maturity per domain across 5 developmental stages (Infant -> Toddler -> Child -> Adult -> Sovereign Sage), dynamically adjusting autonomy scaffolding and execution speed.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com', 'threads.net', 'unknown-domain.com')."
          },
          action: {
            type: "string",
            enum: ["get", "evaluate", "next", "override"],
            description: "Stage action: 'get' (retrieve current maturity & scaffolding), 'evaluate' (what the earned level is and what it would take to rise), 'next' (ranked, advisory next steps at the edge of this domain's ability: unverified playbooks to confirm, stale skills to re-run, the level gap, a neighbour that already solved an intent, undocumented failures), 'override' (an audited human vouch: capped at COMPETENT, shown as source \"vouched\", never counts as earned evidence)."
          },
          stage: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Target stage level for override (1: Sensorimotor Infant, 2: Preoperational Toddler, 3: Concrete Child, 4: Formal Adult, 5: Sovereign Sage)."
          }
        }
      }
    },
    {
      name: "web_cognitive_replay",
      description:
        "Hippocampal Sharp-Wave Ripple (SWR) offline counterfactual replay simulator (Architecture 6.0). Replays playbooks through simulated perturbations (DOM mutations, network spikes, unexpected modal interruptions) at 15x speed to calculate resilience scores and auto-synthesize adaptive fallback branches.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com', 'threads.net')."
          },
          playbookId: {
            type: "string",
            description: "Optional specific playbook ID to test."
          },
          autoSynthesizeBranch: {
            type: "boolean",
            description: "If true, automatically generates and patches a self-healing fallback branch into the playbook DAG when a vulnerability is detected."
          },
          counterfactualScenarios: {
            type: "array",
            items: { type: "object" },
            description: "Optional array of synthetic perturbations to simulate."
          }
        }
      }
    },
    {
      name: "web_episodic_query",
      description:
        "Tulving's autobiographical episodic memory recall engine (Architecture 6.0). Queries historical execution episodes across domain, intent, timestamp, tab context, and outcome to retrieve autobiographical lessons and success metrics.",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Optional domain filter (e.g. 'x.com')."
          },
          intent: {
            type: "string",
            description: "Optional intent filter (e.g. 'post', 'search')."
          },
          outcome: {
            type: "string",
            enum: ["success", "failure"],
            description: "Optional outcome filter."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Maximum episodes to return (default 20)."
          }
        }
      }
    },
    {
      name: "web_cognitive_hygiene",
      description:
        "Cognitive data quality profiling and autocleaning engine (Architecture 6.0, inspired by data_autocleaning & accidental_data_loss_prevention). Audits cognitive memory stores for orphan branches on unverified drafts and duplicate pitfalls, and can clean them. It never edits a verified playbook and never removes a pitfall for being old.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com', 'threads.net')."
          },
          action: {
            type: "string",
            enum: ["profile", "autoclean"],
            description: "'profile' (read-only audit of orphan branches and duplicate pitfalls) or 'autoclean' (take orphan branches off unverified drafts, keeping them under prunedBranches, and merge duplicate pitfalls into the richest copy - only copies that never contradict each other; the result is saved)."
          }
        }
      }
    },
    {
      name: "web_object_permanence",
      description:
        "Piagetian Object Permanence & spatial occlusion resolution engine (Architecture 7.0). Tracks off-screen, occluded, or virtualized elements across scroll offsets and collapsed containers, computing precise scroll vectors to restore targets into active perception.",
      inputSchema: {
        type: "object",
        required: ["domain", "selector"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com', 'threads.net')."
          },
          selector: {
            type: "string",
            description: "CSS or VOM selector of the target element."
          },
          action: {
            type: "string",
            enum: ["resolve", "register"],
            description: "'resolve' (calculate scroll delta to hidden element) or 'register' (record element spatial rect)."
          },
          rect: {
            type: "object",
            description: "Optional bounding rect when registering spatial location."
          }
        }
      }
    },
    {
      name: "web_theory_of_mind",
      description:
        "Theory of Mind (ToM) & anti-bot behavioral cadence projection engine (Architecture 7.0). Projects server and WAF suspicion levels to synthesize natural humanized typing latencies (Gaussian distributions) and Bezier mouse jitter curves.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com', 'threads.net')."
          },
          actionCountInLastMinute: {
            type: "integer",
            description: "Number of actions executed in the past 60 seconds."
          },
          hasCaptchaOrWafDetected: {
            type: "boolean",
            description: "Whether a challenge or WAF signature was observed."
          }
        }
      }
    },
    {
      name: "web_cognitive_undo",
      description:
        "Cognitive Reversibility & transactional safe rollback engine (Architecture 7.0, inspired by accidental_data_loss_prevention). Evaluates action reversibility, blocks destructive commands lacking user consent, and synthesizes inverse rollback actions.",
      inputSchema: {
        type: "object",
        required: ["targetTool"],
        properties: {
          targetTool: {
            type: "string",
            description: "The action tool to evaluate (e.g. 'web_fill', 'web_click')."
          },
          targetSelector: {
            type: "string",
            description: "Optional target element selector."
          },
          args: {
            type: "object",
            description: "Arguments to be passed to the tool."
          }
        }
      }
    },
    {
      name: "web_rpd_prototype",
      description:
        "Gary Klein's Recognition-Primed Decision (RPD) page archetype classification engine (Architecture 7.0). Instantly matches visited pages to canonical archetypes (Rich Feed, Data Table, Multi-Step Wizard, Dashboard Analytics, Auth Checkpoint) and yields pre-calibrated motor strategies.",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: {
            type: "string",
            description: "Current page URL."
          },
          domSignature: {
            type: "object",
            description: "Optional sensory flags (hasTable, hasInfiniteScroll, hasContentEditable, hasCharts, hasLoginForm)."
          }
        }
      }
    },
    {
      name: "web_cognitive_maturation",
      description:
        "Ontogenetic Cognitive Maturation engine (Architecture 8.0). Evaluates and transitions the agent's developmental stage (Stage 1: Infant Sensorimotor to Stage 5: Sovereign Sage) across web domains, tracking cognitive XP, successful interactions, and nociceptive trauma (hot stove burns).",
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
            description: "Optional outcome event to evolve maturity ({ outcome: 'success' | 'trauma', xpGain: number })."
          }
        }
      }
    },
    {
      name: "web_epistemic_graph",
      description:
        "BigQuery/Property-Graph Epistemic Topology & Causal Lineage engine (Architecture 8.0, data-agent-kit-plugin parity). Manages graph nodes (Page, Component, Action, State, Incident), edges, shortest-risk pathfinding, and backward causal lineage tracing from error states.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add_node", "add_edge", "trace_lineage", "summary"],
            description: "Graph operation to perform."
          },
          node: {
            type: "object",
            description: "Node object to insert (id, label, properties)."
          },
          edge: {
            type: "object",
            description: "Edge object to insert (fromId, toId, label, weight, properties)."
          },
          targetNodeId: {
            type: "string",
            description: "Target node ID for backward causal lineage tracing."
          }
        }
      }
    },
    {
      name: "web_curiosity_frontier",
      description:
        "Epistemic Curiosity Frontier engine (Architecture 8.0). Computes Shannon entropy reduction and novelty value vs risk for unvisited links, tabs, and interactive components to guide safe autonomous exploration.",
      inputSchema: {
        type: "object",
        required: ["elements"],
        properties: {
          elements: {
            type: "array",
            description: "List of candidates ({ selector, text, tag }) to evaluate on the curiosity frontier."
          }
        }
      }
    },
    {
      name: "web_homeostatic_regulation",
      description:
        "Biological Homeostatic Regulation & Allostatic Resilience engine (Architecture 8.0). Monitors sensory telemetry (DOM bloat, action velocity, latency, WAF suspicion) and dynamically commands calm pauses, memory cache flushes, or sensory attenuation.",
      inputSchema: {
        type: "object",
        properties: {
          domNodeCount: {
            type: "integer",
            description: "Current number of DOM elements."
          },
          actionsPerMinute: {
            type: "integer",
            description: "Frequency of actions in the past 60s."
          },
          recentErrorRate: {
            type: "number",
            description: "Ratio of errors to total actions (0.0 to 1.0)."
          },
          averageLatencyMs: {
            type: "number",
            description: "Average round-trip response latency."
          },
          threatSuspicionScore: {
            type: "number",
            description: "Current server/WAF threat suspicion (0.0 to 1.0)."
          }
        }
      }
    }
  ];
}
