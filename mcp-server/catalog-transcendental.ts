// ScreenSync Transcendental Executive Cognition & Sleep-Consolidation Catalog (Architecture 12.0)
// Declares schemas for the offline/reflex layer above Architectures 1.0-11.0:
// 1. web_rem_dream_simulation       (Tononi SHY + two-stage model: offline counterfactual replay)
// 2. web_system1_reflex_compile     (Kahneman/Logan: deliberation collapses into one atomic bundle)
// 3. web_amygdala_threat_inoculation(LeDoux dual pathway - DEFENSIVE: detect, back off, extinguish)
// 4. web_zpd_scaffold_tutor         (Vygotsky ZPD: mentor domain scaffolds a pupil domain)
// 5. web_somatic_marker_risk        (Damasio: visceral risk appraisal before a motor action)
// 6. web_baddeley_working_memory    (Baddeley 4-component buffer load + offload)
// 7. web_dialectical_synthesis      (Hegel: thesis -> antithesis -> hardened synthesis)
// 8. web_generative_wisdom_capsule  (Erikson generativity: portable, checksummed wisdom transfer)

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export function transcendentalToolDefinitions(): Tool[] {
  return [
    {
      name: "web_rem_dream_simulation",
      description:
        "Offline sleep consolidation (Architecture 12.0). Slow-wave phase scores each execution trace and downscales low-yield noise (Tononi SHY); REM phase replays survivors against fixed counterfactuals (occluding overlay, 3s latency spike, selector drift, auth expiry, shadow-root reparent) and distils the guards they lack. Runs entirely on stored traces - it opens no tab and touches no live page.",
      inputSchema: {
        type: "object",
        required: ["domain", "traces"],
        properties: {
          domain: { type: "string", description: "Target domain (e.g. 'x.com')." },
          traces: {
            type: "array",
            description: "Stored execution traces: [{ id, successCount?, failureCount?, hasExplicitWaits?, usesShadowPiercing? }].",
            items: {
              type: "object",
              required: ["id"],
              properties: {
                id: { type: "string" },
                successCount: { type: "integer", minimum: 0 },
                failureCount: { type: "integer", minimum: 0 },
                hasExplicitWaits: { type: "boolean" },
                usesShadowPiercing: { type: "boolean" },
              },
            },
          },
          cycles: { type: "integer", minimum: 1, maximum: 10, description: "Sleep cycles to simulate (default 2)." },
        },
      },
    },
    {
      name: "web_system1_reflex_compile",
      description:
        "System 1 reflex compilation (Architecture 12.0). Collapses a well-practised multi-step playbook into a single self-contained in-page bundle, gated on Logan's automatism threshold (>=10 successful instances) and a calibration floor (wisdomScore >= 0.6). Returns the bundle plus a System 2 vs System 1 latency comparison. Refuses to compile an unreliable habit.",
      inputSchema: {
        type: "object",
        required: ["domain", "playbook"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          playbook: {
            type: "object",
            required: ["id", "steps"],
            description: "The playbook to compile.",
            properties: {
              id: { type: "string" },
              steps: {
                type: "array",
                description: "Ordered steps: [{ action: 'click'|'fill'|'type', selector, value? }].",
                items: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    action: { type: "string", enum: ["click", "fill", "type"] },
                    selector: { type: "string" },
                    value: { type: "string" },
                  },
                },
              },
              successCount: { type: "integer", minimum: 0, description: "Consecutive successful executions." },
              wisdomScore: { type: "number", minimum: 0, maximum: 1, description: "Baltes calibration score from web_wisdom_calibration." },
            },
          },
        },
      },
    },
    {
      name: "web_amygdala_threat_inoculation",
      description:
        "Defensive threat appraisal (Architecture 12.0, LeDoux dual-pathway). Low road: a known challenge fingerprint (Cloudflare Turnstile, Akamai, Arkose, DataDome, reCAPTCHA, hCaptcha, PerimeterX) or a 429/403 trips the circuit breaker immediately with an exponential backoff. High road: a clean encounter extinguishes the conditioned fear (Pavlovian decay) so a domain is not penalised forever. The prescribed response is always to STOP and hand control to the human via web_request_help - this tool does not evade, defeat or solve challenges, and deliberately does not randomise cadence or cloak the browser.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          signal: {
            type: "object",
            description: "Observed signal. Omit or pass an empty object to record a clean encounter and extinguish fear.",
            properties: {
              fingerprint: {
                type: "string",
                description: "Detected challenge vendor.",
                enum: ["cloudflare_turnstile", "akamai_bot_manager", "arkose_labs", "datadome", "recaptcha", "hcaptcha", "perimeterx"],
              },
              httpStatus: { type: "integer", description: "Response status; 429 or 403 trips the breaker." },
              challengeDetected: { type: "boolean", description: "An unclassified challenge/interstitial was seen." },
            },
          },
        },
      },
    },
    {
      name: "web_zpd_scaffold_tutor",
      description:
        "Vygotskian peer tutoring (Architecture 12.0). Pairs an immature pupil domain with a mastered mentor domain and picks a scaffolding tier from the pupil's independent success rate: MAXIMAL_DIRECT_GUIDANCE (<0.3), PROMPTED_SCAFFOLD (<0.6), FADING_ASSISTANCE (<0.85), AUTONOMOUS_MASTERY (>=0.85). Transfers verified input primitives downward and withdraws them as the pupil succeeds alone.",
      inputSchema: {
        type: "object",
        required: ["pupilDomain", "mentorDomain"],
        properties: {
          pupilDomain: { type: "string", description: "The immature domain being taught (e.g. 'bsky.app')." },
          mentorDomain: { type: "string", description: "The mastered domain acting as More Knowledgeable Other (e.g. 'x.com')." },
          stats: {
            type: "object",
            description: "Pupil performance.",
            properties: {
              independentSuccessRate: { type: "number", minimum: 0, maximum: 1, description: "Unassisted success rate; scaffolds fade above 0.85." },
              attempts: { type: "integer", minimum: 0 },
              sharedPrimitives: { type: "array", items: { type: "string" }, description: "Primitives the mentor can donate; defaults to the verified input set." },
            },
          },
        },
      },
    },
    {
      name: "web_somatic_marker_risk",
      description:
        "Damasio somatic marker appraisal (Architecture 12.0). Scores an impending action for visceral risk before it executes and returns GUT_TRANQUIL (execute autonomously), GUT_APPREHENSIVE (pause and capture a baseline first) or GUT_VISCERAL_ALARM (block; requires explicit human confirmation, code USER_CONFIRMATION_REQUIRED). Uses the same destructive-keyword vocabulary the page-side unit enforces, plus a catastrophic tier for irreversible outcomes such as account deletion, fund transfer or production DNS changes.",
      inputSchema: {
        type: "object",
        required: ["domain", "action"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          action: {
            type: "object",
            description: "The action about to be performed.",
            properties: {
              tool: { type: "string", description: "Tool or HTTP method (POST/PUT/PATCH/DELETE raise the score)." },
              target: { type: "string", description: "Element label, selector or button text." },
              text: { type: "string", description: "Text about to be submitted." },
              url: { type: "string", description: "Destination URL, if any." },
              irreversible: { type: "boolean", description: "Caller knows this cannot be undone." },
            },
          },
        },
      },
    },
    {
      name: "web_baddeley_working_memory",
      description:
        "Baddeley 4-component working memory (Architecture 12.0). Reports per-component load across the central executive, visuospatial sketchpad, phonological loop and episodic buffer against a Miller 7+/-2 capacity, flags thrashing risk, and names the components to offload to long-term storage once any of them reaches 90%.",
      inputSchema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          buffers: {
            type: "object",
            description: "Item counts currently held in each component.",
            properties: {
              centralExecutive: { type: "integer", minimum: 0, description: "Active goals / conflicts being arbitrated." },
              visuospatialSketchpad: { type: "integer", minimum: 0, description: "Tracked element coordinates and viewport geometry." },
              phonologicalLoop: { type: "integer", minimum: 0, description: "Text tokens and intent hypotheses held verbatim." },
              episodicBuffer: { type: "integer", minimum: 0, description: "Bound multimodal episodes (frame + text + tool result)." },
              capacity: { type: "integer", minimum: 1, maximum: 15, description: "Per-component chunk capacity (default 7)." },
            },
          },
        },
      },
    },
    {
      name: "web_dialectical_synthesis",
      description:
        "Hegelian self-interrogation (Architecture 12.0). Takes a candidate plan as thesis, constructs an internal adversary that raises known failure vectors against each step (unpierced shadow root, disabled-until-in-view, beforeunload on navigation, iframe boundary, lazy mount race), and returns a synthesis in which every challenged step carries a preemptive guard. Execute the synthesis, not the thesis.",
      inputSchema: {
        type: "object",
        required: ["domain", "plan"],
        properties: {
          domain: { type: "string", description: "Target domain." },
          plan: {
            type: "object",
            required: ["steps"],
            description: "The candidate plan.",
            properties: {
              steps: { type: "array", items: { type: "string" }, description: "Ordered step descriptions, e.g. 'click css=#submit'." },
            },
          },
        },
      },
    },
    {
      name: "web_generative_wisdom_capsule",
      description:
        "Erikson generativity transfer (Architecture 12.0). Seals a domain's accumulated facts, playbooks, pitfalls and motor profiles into a portable capsule carrying a SHA-256 integrity checksum over a canonical serialisation, and verifies that checksum on import so an altered or truncated capsule is refused. Lets a freshly initialised agent inherit a mastered domain instead of rediscovering it. The checksum proves integrity, not authorship.",
      inputSchema: {
        type: "object",
        required: ["action"],
        properties: {
          action: { type: "string", enum: ["export", "import", "inspect"], description: "export seals a new capsule; import verifies and accepts one; inspect verifies without accepting." },
          domain: { type: "string", description: "Domain to seal (export only)." },
          facts: { type: "array", description: "Semantic facts to seal (export only).", items: {} },
          playbooks: { type: "array", description: "Master playbooks to seal (export only).", items: {} },
          pitfalls: { type: "array", description: "Known pitfalls to seal (export only).", items: {} },
          motorProfiles: { type: "array", description: "Calibrated motor profiles to seal (export only).", items: {} },
          capsule: {
            type: "object",
            description: "A previously exported capsule (import/inspect only).",
            properties: {
              body: { type: "object", description: "The sealed payload." },
              checksum: { type: "string", description: "SHA-256 over the canonical body." },
            },
          },
        },
      },
    },
  ];
}
