// ScreenSync Adolescent Identity & Adult Executive Cognition Catalog (Architecture 10.0)
// Declares schemas for the child -> adolescent -> adult developmental level system:
// 1. web_synaptic_pruning    (Adolescent use-it-or-lose-it competitive playbook elimination)
// 2. web_critical_period     (Experience-expectant sensitive windows with XP amplification)
// 3. web_working_memory_span (Miller 7+-2 digit-span growth -> plan chunking budgets)
// 4. web_executive_function  (Miyake prefrontal battery: inhibition, shifting, updating)
// 5. web_erikson_identity    (Erikson psychosocial stages -> domain identity coherence)
// 6. web_autonoetic_memory   (Tulving remember/know self-aware recollection)
// 7. web_infant_error_signature (ERN first-error imprint + social referencing caregiver checks)
// 8. web_wisdom_calibration  (Baltes adult wisdom: deep knowledge + humble uncertainty)

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function adolescentToolDefinitions(): Tool[] {
  return [
    {
      name: "web_synaptic_pruning",
      description:
        "Adolescent Synaptic Pruning engine (Architecture 10.0). Applies the use-it-or-lose-it principle to a domain's playbooks: weak or 30-day-stale procedures are competitively eliminated while proven ones (5+ successes) myelinate into fast reflexes. Sharpens domain identity coherence like the adolescent brain.",
      inputSchema: {
        type: "object",
        required: ["domain", "playbooks"],
        properties: {
          domain: { type: "string", description: "Target domain (e.g. 'x.com')." },
          playbooks: {
            type: "array",
            description: "Candidate playbooks with usage stats ({ id, successCount, lastExecutedAt }).",
          },
        },
      },
    },
    {
      name: "web_critical_period",
      description:
        "Critical Period & Sensitive Window gate (Architecture 10.0). Maps domain cognitive age onto experience-expectant plasticity windows (sensory calibration 0-2y, procedural imprint 2-7y, abstract transfer 7-16y, expert intuition 16-40y) and returns the amplified XP multiplier for learning that happens inside the window.",
      inputSchema: {
        type: "object",
        required: ["cognitiveAgeYears", "baseXp"],
        properties: {
          cognitiveAgeYears: { type: "number", description: "Current domain cognitive age (from web_cognitive_lifespan)." },
          baseXp: { type: "number", description: "Base XP earned by the learning event before window amplification." },
        },
      },
    },
    {
      name: "web_working_memory_span",
      description:
        "Working Memory Digit Span engine (Architecture 10.0, Miller 7+-2). Derives the domain's working-memory chunk capacity from cognitive age (2 chunks infant -> 7 chunks adult) and returns the recommended maximum steps per execution plan plus chunking advice, so plans never exceed the agent's developmental span.",
      inputSchema: {
        type: "object",
        required: ["domain", "cognitiveAgeYears"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          cognitiveAgeYears: { type: "number", description: "Current domain cognitive age." },
        },
      },
    },
    {
      name: "web_executive_function",
      description:
        "Prefrontal Executive Function battery (Architecture 10.0, Miyake 2000). Scores the three core executive functions from live telemetry: inhibition (resisting distraction clicks), task-shifting (strategy switches after failure), and updating (state refreshes per action). Returns a prefrontal maturity grade from IMMATURE_CHILD to SAGE_EXECUTIVE.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          telemetry: {
            type: "object",
            description: "Optional counters: { resistedDistractionClicks, totalDistractions, strategySwitchesAfterFailure, failedAttempts, stateRefreshCount, actionCount }.",
          },
        },
      },
    },
    {
      name: "web_erikson_identity",
      description:
        "Erikson Psychosocial Identity engine (Architecture 10.0). Maps cognitive age onto the eight psychosocial crises (Trust vs Mistrust ... Ego Integrity vs Despair) and computes domain identity coherence from the ratio of consistent knowledge pieces to contradictions — resolving 'identity vs role confusion' for adolescent-stage domains.",
      inputSchema: {
        type: "object",
        required: ["domain", "cognitiveAgeYears"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          cognitiveAgeYears: { type: "number", description: "Current domain cognitive age." },
          knowledgePieces: { type: "integer", description: "Total learned facts/playbooks/pitfalls for the domain." },
          contradictions: { type: "integer", description: "Known contradictory or deprecated entries." },
        },
      },
    },
    {
      name: "web_autonoetic_memory",
      description:
        "Tulving Autonoetic Self-Awareness tagger (Architecture 10.0). Classifies recalled episodes as REMEMBER (relived via episodic replay, high certainty) or KNOW (familiar semantic fact, moderate certainty), so the agent distinguishes 'I was there and it worked' from 'I have heard this works'.",
      inputSchema: {
        type: "object",
        required: ["domain", "episodeIds", "recallSource"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          episodeIds: { type: "array", items: { type: "string" }, description: "Episode IDs being recalled." },
          recallSource: { type: "string", enum: ["replay", "semantic"], description: "'replay' = hippocampal episodic re-experience; 'semantic' = abstracted fact." },
        },
      },
    },
    {
      name: "web_infant_error_signature",
      description:
        "Infant Error-Related Negativity & Social Referencing engine (Architecture 10.0). The first error on a new domain receives a permanent ERN imprint signature (deepest learning trace), and risky planned actions at immature developmental stages trigger a social-referencing caregiver check — the agent pauses and asks the human to glance, like a child checking a parent's face.",
      inputSchema: {
        type: "object",
        required: ["domain", "event"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          event: {
            type: "object",
            description: "{ errorOccurred: boolean, riskyActionPlanned?: boolean }.",
          },
        },
      },
    },
    {
      name: "web_wisdom_calibration",
      description:
        "Baltes Adult Wisdom Calibration engine (Architecture 10.0). Scores wisdom as deep domain knowledge multiplied by uncertainty calibration (stated confidence vs measured accuracy). Detects ADOLESCENT_OVERCONFIDENCE (confidence > accuracy) and IMPOSTER_CHILD (accuracy > confidence, grant more autonomy) states.",
      inputSchema: {
        type: "object",
        required: ["domain", "knowledgeDepth", "statedConfidence", "measuredAccuracy"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          knowledgeDepth: { type: "number", description: "0..1 depth of accumulated domain knowledge." },
          statedConfidence: { type: "number", description: "0..1 confidence the agent claims." },
          measuredAccuracy: { type: "number", description: "0..1 actual recent success rate." },
        },
      },
    },
  ];
}

