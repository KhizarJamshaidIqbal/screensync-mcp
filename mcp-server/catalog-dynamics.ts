// ScreenSync Motivated Learning Dynamics & Prospective Memory Catalog (Architecture 11.0)
// Declares schemas for the memory-dynamics layer of the child -> adult system:
// 1. web_assimilation_accommodation (Piaget equilibration: fit the schema or rewrite it)
// 2. web_forgetting_curve        (Ebbinghaus decay R=e^(-t/S) + spaced repetition schedule)
// 3. web_reinforcement_schedule  (Operant conditioning practice cadence: continuous -> variable interval)
// 4. web_prospective_memory      (Gollwitzer implementation intentions: "when event X, do Y")
// 5. web_source_monitoring       (Johnson source attribution & misattribution detection)
// 6. web_interference_check      (Proactive/retroactive interference between similar domains)
// 7. web_reward_prediction_error (Schultz dopamine RPE: surprise modulates learning rate)
// 8. web_cognitive_load_budget   (Sweller CLT: intrinsic + extraneous + germane vs chunk capacity)

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function dynamicsToolDefinitions(): Tool[] {
  return [
    {
      name: "web_assimilation_accommodation",
      description:
        "Piaget Equilibration engine (Architecture 11.0). Decides whether new page evidence ASSIMILATES into the existing playbook schema (reinforce it) or forces ACCOMMODATION (heal the failing step for partial mismatches, or create a brand-new schema for radically new structures).",
      inputSchema: {
        type: "object",
        required: ["domain", "observation"],
        properties: {
          domain: { type: "string", description: "Target domain (e.g. 'x.com')." },
          observation: {
            type: "object",
            description: "{ matchesExistingSchema: boolean, schemaId?: string, noveltyScore?: 0..1 }.",
          },
        },
      },
    },
    {
      name: "web_forgetting_curve",
      description:
        "Ebbinghaus Forgetting Curve & Spaced Repetition scheduler (Architecture 11.0). Computes retention R = e^(-t/S) per learned item, lists memories whose retention fell below 0.6 (review due NOW), and assigns the next expanding review interval (1d, 3d, 7d, 16d, 35d).",
      inputSchema: {
        type: "object",
        required: ["domain", "items"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          items: {
            type: "array",
            description: "Learned items: [{ id, learnedAt (ISO), reviewCount?, strength? }].",
          },
        },
      },
    },
    {
      name: "web_reinforcement_schedule",
      description:
        "Operant Conditioning Reinforcement Schedule engine (Architecture 11.0). Selects the practice cadence for a domain skill: CONTINUOUS (every attempt rewarded, acquisition phase), FIXED_INTERVAL (daily spaced practice, consolidation), or VARIABLE_INTERVAL (unpredictable practice, extinction-resistant mastery).",
      inputSchema: {
        type: "object",
        required: ["domain", "successStreak", "totalAttempts"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          successStreak: { type: "integer", description: "Consecutive successful runs." },
          totalAttempts: { type: "integer", description: "Lifetime attempts on this domain." },
          hoursSinceLastPractice: { type: "number", description: "Hours since the skill was last exercised." },
        },
      },
    },
    {
      name: "web_prospective_memory",
      description:
        "Prospective Memory & Implementation Intentions engine (Architecture 11.0, Gollwitzer). Registers future intentions of the form 'WHEN triggerEvent (e.g. login_wall, modal_appears, toast_success) THEN actionPlan', and fires matching intentions when an observed event arrives — remembering to remember.",
      inputSchema: {
        type: "object",
        required: ["domain", "action"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          action: { type: "string", enum: ["register", "check"], description: "'register' a new intention or 'check' an observed event against stored intentions." },
          intention: {
            type: "object",
            description: "For register: { triggerEvent: string, actionPlan: string }.",
          },
          observedEvent: { type: "string", description: "For check: the event just observed (e.g. 'login_wall')." },
        },
      },
    },
    {
      name: "web_source_monitoring",
      description:
        "Source Monitoring engine (Architecture 11.0, Johnson). Verifies WHERE each learned fact actually came from versus where the agent thinks it came from. Detects misattributions (a playbook remembered as from x.com but really learned on threads.net) and maintains a per-source trust ledger.",
      inputSchema: {
        type: "object",
        required: ["domain", "facts"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          facts: {
            type: "array",
            description: "[{ id, claimedSource, actualEvidenceSource? }] — omit actualEvidenceSource to mark first-hand verified.",
          },
        },
      },
    },
    {
      name: "web_interference_check",
      description:
        "Proactive & Retroactive Interference analyzer (Architecture 11.0). Measures how similar-domain playbooks corrupt each other: proactive interference (old x.com habits leaking into threads.net) and retroactive interference (new learning eroding the old skill), with isolation advice.",
      inputSchema: {
        type: "object",
        required: ["domain", "others"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          others: {
            type: "array",
            description: "Similar domains: [{ domain, sharedSelectors: number, conflictingSteps: number }].",
          },
        },
      },
    },
    {
      name: "web_reward_prediction_error",
      description:
        "Dopaminergic Reward Prediction Error engine (Architecture 11.0, Schultz). Compares expected vs actual task reward: positive surprise (PHASIC_BURST) triggers hard LTP consolidation, negative surprise (PHASIC_DIP) is the richest pitfall-learning moment, matched predictions require no learning.",
      inputSchema: {
        type: "object",
        required: ["domain", "expectedReward", "actualReward"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          expectedReward: { type: "number", description: "0..1 predicted success/value." },
          actualReward: { type: "number", description: "0..1 observed outcome value." },
        },
      },
    },
    {
      name: "web_cognitive_load_budget",
      description:
        "Sweller Cognitive Load Theory budgeter (Architecture 11.0). Weighs intrinsic (task complexity) + extraneous (DOM noise) + germane (schema building) load against the domain's working-memory chunk capacity, flags COGNITIVE_OVERLOAD, and prescribes simplification (chunking, reader mode, page digest).",
      inputSchema: {
        type: "object",
        required: ["domain", "intrinsic", "extraneous", "germane"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          intrinsic: { type: "number", description: "Chunks of inherent task complexity." },
          extraneous: { type: "number", description: "Chunks of avoidable noise (ads, decorative DOM)." },
          germane: { type: "number", description: "Chunks devoted to learning/schema building." },
          capacityChunks: { type: "integer", description: "Working-memory capacity (default 7 — see web_working_memory_span)." },
        },
      },
    },
  ];
}
