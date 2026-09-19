// ScreenSync Transcendental Executive Cognition & Subconscious Sleep-Consolidation (Architecture 12.0)
// The offline/reflex layer above Architectures 1.0-11.0:
// 1. REM + slow-wave sleep consolidation (Tononi SHY, Diekelmann & Born two-stage model)
// 2. Kahneman System 1 reflex compilation (Logan instance theory of automatism)
// 3. LeDoux amygdala threat inoculation - DEFENSIVE ONLY (detect, back off, extinguish)
// 4. Vygotsky zone of proximal development + scaffolding ladder
// 5. Damasio somatic marker visceral risk appraisal
// 6. Baddeley 4-component working memory
// 7. Hegelian dialectical self-interrogation (thesis -> antithesis -> synthesis)
// 8. Erikson generative wisdom capsules (portable cross-agent inheritance)
//
// Scope note for subsystem 3: this engine detects bot challenges and backs AWAY
// from them. It deliberately does not randomise action cadence, humanise input
// timing or cloak the viewport - commit 5fa992e removed that capability class
// from this project on purpose, and re-adding it under a new name would be a
// regression, not a feature. The correct response to a challenge is to stop and
// hand control to the human (web_request_help).

import { createHash } from "node:crypto";

export interface ExecutionTrace {
  id: string;
  steps?: string[];
  successCount?: number;
  failureCount?: number;
  hasExplicitWaits?: boolean;
  usesShadowPiercing?: boolean;
}

export interface ReflexPlaybook {
  id: string;
  steps: Array<{ action: string; selector?: string; value?: string }>;
  successCount?: number;
  wisdomScore?: number;
}

export interface ThreatRecord {
  fearWeight: number;
  consecutiveTrips: number;
  breakerState: "ARMED" | "TRIPPED" | "EXTINGUISHING";
  lastFingerprint: string | null;
  lastTrippedAt: string | null;
  cleanEncounters: number;
}

/** Challenge fingerprints that trip the subcortical "low road" on sight. */
export const CHALLENGE_FINGERPRINTS = Object.freeze([
  "cloudflare_turnstile",
  "akamai_bot_manager",
  "arkose_labs",
  "datadome",
  "recaptcha",
  "hcaptcha",
  "perimeterx",
]);

/** Counterfactual perturbations replayed during REM. Fixed, so dreams are reproducible. */
const PERTURBATIONS = Object.freeze([
  { id: "occluding_overlay", guard: "assert the target is unoccluded (web_actionable) before clicking" },
  { id: "latency_spike_3000ms", guard: "wrap the step in an explicit web_wait_for instead of a fixed sleep" },
  { id: "selector_drift", guard: "resolve by role/text before falling back to a brittle css selector" },
  { id: "auth_expiry", guard: "re-check the session (web_expect on a logged-in marker) before acting" },
  { id: "shadow_root_reparent", guard: "use a shadow-piercing locator (>>>) rather than a flat query" },
]);

/** Failure vectors the internal adversary raises against a candidate plan. */
const FAILURE_VECTORS = Object.freeze([
  { id: "unpierced_shadow_root", when: (s: string) => /css=|queryselector|^#|^\./.test(s), guard: "locator may sit inside a shadow root - use >>> or pierce/" },
  { id: "disabled_until_in_view", when: (s: string) => /click|submit|press/.test(s), guard: "element may be disabled until scrolled into view - web_scroll_to then web_actionable" },
  { id: "unsaved_state_dialog", when: (s: string) => /navigate|reload|goto|close/.test(s), guard: "navigation may raise beforeunload - run web_contract_check first" },
  { id: "iframe_boundary", when: (s: string) => /click|fill|type/.test(s), guard: "target may live in an iframe - confirm with web_frame_tree, act via web_in_frame" },
  { id: "lazy_mount_race", when: (s: string) => /fill|type|select/.test(s), guard: "control may mount after paint - web_wait_for the selector before input" },
]);

/** Catastrophic intents that dominate the somatic appraisal regardless of wording. */
const CATASTROPHIC = Object.freeze([
  "purge database", "drop database", "delete account", "close account",
  "transfer funds", "wire transfer", "withdraw", "production dns", "rotate key", "revoke access",
]);

/**
 * Destructive-action vocabulary. Deliberately the same regex the page-side unit
 * already enforces (extension/lib/web-unit-interact.js isDestructiveAction) so
 * the hub and the page agree on what "destructive" means.
 */
const DESTRUCTIVE_RE = /delete|remove|destroy|terminate|cancel\s*subscription|drop|pay|purchase|buy|charge/i;

const round = (n: number, dp = 3): number => Math.round(n * 10 ** dp) / 10 ** dp;
const clean = (d: string): string => String(d || "").toLowerCase().trim();

export class TranscendentalCognitionEngine {
  private threats: Map<string, ThreatRecord> = new Map();

  // -- 1. REM + slow-wave sleep consolidation --------------------------------
  /**
   * Replays traces offline. Slow-wave phase scores each trace for consolidation;
   * REM phase permutes it against fixed counterfactuals to surface missing guards.
   * Per Tononi's SHY, total synaptic weight is downscaled - low-yield traces lose
   * their weight so proven ones stand out.
   */
  public remDreamSimulation(domain: string, traces: ExecutionTrace[], cycles = 2): {
    domain: string; cycles: number; scenariosDreamt: number;
    consolidated: Array<{ id: string; weight: number; verdict: string }>;
    distilledHeuristics: string[]; synapticDownscalingFactor: number; advice: string;
  } {
    const d = clean(domain);
    const list = Array.isArray(traces) ? traces : [];
    const consolidated: Array<{ id: string; weight: number; verdict: string }> = [];
    const weakSpots = new Map<string, number>();
    let totalWeightBefore = 0;
    let totalWeightAfter = 0;

    for (const t of list) {
      const wins = t.successCount ?? 0;
      const losses = t.failureCount ?? 0;
      const rawWeight = wins + losses + 1;
      totalWeightBefore += rawWeight;

      // Slow-wave: a trace consolidates only if it actually earned its place.
      const reliability = wins / Math.max(1, wins + losses);
      const keep = wins >= 1 && reliability >= 0.5;
      const weight = keep ? round(reliability * Math.min(1, wins / 5)) : 0;
      totalWeightAfter += keep ? rawWeight : 0;
      consolidated.push({
        id: t.id,
        weight,
        verdict: keep ? "CONSOLIDATED_TO_NEOCORTEX" : "DOWNSCALED_AS_NOISE",
      });

      if (!keep) continue;

      // REM: permute the surviving trace and note which perturbations it cannot absorb.
      for (const p of PERTURBATIONS) {
        const survives =
          (p.id === "latency_spike_3000ms" && t.hasExplicitWaits === true) ||
          (p.id === "shadow_root_reparent" && t.usesShadowPiercing === true);
        if (!survives) weakSpots.set(p.id, (weakSpots.get(p.id) ?? 0) + 1);
      }
    }

    const survivors = consolidated.filter((c) => c.weight > 0).length;
    const scenariosDreamt = survivors * PERTURBATIONS.length * Math.max(1, cycles);
    const distilledHeuristics = [...weakSpots.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, hits]) => {
        const p = PERTURBATIONS.find((x) => x.id === id)!;
        return `${hits} trace(s) fail under '${id}': ${p.guard}`;
      });

    const synapticDownscalingFactor =
      totalWeightBefore === 0 ? 1 : round(totalWeightAfter / totalWeightBefore);

    return {
      domain: d, cycles, scenariosDreamt, consolidated, distilledHeuristics, synapticDownscalingFactor,
      advice: distilledHeuristics.length
        ? "Fold the distilled guards into the playbook before the next live run - they cost nothing offline and prevent a live failure."
        : "No unabsorbed perturbations. The surviving playbooks are already guarded against the known counterfactuals.",
    };
  }

  // -- 2. System 1 reflex compilation ----------------------------------------
  /**
   * Collapses a well-practised System 2 plan into a single atomic System 1 bundle.
   * Gated on Logan's automatism threshold: an instance must be retrieved reliably
   * (>=10 successes) before deliberation can be skipped.
   */
  public system1ReflexCompile(domain: string, playbook: ReflexPlaybook): {
    domain: string; playbookId: string; compiled: boolean; tier: string;
    system2LatencyMs: number; system1LatencyMs: number; speedupFactor: number;
    reflexBundle: string | null; reason: string;
  } {
    const d = clean(domain);
    const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
    const successes = playbook?.successCount ?? 0;
    const wisdom = playbook?.wisdomScore ?? 0;

    // Deliberative cost: each step pays a query + wait + verify round trip.
    const system2LatencyMs = steps.length * 750;
    const system1LatencyMs = round(2 + steps.length * 0.25, 2);

    if (successes < 10) {
      return {
        domain: d, playbookId: playbook?.id ?? "", compiled: false, tier: "SYSTEM_2_DELIBERATIVE",
        system2LatencyMs, system1LatencyMs, speedupFactor: 1, reflexBundle: null,
        reason: `Automatism not reached: ${successes}/10 successful instances. Keep executing deliberately.`,
      };
    }
    if (wisdom < 0.6) {
      return {
        domain: d, playbookId: playbook?.id ?? "", compiled: false, tier: "SYSTEM_2_DELIBERATIVE",
        system2LatencyMs, system1LatencyMs, speedupFactor: 1, reflexBundle: null,
        reason: `Practised but poorly calibrated (wisdom ${wisdom} < 0.6). Compiling now would automate an unreliable habit.`,
      };
    }

    // Self-contained bundle: no imports, no outer scope - it is serialised into the page.
    const body = steps
      .map((s) => {
        const sel = JSON.stringify(s.selector ?? "");
        const val = JSON.stringify(s.value ?? "");
        if (s.action === "fill" || s.action === "type") {
          return `  el = document.querySelector(${sel}); if (!el) return { ok: false, at: ${sel} };\n` +
            `  el.focus(); document.execCommand('insertText', false, ${val});\n` +
            `  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));`;
        }
        return `  el = document.querySelector(${sel}); if (!el) return { ok: false, at: ${sel} };\n  el.click();`;
      })
      .join("\n");
    const reflexBundle = `(function reflex() {\n  var el;\n${body}\n  return { ok: true, steps: ${steps.length} };\n})()`;

    return {
      domain: d, playbookId: playbook.id, compiled: true, tier: "SYSTEM_1_REFLEX",
      system2LatencyMs, system1LatencyMs,
      speedupFactor: round(system2LatencyMs / Math.max(0.01, system1LatencyMs), 1),
      reflexBundle,
      reason: "Instance retrieval is reliable and well calibrated. Deliberation collapsed into one atomic bundle.",
    };
  }

  // -- 3. Amygdala threat inoculation (defensive) ----------------------------
  /**
   * Low road: a known challenge fingerprint or a 429/403 trips the breaker at once.
   * High road: a clean encounter is appraised deliberately and extinguishes fear.
   * The response is always to back off and involve the human - never to evade.
   */
  public amygdalaThreatInoculation(domain: string, signal: {
    fingerprint?: string; httpStatus?: number; challengeDetected?: boolean;
  } = {}): {
    domain: string; pathway: string; breakerState: string; threatLevel: number;
    fearWeight: number; backoffMs: number; fingerprint: string | null;
    handToHuman: boolean; recommendation: string;
  } {
    const d = clean(domain);
    const rec = this.threats.get(d) ?? {
      fearWeight: 0, consecutiveTrips: 0, breakerState: "ARMED" as const,
      lastFingerprint: null, lastTrippedAt: null, cleanEncounters: 0,
    };

    const fp = signal.fingerprint ? String(signal.fingerprint).toLowerCase().trim() : "";
    const known = CHALLENGE_FINGERPRINTS.includes(fp);
    const blocked = signal.httpStatus === 429 || signal.httpStatus === 403;
    const threatened = known || blocked || signal.challengeDetected === true;

    if (threatened) {
      rec.consecutiveTrips += 1;
      rec.cleanEncounters = 0;
      rec.fearWeight = round(Math.min(1, rec.fearWeight + (known ? 0.5 : 0.3)));
      rec.breakerState = "TRIPPED";
      rec.lastFingerprint = known ? fp : blocked ? `http_${signal.httpStatus}` : "unclassified_challenge";
      rec.lastTrippedAt = new Date().toISOString();
      this.threats.set(d, rec);

      const backoffMs = Math.min(300_000, 5_000 * 2 ** (rec.consecutiveTrips - 1));
      return {
        domain: d, pathway: "LOW_ROAD", breakerState: rec.breakerState,
        threatLevel: rec.fearWeight, fearWeight: rec.fearWeight, backoffMs,
        fingerprint: rec.lastFingerprint, handToHuman: true,
        recommendation:
          `Challenge detected (${rec.lastFingerprint}). Freeze automation on ${d}, stop batching, and hand control to the human via web_request_help. ` +
          `Do not retry for ${Math.round(backoffMs / 1000)}s. Solving or evading the challenge is out of scope for this agent.`,
      };
    }

    // High road: deliberate appraisal of a clean encounter - Pavlovian extinction.
    rec.cleanEncounters += 1;
    rec.consecutiveTrips = 0;
    rec.fearWeight = round(Math.max(0, rec.fearWeight * 0.5));
    rec.breakerState = rec.fearWeight <= 0.05 ? "ARMED" : "EXTINGUISHING";
    if (rec.breakerState === "ARMED") rec.fearWeight = 0;
    this.threats.set(d, rec);

    return {
      domain: d, pathway: "HIGH_ROAD", breakerState: rec.breakerState,
      threatLevel: rec.fearWeight, fearWeight: rec.fearWeight, backoffMs: 0,
      fingerprint: rec.lastFingerprint, handToHuman: false,
      recommendation: rec.breakerState === "ARMED"
        ? `No challenge present and fear fully extinguished. ${d} is clear to operate normally.`
        : `Clean encounter recorded. Fear decaying (${rec.fearWeight}); resume cautiously and keep batch sizes small.`,
    };
  }

  /** Read-only view of the breaker, for the dashboard panel. */
  public threatState(domain?: string): Array<ThreatRecord & { domain: string }> {
    const all = [...this.threats.entries()].map(([k, v]) => ({ domain: k, ...v }));
    return domain ? all.filter((r) => r.domain === clean(domain)) : all;
  }

  // -- 4. Vygotsky ZPD scaffolding -------------------------------------------
  /** Pairs an immature pupil domain with a mastered mentor and fades support as it improves. */
  public zpdScaffoldTutor(pupilDomain: string, mentorDomain: string, stats: {
    independentSuccessRate?: number; attempts?: number; sharedPrimitives?: string[];
  } = {}): {
    pupil: string; mentor: string; tier: string; independentSuccessRate: number;
    transferredPrimitives: string[]; withinZpd: boolean; fadeAtRate: number; advice: string;
  } {
    const pupil = clean(pupilDomain);
    const mentor = clean(mentorDomain);
    const rate = Math.max(0, Math.min(1, stats.independentSuccessRate ?? 0));
    const attempts = stats.attempts ?? 0;
    const primitives = Array.isArray(stats.sharedPrimitives) && stats.sharedPrimitives.length
      ? stats.sharedPrimitives
      : ["execCommand_insert_text", "shadow_dom_piercing", "react_input_event_sync"];

    let tier: string;
    let transferred: string[];
    if (rate < 0.3) { tier = "MAXIMAL_DIRECT_GUIDANCE"; transferred = [...primitives]; }
    else if (rate < 0.6) { tier = "PROMPTED_SCAFFOLD"; transferred = primitives.slice(0, 2); }
    else if (rate < 0.85) { tier = "FADING_ASSISTANCE"; transferred = primitives.slice(0, 1); }
    else { tier = "AUTONOMOUS_MASTERY"; transferred = []; }

    return {
      pupil, mentor, tier, independentSuccessRate: round(rate), transferredPrimitives: transferred,
      withinZpd: rate < 0.85, fadeAtRate: 0.85,
      advice: tier === "AUTONOMOUS_MASTERY"
        ? `${pupil} clears the 85% bar on its own. Withdraw ${mentor}'s scaffolding entirely - further help would create dependence.`
        : `${pupil} sits inside the ZPD after ${attempts} attempt(s). Borrow ${transferred.length} verified primitive(s) from ${mentor} and re-measure before fading.`,
    };
  }

  // -- 5. Damasio somatic marker ---------------------------------------------
  /**
   * Pre-motor gut check. Builds on the same destructive vocabulary the page-side
   * unit enforces, then adds a catastrophic tier for irreversible outcomes.
   */
  public somaticMarkerRisk(domain: string, action: {
    tool?: string; target?: string; text?: string; url?: string; irreversible?: boolean;
  } = {}): {
    domain: string; visceralRiskScore: number; somaticGutResponse: string;
    markers: string[]; requiresApproval: boolean; code: string | null; recommendation: string;
  } {
    const d = clean(domain);
    const surface = `${action.target ?? ""} ${action.text ?? ""} ${action.url ?? ""} ${action.tool ?? ""}`.toLowerCase();
    const markers: string[] = [];
    let score = 0;

    const catastrophic = CATASTROPHIC.find((c) => surface.includes(c));
    if (catastrophic) { markers.push(`catastrophic_intent:${catastrophic.replace(/\s+/g, "_")}`); score += 0.7; }
    if (DESTRUCTIVE_RE.test(surface)) { markers.push("destructive_keyword"); score += 0.35; }
    if (action.irreversible === true) { markers.push("declared_irreversible"); score += 0.3; }
    if (/^(post|put|patch|delete)$/i.test(String(action.tool ?? ""))) { markers.push("mutating_request"); score += 0.15; }

    const visceralRiskScore = round(Math.max(0, Math.min(1, score)));
    let somaticGutResponse: string;
    let recommendation: string;
    if (visceralRiskScore >= 0.67) {
      somaticGutResponse = "GUT_VISCERAL_ALARM";
      recommendation = "Blocked before execution. Route through the approval queue and obtain explicit human confirmation for THIS action.";
    } else if (visceralRiskScore >= 0.34) {
      somaticGutResponse = "GUT_APPREHENSIVE";
      recommendation = "Proceed only after a verification pause: capture a pre-action baseline (web_screenshot / web_contract_check) so the step can be audited or undone.";
    } else {
      somaticGutResponse = "GUT_TRANQUIL";
      recommendation = "No somatic marker raised. Safe to execute autonomously under the existing origin grant.";
    }

    return {
      domain: d, visceralRiskScore, somaticGutResponse, markers,
      requiresApproval: somaticGutResponse === "GUT_VISCERAL_ALARM",
      code: somaticGutResponse === "GUT_VISCERAL_ALARM" ? "USER_CONFIRMATION_REQUIRED" : null,
      recommendation,
    };
  }

  // -- 6. Baddeley working memory --------------------------------------------
  /** Load across the four components, with an offload recommendation before thrashing. */
  public baddeleyWorkingMemory(domain: string, buffers: {
    centralExecutive?: number; visuospatialSketchpad?: number;
    phonologicalLoop?: number; episodicBuffer?: number; capacity?: number;
  } = {}): {
    domain: string; capacity: number; components: Record<string, { items: number; load: number }>;
    totalLoad: number; status: string; thrashingRisk: boolean; offloadRecommended: string[]; advice: string;
  } {
    const d = clean(domain);
    const capacity = Math.max(1, buffers.capacity ?? 7); // Miller 7 +/- 2
    const raw: Record<string, number> = {
      centralExecutive: buffers.centralExecutive ?? 0,
      visuospatialSketchpad: buffers.visuospatialSketchpad ?? 0,
      phonologicalLoop: buffers.phonologicalLoop ?? 0,
      episodicBuffer: buffers.episodicBuffer ?? 0,
    };
    const components: Record<string, { items: number; load: number }> = {};
    for (const [k, items] of Object.entries(raw)) {
      components[k] = { items, load: round(Math.min(1, items / capacity)) };
    }
    const totalItems = Object.values(raw).reduce((a, b) => a + b, 0);
    const totalLoad = round(Math.min(1, totalItems / (capacity * 4)));
    const offloadRecommended = Object.entries(components)
      .filter(([, v]) => v.load >= 0.9)
      .map(([k]) => k);
    const thrashingRisk = totalLoad >= 0.9 || offloadRecommended.length > 0;
    const status = totalLoad >= 0.9 ? "OVERLOADED" : totalLoad >= 0.7 ? "STRAINED" : "NOMINAL";

    return {
      domain: d, capacity, components, totalLoad, status, thrashingRisk, offloadRecommended,
      advice: thrashingRisk
        ? `Working memory is saturated. Offload ${offloadRecommended.join(", ") || "the oldest sketchpad entries"} to long-term storage (web_learn) before planning further steps.`
        : `Load is ${status.toLowerCase()}. Keep the next plan within ${capacity} chunks.`,
    };
  }

  // -- 7. Hegelian dialectical synthesis -------------------------------------
  /** Interrogates a plan against fixed failure vectors and returns a guarded blueprint. */
  public dialecticalSynthesis(domain: string, plan: { steps?: string[] } = {}): {
    domain: string; thesis: string[]; antithesis: Array<{ step: string; vector: string; challenge: string }>;
    synthesis: Array<{ step: string; guards: string[] }>; unresolvedCount: number; advice: string;
  } {
    const d = clean(domain);
    const thesis = Array.isArray(plan.steps) ? plan.steps.map(String) : [];
    const antithesis: Array<{ step: string; vector: string; challenge: string }> = [];
    const synthesis: Array<{ step: string; guards: string[] }> = [];

    for (const step of thesis) {
      const probe = step.toLowerCase();
      const guards: string[] = [];
      for (const v of FAILURE_VECTORS) {
        if (!v.when(probe)) continue;
        antithesis.push({ step, vector: v.id, challenge: v.guard });
        guards.push(v.guard);
      }
      synthesis.push({ step, guards });
    }

    const unresolvedCount = synthesis.filter((s) => s.guards.length === 0).length;
    return {
      domain: d, thesis, antithesis, synthesis, unresolvedCount,
      advice: thesis.length === 0
        ? "Empty thesis - supply plan.steps to interrogate."
        : `${antithesis.length} challenge(s) raised across ${thesis.length} step(s). Execute the synthesis, not the thesis.`,
    };
  }

  // -- 8. Erikson generative wisdom capsule ----------------------------------
  /**
   * Seals a domain's lifetime knowledge into a portable capsule. The checksum is a
   * SHA-256 integrity hash over a canonical serialisation - it proves the capsule
   * was not altered in transit, not who authored it.
   */
  public generativeWisdomCapsule(action: string, payload: {
    domain?: string; facts?: unknown[]; playbooks?: unknown[]; pitfalls?: unknown[];
    motorProfiles?: unknown[]; capsule?: Record<string, any>;
  } = {}): Record<string, any> {
    const verb = String(action || "export").toLowerCase();

    if (verb === "import" || verb === "inspect") {
      const capsule = payload.capsule;
      if (!capsule || typeof capsule !== "object") {
        return { action: verb, accepted: false, intact: false, error: "No capsule supplied." };
      }
      const claimed = String(capsule.checksum ?? "");
      const actual = this.capsuleChecksum(capsule.body ?? {});
      const intact = claimed === actual;
      return {
        action: verb, accepted: intact && verb === "import", intact,
        domain: capsule.body?.domain ?? null,
        claimedChecksum: claimed, computedChecksum: actual,
        counts: this.capsuleCounts(capsule.body ?? {}),
        advice: intact
          ? (verb === "import"
            ? "Checksum matches. Wisdom inherited - merge it before the first live action on this domain."
            : "Checksum matches. Capsule is intact and safe to import.")
          : "Checksum mismatch - the capsule was altered or truncated. Refusing to inherit it.",
      };
    }

    const body = {
      domain: clean(payload.domain ?? ""),
      facts: payload.facts ?? [],
      playbooks: payload.playbooks ?? [],
      pitfalls: payload.pitfalls ?? [],
      motorProfiles: payload.motorProfiles ?? [],
      schema: "screensync.wisdom-capsule/12.0",
    };
    const capsule = {
      body,
      checksum: this.capsuleChecksum(body),
      sealedAt: new Date().toISOString(),
      generation: "erikson.generativity",
    };
    return {
      action: "export", capsule, counts: this.capsuleCounts(body),
      advice: "Portable capsule sealed. A fresh agent can import it and skip rediscovering this domain.",
    };
  }

  private capsuleCounts(body: Record<string, any>): Record<string, number> {
    return {
      facts: Array.isArray(body.facts) ? body.facts.length : 0,
      playbooks: Array.isArray(body.playbooks) ? body.playbooks.length : 0,
      pitfalls: Array.isArray(body.pitfalls) ? body.pitfalls.length : 0,
      motorProfiles: Array.isArray(body.motorProfiles) ? body.motorProfiles.length : 0,
    };
  }

  /** Canonical (key-sorted) serialisation so the same content always hashes the same. */
  private capsuleChecksum(body: unknown): string {
    const canonical = (v: any): any => {
      if (Array.isArray(v)) return v.map(canonical);
      if (v && typeof v === "object") {
        return Object.keys(v).sort().reduce((acc: Record<string, any>, k) => { acc[k] = canonical(v[k]); return acc; }, {});
      }
      return v;
    };
    return createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
  }
}

export const globalTranscendentalEngine = new TranscendentalCognitionEngine();
