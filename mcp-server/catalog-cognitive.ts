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
    }
  ];
}
