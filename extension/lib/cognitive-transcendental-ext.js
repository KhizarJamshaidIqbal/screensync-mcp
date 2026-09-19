// ScreenSync Extension Transcendental Executive Cognition Unit (Architecture 12.0)
// Client-side mirror of cognitive-transcendental.ts:
// 1. REM + slow-wave sleep consolidation (offline counterfactual replay)
// 2. System 1 reflex compilation (deliberation -> one atomic in-page bundle)
// 3. Amygdala threat inoculation - DEFENSIVE ONLY (detect, back off, extinguish)
// 4. Vygotsky ZPD scaffolding ladder
// 5. Damasio somatic marker visceral risk appraisal
// 6. Baddeley 4-component working memory
// 7. Hegelian dialectical synthesis
// 8. Erikson generative wisdom capsules
//
// Subsystem 3 detects bot challenges and backs AWAY from them. It does not
// randomise cadence, humanise timing or cloak the viewport - that capability
// class was removed from this project deliberately (commit 5fa992e). The
// prescribed response to a challenge is to stop and ask the human.

function normalizeDomain(input) {
  if (!input) return '';
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(input).replace(/^www\./, '').toLowerCase();
  }
}

const round = (n, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

export const CHALLENGE_FINGERPRINTS = [
  'cloudflare_turnstile', 'akamai_bot_manager', 'arkose_labs',
  'datadome', 'recaptcha', 'hcaptcha', 'perimeterx',
];

const PERTURBATIONS = [
  { id: 'occluding_overlay', guard: 'assert the target is unoccluded (web_actionable) before clicking' },
  { id: 'latency_spike_3000ms', guard: 'wrap the step in an explicit web_wait_for instead of a fixed sleep' },
  { id: 'selector_drift', guard: 'resolve by role/text before falling back to a brittle css selector' },
  { id: 'auth_expiry', guard: 're-check the session (web_expect on a logged-in marker) before acting' },
  { id: 'shadow_root_reparent', guard: 'use a shadow-piercing locator (>>>) rather than a flat query' },
];

const FAILURE_VECTORS = [
  { id: 'unpierced_shadow_root', re: /css=|queryselector|^#|^\./, guard: 'locator may sit inside a shadow root - use >>> or pierce/' },
  { id: 'disabled_until_in_view', re: /click|submit|press/, guard: 'element may be disabled until scrolled into view - web_scroll_to then web_actionable' },
  { id: 'unsaved_state_dialog', re: /navigate|reload|goto|close/, guard: 'navigation may raise beforeunload - run web_contract_check first' },
  { id: 'iframe_boundary', re: /click|fill|type/, guard: 'target may live in an iframe - confirm with web_frame_tree, act via web_in_frame' },
  { id: 'lazy_mount_race', re: /fill|type|select/, guard: 'control may mount after paint - web_wait_for the selector before input' },
];

const CATASTROPHIC = [
  'purge database', 'drop database', 'delete account', 'close account',
  'transfer funds', 'wire transfer', 'withdraw', 'production dns', 'rotate key', 'revoke access',
];

// Same vocabulary the page-side interact unit enforces, so hub and page agree.
const DESTRUCTIVE_RE = /delete|remove|destroy|terminate|cancel\s*subscription|drop|pay|purchase|buy|charge/i;

/** domain -> threat record. Read by the dashboard threat panel. */
const THREAT_STATE = new Map();

export function getThreatState(domain) {
  const all = [...THREAT_STATE.entries()].map(([k, v]) => ({ domain: k, ...v }));
  return domain ? all.filter((r) => r.domain === normalizeDomain(domain)) : all;
}

export async function execWebRemDreamSimulation(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const traces = Array.isArray(args.traces) ? args.traces : [];
  const cycles = typeof args.cycles === 'number' ? args.cycles : 2;
  const consolidated = [];
  const weakSpots = new Map();
  let before = 0;
  let after = 0;

  for (const t of traces) {
    const wins = t.successCount || 0;
    const losses = t.failureCount || 0;
    before += wins + losses + 1;
    const reliability = wins / Math.max(1, wins + losses);
    const keep = wins >= 1 && reliability >= 0.5;
    after += keep ? wins + losses + 1 : 0;
    consolidated.push({
      id: t.id,
      weight: keep ? round(reliability * Math.min(1, wins / 5)) : 0,
      verdict: keep ? 'CONSOLIDATED_TO_NEOCORTEX' : 'DOWNSCALED_AS_NOISE',
    });
    if (!keep) continue;
    for (const p of PERTURBATIONS) {
      const survives =
        (p.id === 'latency_spike_3000ms' && t.hasExplicitWaits === true) ||
        (p.id === 'shadow_root_reparent' && t.usesShadowPiercing === true);
      if (!survives) weakSpots.set(p.id, (weakSpots.get(p.id) || 0) + 1);
    }
  }

  const survivors = consolidated.filter((c) => c.weight > 0).length;
  const distilledHeuristics = [...weakSpots.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, hits]) => `${hits} trace(s) fail under '${id}': ${PERTURBATIONS.find((p) => p.id === id).guard}`);

  return {
    ok: true,
    data: {
      domain, cycles,
      scenariosDreamt: survivors * PERTURBATIONS.length * Math.max(1, cycles),
      consolidated, distilledHeuristics,
      synapticDownscalingFactor: before === 0 ? 1 : round(after / before),
      advice: distilledHeuristics.length
        ? 'Fold the distilled guards into the playbook before the next live run.'
        : 'No unabsorbed perturbations. Surviving playbooks are already guarded.',
    },
  };
}

export async function execWebSystem1ReflexCompile(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const pb = args.playbook || { id: '', steps: [] };
  const steps = Array.isArray(pb.steps) ? pb.steps : [];
  const successes = pb.successCount || 0;
  const wisdom = pb.wisdomScore || 0;
  const system2LatencyMs = steps.length * 750;
  const system1LatencyMs = round(2 + steps.length * 0.25, 2);

  if (successes < 10 || wisdom < 0.6) {
    return {
      ok: true,
      data: {
        domain, playbookId: pb.id || '', compiled: false, tier: 'SYSTEM_2_DELIBERATIVE',
        system2LatencyMs, system1LatencyMs, speedupFactor: 1, reflexBundle: null,
        reason: successes < 10
          ? `Automatism not reached: ${successes}/10 successful instances. Keep executing deliberately.`
          : `Practised but poorly calibrated (wisdom ${wisdom} < 0.6). Compiling would automate an unreliable habit.`,
      },
    };
  }

  const body = steps.map((s) => {
    const sel = JSON.stringify(s.selector || '');
    const val = JSON.stringify(s.value || '');
    if (s.action === 'fill' || s.action === 'type') {
      return `  el = document.querySelector(${sel}); if (!el) return { ok: false, at: ${sel} };\n` +
        `  el.focus(); document.execCommand('insertText', false, ${val});\n` +
        `  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));`;
    }
    return `  el = document.querySelector(${sel}); if (!el) return { ok: false, at: ${sel} };\n  el.click();`;
  }).join('\n');

  return {
    ok: true,
    data: {
      domain, playbookId: pb.id, compiled: true, tier: 'SYSTEM_1_REFLEX',
      system2LatencyMs, system1LatencyMs,
      speedupFactor: round(system2LatencyMs / Math.max(0.01, system1LatencyMs), 1),
      reflexBundle: `(function reflex() {\n  var el;\n${body}\n  return { ok: true, steps: ${steps.length} };\n})()`,
      reason: 'Instance retrieval is reliable and well calibrated. Deliberation collapsed into one atomic bundle.',
    },
  };
}

export async function execWebAmygdalaThreatInoculation(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const signal = args.signal || {};
  const rec = THREAT_STATE.get(domain) || {
    fearWeight: 0, consecutiveTrips: 0, breakerState: 'ARMED',
    lastFingerprint: null, lastTrippedAt: null, cleanEncounters: 0,
  };

  const fp = signal.fingerprint ? String(signal.fingerprint).toLowerCase().trim() : '';
  const known = CHALLENGE_FINGERPRINTS.includes(fp);
  const blocked = signal.httpStatus === 429 || signal.httpStatus === 403;

  if (known || blocked || signal.challengeDetected === true) {
    rec.consecutiveTrips += 1;
    rec.cleanEncounters = 0;
    rec.fearWeight = round(Math.min(1, rec.fearWeight + (known ? 0.5 : 0.3)));
    rec.breakerState = 'TRIPPED';
    rec.lastFingerprint = known ? fp : blocked ? `http_${signal.httpStatus}` : 'unclassified_challenge';
    rec.lastTrippedAt = new Date().toISOString();
    THREAT_STATE.set(domain, rec);
    const backoffMs = Math.min(300000, 5000 * 2 ** (rec.consecutiveTrips - 1));
    return {
      ok: true,
      data: {
        domain, pathway: 'LOW_ROAD', breakerState: rec.breakerState,
        threatLevel: rec.fearWeight, fearWeight: rec.fearWeight, backoffMs,
        fingerprint: rec.lastFingerprint, handToHuman: true,
        recommendation: `Challenge detected (${rec.lastFingerprint}). Freeze automation on ${domain}, stop batching, and hand control to the human via web_request_help. Do not retry for ${Math.round(backoffMs / 1000)}s. Solving or evading the challenge is out of scope for this agent.`,
      },
    };
  }

  rec.cleanEncounters += 1;
  rec.consecutiveTrips = 0;
  rec.fearWeight = round(Math.max(0, rec.fearWeight * 0.5));
  rec.breakerState = rec.fearWeight <= 0.05 ? 'ARMED' : 'EXTINGUISHING';
  if (rec.breakerState === 'ARMED') rec.fearWeight = 0;
  THREAT_STATE.set(domain, rec);

  return {
    ok: true,
    data: {
      domain, pathway: 'HIGH_ROAD', breakerState: rec.breakerState,
      threatLevel: rec.fearWeight, fearWeight: rec.fearWeight, backoffMs: 0,
      fingerprint: rec.lastFingerprint, handToHuman: false,
      recommendation: rec.breakerState === 'ARMED'
        ? `No challenge present and fear fully extinguished. ${domain} is clear to operate normally.`
        : `Clean encounter recorded. Fear decaying (${rec.fearWeight}); resume cautiously and keep batch sizes small.`,
    },
  };
}

export async function execWebZpdScaffoldTutor(args = {}) {
  const pupil = normalizeDomain(args.pupilDomain);
  const mentor = normalizeDomain(args.mentorDomain);
  const stats = args.stats || {};
  const rate = Math.max(0, Math.min(1, stats.independentSuccessRate || 0));
  const primitives = Array.isArray(stats.sharedPrimitives) && stats.sharedPrimitives.length
    ? stats.sharedPrimitives
    : ['execCommand_insert_text', 'shadow_dom_piercing', 'react_input_event_sync'];

  let tier;
  let transferred;
  if (rate < 0.3) { tier = 'MAXIMAL_DIRECT_GUIDANCE'; transferred = [...primitives]; }
  else if (rate < 0.6) { tier = 'PROMPTED_SCAFFOLD'; transferred = primitives.slice(0, 2); }
  else if (rate < 0.85) { tier = 'FADING_ASSISTANCE'; transferred = primitives.slice(0, 1); }
  else { tier = 'AUTONOMOUS_MASTERY'; transferred = []; }

  return {
    ok: true,
    data: {
      pupil, mentor, tier, independentSuccessRate: round(rate),
      transferredPrimitives: transferred, withinZpd: rate < 0.85, fadeAtRate: 0.85,
      advice: tier === 'AUTONOMOUS_MASTERY'
        ? `${pupil} clears the 85% bar alone. Withdraw ${mentor}'s scaffolding entirely.`
        : `${pupil} sits inside the ZPD. Borrow ${transferred.length} primitive(s) from ${mentor} and re-measure before fading.`,
    },
  };
}

export async function execWebSomaticMarkerRisk(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const action = args.action || {};
  const surface = `${action.target || ''} ${action.text || ''} ${action.url || ''} ${action.tool || ''}`.toLowerCase();
  const markers = [];
  let score = 0;

  const catastrophic = CATASTROPHIC.find((c) => surface.includes(c));
  if (catastrophic) { markers.push(`catastrophic_intent:${catastrophic.replace(/\s+/g, '_')}`); score += 0.7; }
  if (DESTRUCTIVE_RE.test(surface)) { markers.push('destructive_keyword'); score += 0.35; }
  if (action.irreversible === true) { markers.push('declared_irreversible'); score += 0.3; }
  if (/^(post|put|patch|delete)$/i.test(String(action.tool || ''))) { markers.push('mutating_request'); score += 0.15; }

  const visceralRiskScore = round(Math.max(0, Math.min(1, score)));
  let somaticGutResponse;
  let recommendation;
  if (visceralRiskScore >= 0.67) {
    somaticGutResponse = 'GUT_VISCERAL_ALARM';
    recommendation = 'Blocked before execution. Route through the approval queue and obtain explicit human confirmation for THIS action.';
  } else if (visceralRiskScore >= 0.34) {
    somaticGutResponse = 'GUT_APPREHENSIVE';
    recommendation = 'Proceed only after a verification pause: capture a pre-action baseline so the step can be audited or undone.';
  } else {
    somaticGutResponse = 'GUT_TRANQUIL';
    recommendation = 'No somatic marker raised. Safe to execute autonomously under the existing origin grant.';
  }

  return {
    ok: true,
    data: {
      domain, visceralRiskScore, somaticGutResponse, markers,
      requiresApproval: somaticGutResponse === 'GUT_VISCERAL_ALARM',
      code: somaticGutResponse === 'GUT_VISCERAL_ALARM' ? 'USER_CONFIRMATION_REQUIRED' : null,
      recommendation,
    },
  };
}

export async function execWebBaddeleyWorkingMemory(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const b = args.buffers || {};
  const capacity = Math.max(1, b.capacity || 7);
  const raw = {
    centralExecutive: b.centralExecutive || 0,
    visuospatialSketchpad: b.visuospatialSketchpad || 0,
    phonologicalLoop: b.phonologicalLoop || 0,
    episodicBuffer: b.episodicBuffer || 0,
  };
  const components = {};
  for (const [k, items] of Object.entries(raw)) {
    components[k] = { items, load: round(Math.min(1, items / capacity)) };
  }
  const totalItems = Object.values(raw).reduce((a, x) => a + x, 0);
  const totalLoad = round(Math.min(1, totalItems / (capacity * 4)));
  const offloadRecommended = Object.entries(components).filter(([, v]) => v.load >= 0.9).map(([k]) => k);
  const thrashingRisk = totalLoad >= 0.9 || offloadRecommended.length > 0;
  const status = totalLoad >= 0.9 ? 'OVERLOADED' : totalLoad >= 0.7 ? 'STRAINED' : 'NOMINAL';

  return {
    ok: true,
    data: {
      domain, capacity, components, totalLoad, status, thrashingRisk, offloadRecommended,
      advice: thrashingRisk
        ? `Working memory saturated. Offload ${offloadRecommended.join(', ') || 'the oldest sketchpad entries'} via web_learn before planning further.`
        : `Load is ${status.toLowerCase()}. Keep the next plan within ${capacity} chunks.`,
    },
  };
}

export async function execWebDialecticalSynthesis(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const plan = args.plan || {};
  const thesis = Array.isArray(plan.steps) ? plan.steps.map(String) : [];
  const antithesis = [];
  const synthesis = [];

  for (const step of thesis) {
    const probe = step.toLowerCase();
    const guards = [];
    for (const v of FAILURE_VECTORS) {
      if (!v.re.test(probe)) continue;
      antithesis.push({ step, vector: v.id, challenge: v.guard });
      guards.push(v.guard);
    }
    synthesis.push({ step, guards });
  }

  return {
    ok: true,
    data: {
      domain, thesis, antithesis, synthesis,
      unresolvedCount: synthesis.filter((s) => s.guards.length === 0).length,
      advice: thesis.length === 0
        ? 'Empty thesis - supply plan.steps to interrogate.'
        : `${antithesis.length} challenge(s) raised across ${thesis.length} step(s). Execute the synthesis, not the thesis.`,
    },
  };
}

/** Canonical (key-sorted) serialisation, byte-identical to the hub's. */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonical(v[k]); return acc; }, {});
  }
  return v;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function execWebGenerativeWisdomCapsule(args = {}) {
  const verb = String(args.action || 'export').toLowerCase();

  if (verb === 'import' || verb === 'inspect') {
    const capsule = args.capsule;
    if (!capsule || typeof capsule !== 'object') {
      return { ok: true, data: { action: verb, accepted: false, intact: false, error: 'No capsule supplied.' } };
    }
    const claimed = String(capsule.checksum || '');
    const actual = await sha256Hex(JSON.stringify(canonical(capsule.body || {})));
    const intact = claimed === actual;
    return {
      ok: true,
      data: {
        action: verb, accepted: intact && verb === 'import', intact,
        domain: (capsule.body && capsule.body.domain) || null,
        claimedChecksum: claimed, computedChecksum: actual,
        advice: intact
          ? 'Checksum matches. Capsule is intact.'
          : 'Checksum mismatch - the capsule was altered or truncated. Refusing to inherit it.',
      },
    };
  }

  const body = {
    domain: normalizeDomain(args.domain),
    facts: args.facts || [],
    playbooks: args.playbooks || [],
    pitfalls: args.pitfalls || [],
    motorProfiles: args.motorProfiles || [],
    schema: 'screensync.wisdom-capsule/12.0',
  };
  return {
    ok: true,
    data: {
      action: 'export',
      capsule: {
        body,
        checksum: await sha256Hex(JSON.stringify(canonical(body))),
        sealedAt: new Date().toISOString(),
        generation: 'erikson.generativity',
      },
      advice: 'Portable capsule sealed. A fresh agent can import it and skip rediscovering this domain.',
    },
  };
}

export async function execCognitiveTranscendentalTool(tool, args = {}) {
  switch (tool) {
    case 'web_rem_dream_simulation': return execWebRemDreamSimulation(args);
    case 'web_system1_reflex_compile': return execWebSystem1ReflexCompile(args);
    case 'web_amygdala_threat_inoculation': return execWebAmygdalaThreatInoculation(args);
    case 'web_zpd_scaffold_tutor': return execWebZpdScaffoldTutor(args);
    case 'web_somatic_marker_risk': return execWebSomaticMarkerRisk(args);
    case 'web_baddeley_working_memory': return execWebBaddeleyWorkingMemory(args);
    case 'web_dialectical_synthesis': return execWebDialecticalSynthesis(args);
    case 'web_generative_wisdom_capsule': return execWebGenerativeWisdomCapsule(args);
    default: return { ok: false, error: `Unknown transcendental tool: ${tool}` };
  }
}
