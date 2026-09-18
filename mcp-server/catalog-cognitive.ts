// ScreenSync Cognitive Memory MCP Tool Declarations
// web_recall: cue-dependent cognitive memory retrieval (<10ms fast path)
// web_learn: persistent procedural & pitfall learning

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function cognitiveToolDefinitions(): Tool[] {
  return [
    {
      name: "web_recall",
      description:
        "Cognitive cue-dependent memory recall. Call BEFORE interacting with any domain or web task (e.g. x.com, linkedin, wordpress, github) to retrieve verified procedural playbooks, framework quirks (Draft.js, Slate, React), and critical pitfalls to avoid repeating past mistakes.",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Target web domain or host (e.g. 'x.com', 'github.com', 'blog.example.com')."
          },
          url: {
            type: "string",
            description: "Target URL (auto-normalizes domain if domain is omitted)."
          },
          intent: {
            type: "string",
            description: "High-level goal/action intent (e.g. 'post', 'login', 'fill_form', 'scrape_feed')."
          },
          profile: {
            type: "string",
            description: "Target browser profile identity if known (e.g. 'epsoldev@gmail.com')."
          }
        }
      }
    },
    {
      name: "web_learn",
      description:
        "Human-mind cognitive learning tool. Persists newly discovered procedural playbooks, domain pitfalls, and site quirks into ScreenSync's permanent memory so the agent and future sessions never repeat the same mistake.",
      inputSchema: {
        type: "object",
        required: ["action", "domain"],
        properties: {
          action: {
            type: "string",
            enum: ["playbook", "pitfall", "fact", "episode"],
            description: "Learning category: 'playbook' (proven multi-step recipe), 'pitfall' (mistake to avoid + solution), 'fact' (site framework/metadata), 'episode' (execution run record)."
          },
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com')."
          },
          intent: {
            type: "string",
            description: "Optional intent tag for playbooks/episodes (e.g. 'post', 'login')."
          },
          data: {
            type: "object",
            description: "Structured learning data (for playbook: { name, steps, preconditions }; for pitfall: { symptom, rootCause, antiPattern, provenSolution, codeSnippet }; for fact: { framework, keySelectors }; for episode: { success, durationMs, notes })."
          }
        }
      }
    },
    {
      name: "web_warm",
      description:
        "Predictive Active Inference & Speculative Pre-Flight Warming tool (AP-CE Tier 1). Probes target domain/tab state, verifies circuit breaker health, evaluates environmental signals, and pre-resolves optimal fast-path playbook branch before actual execution.",
      inputSchema: {
        type: "object",
        required: ["domain", "intent"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com', 'reddit.com')."
          },
          intent: {
            type: "string",
            description: "Intended action (e.g. 'post', 'comment', 'login')."
          },
          profile: {
            type: "string",
            description: "Target browser profile identity if known (e.g. 'epsoldev@gmail.com')."
          },
          detectedSignals: {
            type: "object",
            description: "Optional key-value boolean flags for observed conditions (e.g. { flame_is_lit_auth_active: true, pan_already_on_fire_compose_open: true })."
          }
        }
      }
    },
    {
      name: "web_consolidate",
      description:
        "Hippocampal Memory Consolidation tool (AP-CE Tier 4). Runs Medallion Lakehouse compaction (Bronze -> Silver -> Gold), triggers Long-Term Potentiation (LTP) on proven playbooks, applies Long-Term Depression (LTD) on failing selectors, and purges stale telemetry to maintain sub-millisecond retrieval.",
      inputSchema: {
        type: "object",
        properties: {
          pruneObsolete: {
            type: "boolean",
            description: "Whether to prune obsolete/deprecated playbooks with confidence <= 0.1 (default true)."
          }
        }
      }
    },
    {
      name: "web_graph_query",
      description:
        "Cognitive Associative Knowledge Graph (CAG) query tool (AP-CE Tier 3). Queries cross-domain framework topology and automatically transfers motor playbooks to new websites sharing identical frameworks (e.g. threads.net inheriting from x.com).",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Target domain to inspect or transfer skills to (e.g. 'threads.net', 'facebook.com')."
          },
          intent: {
            type: "string",
            description: "Target action intent (e.g. 'post', 'comment')."
          },
          transferSkill: {
            type: "boolean",
            description: "If true, attempts cross-domain playbook synthesis via shared framework topology."
          }
        }
      }
    },
    {
      name: "web_contract_check",
      description:
        "Cognitive Data Safety Contract evaluator (AP-CE Tier 1). Audits the active page for unsubmitted form fields, drafts, or carts before risky navigations, taking ephemeral recovery snapshots to prevent accidental data loss.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain or active URL host."
          },
          url: {
            type: "string",
            description: "Full active page URL."
          },
          allowDirtyNavigation: {
            type: "boolean",
            description: "If true, snapshots dirty inputs and returns safe=true to permit navigation."
          }
        }
      }
    },
    {
      name: "web_lineage",
      description:
        "Playbook DAG Lineage & Cryptographic Provenance inspector (AP-CE Tier 2). Traces the evolutionary commit history of playbooks and selector mutations over time.",
      inputSchema: {
        type: "object",
        properties: {
          playbookId: {
            type: "string",
            description: "Optional playbook ID to filter lineage commits (e.g. 'x_publish_post')."
          },
          limit: {
            type: "integer",
            description: "Maximum number of history commits to return (default 20)."
          }
        }
      }
    },
    {
      name: "web_metacognition",
      description:
        "Metacognitive Reflex & Confidence Calibration Engine (Architecture 4.0). Computes calibrated confidence ratings, determines System 1 (Reflex Fast-Path <3s) vs System 2 (Deliberate Verified Mode), and detects environmental telemetry anomalies.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: {
            type: "string",
            description: "Target domain (e.g. 'x.com')."
          },
          intent: {
            type: "string",
            description: "High-level action intent (e.g. 'post', 'login')."
          },
          currentLatencyMs: {
            type: "number",
            description: "Optional duration of most recent action to test for server throttling or bot challenge anomalies."
          }
        }
      }
    },
    {
      name: "web_similarity_search",
      description:
        "Semantic Similarity & Intent Vector Search (Architecture 4.0, BigQuery AI.SIMILARITY pattern). Resolves fuzzy user intentions or drifted DOM element descriptions to canonical playbooks and elements without hardcoded dictionaries.",
      inputSchema: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "Fuzzy intent string to classify (e.g. 'tweet thoughts', 'publish update', 'sign on')."
          },
          domain: {
            type: "string",
            description: "Target domain for intent matching."
          },
          targetElementDescription: {
            type: "string",
            description: "Natural language description of target element (e.g. 'post button', 'username input')."
          },
          candidates: {
            type: "array",
            description: "Candidate elements from active DOM/VOM to score for similarity.",
            items: {
              type: "object",
              properties: {
                selector: { type: "string" },
                text: { type: "string" },
                ariaLabel: { type: "string" },
                role: { type: "string" }
              },
              required: ["selector"]
            }
          }
        }
      }
    },
    {
      name: "web_federated_catalog",
      description:
        "Federated Cognitive Catalog & Multi-Profile Mesh (Architecture 4.0, federate_lakehouse_catalog pattern). Shares sanitized, generalized automation recipes across isolated browser profiles without leaking private handles, credentials, or cookies.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list_shared", "publish", "link_profile"],
            description: "Federated action: 'list_shared' (search shared Lakehouse recipes), 'publish' (sanitize and contribute recipe), 'link_profile' (join profile to mesh)."
          },
          domain: {
            type: "string",
            description: "Optional domain filter for shared recipes."
          },
          intent: {
            type: "string",
            description: "Optional intent filter for shared recipes."
          },
          profile: {
            type: "string",
            description: "Active profile identity (e.g. 'epsoldev@gmail.com')."
          },
          recipe: {
            type: "object",
            description: "Recipe payload to sanitize and publish."
          }
        }
      }
    },
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
            enum: ["get", "evaluate", "override"],
            description: "Stage action: 'get' (retrieve current maturity & scaffolding), 'evaluate' (test level-up criteria), 'override' (manually force stage 1-5)."
          },
          stage: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Target stage level for override (1: Sensorimotor Infant, 2: Preoperational Toddler, 3: Concrete Child, 4: Formal Adult, 5: Sovereign Sage)."
          }
        }
      }
    }
  ];
}
