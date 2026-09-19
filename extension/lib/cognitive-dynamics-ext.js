// ScreenSync Extension Motivated Learning Dynamics & Prospective Memory Unit (Architecture 11.0)
// Modular client-side unit for:
// 1. Piaget Assimilation vs Accommodation
// 2. Ebbinghaus Forgetting Curve + Spaced Repetition
// 3. Operant Conditioning Reinforcement Schedules
// 4. Prospective Memory (implementation intentions)
// 5. Source Monitoring (misattribution detection)
// 6. Proactive/Retroactive Interference
// 7. Dopaminergic Reward Prediction Error
// 8. Sweller Cognitive Load Budgeting
//
// Last link but one in the cognitive chain: anything this unit does not own
// falls through to the Architecture 12.0 transcendental unit.

import { execCognitiveTranscendentalTool } from './cognitive-transcendental-ext.js';

function normalizeDomain(input) {
  if (!input) return '';
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(input).replace(/^www\./, '').toLowerCase();
  }
}

const FORGETTING_STATE = new Map(); // domain -> prospective intentions

export async function execWebAssimilationAccommodation(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const obs = args.observation || {};
  if (obs.matchesExistingSchema) {
    return { ok: true, data: { domain, process: 'ASSIMILATION', schemaAction: 'reinforce', confidenceDelta: 0.05, advice: 'Evidence fits the existing schema. Reinforce the playbook (LTP) — no rewrite needed.' } };
  }
  const novelty = typeof obs.noveltyScore === 'number' ? obs.noveltyScore : 0.5;
  return novelty >= 0.7
    ? { ok: true, data: { domain, process: 'ACCOMMODATION', schemaAction: 'create', confidenceDelta: -0.1, advice: 'Radically new structure detected. Create a NEW schema/playbook instead of distorting the old one.' } }
    : { ok: true, data: { domain, process: 'ACCOMMODATION', schemaAction: 'rewrite', confidenceDelta: -0.05, advice: 'Partial mismatch. Rewrite the failing step/selector (heal), then re-verify.' } };
}

export async function execWebForgettingCurve(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const items = Array.isArray(args.items) ? args.items : [];
  const now = Date.now();
  const intervalsDays = [1, 3, 7, 16, 35];
  const retained = [];
  const reviewDue = [];
  const nextReviewSchedule = {};
  for (const item of items) {
    const days = Math.max(0, (now - new Date(item.learnedAt).getTime()) / 86400000);
    const S = (item.strength ?? 1) * (1 + (item.reviewCount ?? 0));
    const retention = Math.exp(-days / Math.max(0.5, S));
    retained.push({ id: item.id, retention: Math.round(retention * 1000) / 1000 });
    if (retention < 0.6) reviewDue.push(item.id);
    const idx = Math.min(item.reviewCount ?? 0, intervalsDays.length - 1);
    nextReviewSchedule[item.id] = new Date(now + intervalsDays[idx] * 86400000).toISOString();
  }
  return { ok: true, data: { domain, retained, reviewDue, nextReviewSchedule } };
}

export async function execWebReinforcementSchedule(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const streak = args.successStreak || 0;
  const attempts = args.totalAttempts || 0;
  const hours = typeof args.hoursSinceLastPractice === 'number' ? args.hoursSinceLastPractice : 999;
  if (attempts < 5 || streak < 3) {
    return { ok: true, data: { domain, schedule: 'CONTINUOUS', practiceDueNow: true, resistanceToExtinction: 0.2, rationale: 'Early acquisition: reinforce every attempt.' } };
  }
  if (streak < 10) {
    return { ok: true, data: { domain, schedule: 'FIXED_INTERVAL', practiceDueNow: hours >= 24, resistanceToExtinction: 0.5, rationale: 'Consolidation: daily spaced practice.' } };
  }
  return { ok: true, data: { domain, schedule: 'VARIABLE_INTERVAL', practiceDueNow: hours >= 72, resistanceToExtinction: 0.9, rationale: 'Mastery: unpredictable-interval practice builds extinction resistance.' } };
}
export async function execWebProspectiveMemory(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const list = FORGETTING_STATE.get(domain) || [];
  if (args.action === 'register') {
    const intention = args.intention || {};
    const it = {
      id: `pros_${Date.now()}_${list.length}`,
      domain,
      triggerEvent: String(intention.triggerEvent || ''),
      actionPlan: String(intention.actionPlan || ''),
      registeredAt: new Date().toISOString(),
      fired: 0
    };
    list.push(it);
    if (list.length > 50) list.shift();
    FORGETTING_STATE.set(domain, list);
    return { ok: true, data: { domain, registered: it.id, totalIntentions: list.length } };
  }
  const observed = String(args.observedEvent || '').toLowerCase();
  const fired = [];
  for (const it of list) {
    if (observed && it.triggerEvent.toLowerCase().includes(observed)) {
      it.fired += 1;
      fired.push(it);
    }
  }
  FORGETTING_STATE.set(domain, list);
  return { ok: true, data: { domain, totalIntentions: list.length, fired } };
}

export async function execWebSourceMonitoring(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const facts = Array.isArray(args.facts) ? args.facts : [];
  const trust = {};
  const verified = [];
  const misattributed = [];
  for (const f of facts) {
    const actual = f.actualEvidenceSource || f.claimedSource;
    if (trust[actual] === undefined) trust[actual] = 0.5;
    if (f.actualEvidenceSource && f.actualEvidenceSource !== f.claimedSource) {
      misattributed.push({ id: f.id, claimed: f.claimedSource, actual: f.actualEvidenceSource });
      trust[f.claimedSource] = Math.max(0, (trust[f.claimedSource] ?? 0.5) - 0.2);
      trust[actual] = Math.min(1, trust[actual] + 0.1);
    } else {
      verified.push(f.id);
      trust[actual] = Math.min(1, trust[actual] + 0.05);
    }
  }
  return { ok: true, data: { domain, verified, misattributed, sourceTrust: trust } };
}

export async function execWebInterferenceCheck(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const others = Array.isArray(args.others) ? args.others : [];
  const interferences = others.map((o) => {
    const proactive = Math.min(1, (o.sharedSelectors || 0) * 0.15);
    const retroactive = Math.min(1, (o.conflictingSteps || 0) * 0.2);
    const advice = proactive > 0.6 || retroactive > 0.6
      ? `HIGH interference with ${o.domain}: namespace selectors per domain and re-run web_synaptic_pruning before executing.`
      : proactive > 0.3 || retroactive > 0.3
      ? `Moderate interference with ${o.domain}: add an explicit context probe before step 1.`
      : `Low interference with ${o.domain}: safe to transfer playbooks.`;
    return { otherDomain: o.domain, proactiveInterference: proactive, retroactiveInterference: retroactive, advice };
  });
  return { ok: true, data: { domain, interferences } };
}

export async function execWebRewardPredictionError(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const expected = typeof args.expectedReward === 'number' ? args.expectedReward : 0.5;
  const actual = typeof args.actualReward === 'number' ? args.actualReward : 0.5;
  const rpe = actual - expected;
  const dopamineState = rpe > 0.3 ? 'PHASIC_BURST_POSITIVE_SURPRISE' : rpe < -0.3 ? 'PHASIC_DIP_NEGATIVE_SURPRISE' : 'TONIC_BASELINE_EXPECTED';
  const learningRateBoost = Math.min(2, Math.max(0.5, 1 + Math.abs(rpe)));
  const advice = rpe > 0.3 ? 'Positive surprise: consolidate hard (LTP) — capture WHY.'
    : rpe < -0.3 ? 'Negative surprise: run web_learn pitfall NOW — the richest learning moment.'
    : 'Outcome matched prediction: no new learning signal, maintain the current playbook.';
  return { ok: true, data: { domain, rpe, dopamineState, learningRateBoost, advice } };
}

export async function execWebCognitiveLoadBudget(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const capacity = typeof args.capacityChunks === 'number' ? args.capacityChunks : 7;
  const total = (args.intrinsic || 0) + (args.extraneous || 0) + (args.germane || 0);
  const overloaded = total > capacity;
  const verdict = overloaded ? 'COGNITIVE_OVERLOAD'
    : (args.germane || 0) > capacity * 0.5 ? 'OPTIMAL_LEARNING_ZONE'
    : (args.extraneous || 0) > capacity * 0.3 ? 'EXTRANEOUS_NOISE_HIGH'
    : 'COMFORTABLE';
  const simplificationAdvice = overloaded
    ? 'Split the plan into smaller chunks, strip decorative DOM noise (extraneous), and automate routine sub-steps first.'
    : (args.extraneous || 0) > capacity * 0.3
    ? 'Reduce extraneous load: use page digest or reader mode before reasoning over raw DOM.'
    : 'Load within budget: spend remaining capacity on germane learning (schema building).';
  return { ok: true, data: { domain, totalLoad: total, capacity, overloaded, verdict, simplificationAdvice } };
}

export async function execCognitiveDynamicsTool(tool, args = {}) {
  switch (tool) {
    case 'web_assimilation_accommodation': return execWebAssimilationAccommodation(args);
    case 'web_forgetting_curve': return execWebForgettingCurve(args);
    case 'web_reinforcement_schedule': return execWebReinforcementSchedule(args);
    case 'web_prospective_memory': return execWebProspectiveMemory(args);
    case 'web_source_monitoring': return execWebSourceMonitoring(args);
    case 'web_interference_check': return execWebInterferenceCheck(args);
    case 'web_reward_prediction_error': return execWebRewardPredictionError(args);
    case 'web_cognitive_load_budget': return execWebCognitiveLoadBudget(args);
    default: return execCognitiveTranscendentalTool(tool, args);
  }
}
