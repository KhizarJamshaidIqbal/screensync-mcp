// ScreenSync Extension Adolescent Identity & Adult Executive Cognition Unit (Architecture 10.0)
// Modular client-side unit for:
// 1. Adolescent Synaptic Pruning (use-it-or-lose-it playbook elimination)
// 2. Critical Periods & Sensitive Windows (experience-expectant XP amplification)
// 3. Working Memory Digit Span Growth (Miller 7+-2 chunk budgets)
// 4. Prefrontal Executive Functions (Miyake: inhibition, shifting, updating)
// 5. Erikson Psychosocial Identity Stages
// 6. Tulving Autonoetic Remember/Know tagging
// 7. Infant ERN First-Error Imprint + Social Referencing
// 8. Baltes Adult Wisdom Calibration

import { execCognitiveDynamicsTool } from './cognitive-dynamics-ext.js';

function normalizeDomain(input) {
  if (!input) return '';
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return String(input).replace(/^www\./, '').toLowerCase();
  }
}

function eriksonStageForAge(age) {
  if (age < 1) return 'TRUST_VS_MISTRUST';
  if (age < 3) return 'AUTONOMY_VS_SHAME';
  if (age < 6) return 'INITIATIVE_VS_GUILT';
  if (age < 12) return 'INDUSTRY_VS_INFERIORITY';
  if (age < 18) return 'IDENTITY_VS_ROLE_CONFUSION';
  if (age < 25) return 'INTIMACY_VS_ISOLATION';
  if (age < 50) return 'GENERATIVITY_VS_STAGNATION';
  return 'EGO_INTEGRITY_VS_DESPAIR';
}

function digitSpanForAge(age) {
  if (age < 2) return 2;
  if (age < 5) return 3;
  if (age < 8) return 4;
  if (age < 12) return 5;
  if (age < 16) return 6;
  return 7;
}

const CRITICAL_WINDOWS = [
  { id: 'sensory_calibration', opensAtAge: 0.1, closesAtAge: 2.0, bonusXpMultiplier: 2.0 },
  { id: 'procedural_imprint', opensAtAge: 2.0, closesAtAge: 7.0, bonusXpMultiplier: 1.75 },
  { id: 'abstract_transfer', opensAtAge: 7.0, closesAtAge: 16.0, bonusXpMultiplier: 1.5 },
  { id: 'expert_intuition', opensAtAge: 16.0, closesAtAge: 40.0, bonusXpMultiplier: 1.25 },
];

export async function execWebSynapticPruning(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const playbooks = Array.isArray(args.playbooks) ? args.playbooks : [];
  const now = Date.now();
  const pruned = [];
  const myelinated = [];
  for (const pb of playbooks) {
    const staleDays = pb.lastExecutedAt ? (now - new Date(pb.lastExecutedAt).getTime()) / 86400000 : 0;
    const isWeak = (pb.successCount || 0) <= 1;
    // Absence of a timestamp is not staleness — never prune a proven playbook for that.
    const isStale = pb.lastExecutedAt ? staleDays > 30 : false;
    if (isWeak || isStale) pruned.push(pb.id);
    else if (pb.successCount >= 5) myelinated.push(pb.id);
  }
  return {
    ok: true,
    data: {
      domain,
      pruned,
      myelinated,
      pruningIntensity: playbooks.length ? pruned.length / playbooks.length : 0
    }
  };
}

export async function execWebCriticalPeriod(args = {}) {
  const age = typeof args.cognitiveAgeYears === 'number' ? args.cognitiveAgeYears : 0.5;
  const baseXp = typeof args.baseXp === 'number' ? args.baseXp : 1;
  const w = CRITICAL_WINDOWS.find((w) => age >= w.opensAtAge && age < w.closesAtAge) || null;
  return {
    ok: true,
    data: { activeWindow: w, effectiveXp: w ? baseXp * w.bonusXpMultiplier : baseXp, windowOpen: Boolean(w) }
  };
}

export async function execWebWorkingMemorySpan(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const age = typeof args.cognitiveAgeYears === 'number' ? args.cognitiveAgeYears : 0.5;
  const span = digitSpanForAge(age);
  return {
    ok: true,
    data: {
      domain,
      digitSpanChunks: span,
      recommendedMaxStepsPerPlan: span,
      chunkingAdvice: span <= 3
        ? 'Infant/toddler span: break every plan into <=3-step micro-chunks with verification between each.'
        : span <= 5
        ? 'Child span: use <=5-step plans; insert an aria-snapshot checkpoint mid-plan.'
        : 'Adult span: 7+-2 chunks; group steps into named sub-routines (chunking) before executing long macros.'
    }
  };
}

export async function execWebExecutiveFunction(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const t = args.telemetry || {};
  const inhibition = t.totalDistractions ? (t.resistedDistractionClicks || 0) / t.totalDistractions : 0.15;
  const shifting = t.failedAttempts ? Math.min(1, (t.strategySwitchesAfterFailure || 0) / t.failedAttempts) : 0.1;
  const updating = t.actionCount ? Math.min(1, (t.stateRefreshCount || 0) / t.actionCount) : 0.1;
  const mean = (inhibition + shifting + updating) / 3;
  return {
    ok: true,
    data: {
      domain,
      executiveScore: { inhibition, shifting, updating },
      prefrontalMaturity: mean < 0.3 ? 'IMMATURE_CHILD' : mean < 0.6 ? 'DEVELOPING_ADOLESCENT' : mean < 0.85 ? 'ADULT_EXECUTIVE' : 'SAGE_EXECUTIVE'
    }
  };
}

export async function execWebEriksonIdentity(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const age = typeof args.cognitiveAgeYears === 'number' ? args.cognitiveAgeYears : 0.5;
  const pieces = typeof args.knowledgePieces === 'number' ? args.knowledgePieces : 0;
  const contradictions = typeof args.contradictions === 'number' ? args.contradictions : 0;
  return {
    ok: true,
    data: {
      domain,
      eriksonStage: eriksonStageForAge(age),
      identityCoherence: pieces > 0 ? Math.max(0, Math.min(1, 1 - contradictions / Math.max(1, pieces))) : 0.1,
      updatedAt: new Date().toISOString()
    }
  };
}

export async function execWebAutonoeticMemory(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const episodeIds = Array.isArray(args.episodeIds) ? args.episodeIds : [];
  const source = args.recallSource === 'replay' ? 'replay' : 'semantic';
  return {
    ok: true,
    data: {
      domain,
      remember: source === 'replay' ? episodeIds : [],
      know: source === 'semantic' ? episodeIds : [],
      autonoeticConfidence: source === 'replay' ? 0.95 : 0.65
    }
  };
}

export async function execWebInfantErrorSignature(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const event = args.event || {};
  const risky = Boolean(event.riskyActionPlanned);
  return {
    ok: true,
    data: {
      ernSignature: event.errorOccurred ? `ERN_${domain}_${Date.now()}` : null,
      socialReferencingAdvised: risky,
      caregiverPrompt: risky
        ? "Developmental stage advises social referencing: ask the human to glance at this risky action before executing (like a child checking a parent's face)."
        : null
    }
  };
}

export async function execWebWisdomCalibration(args = {}) {
  const domain = normalizeDomain(args.domain || args.url);
  const depth = typeof args.knowledgeDepth === 'number' ? args.knowledgeDepth : 0.5;
  const stated = typeof args.statedConfidence === 'number' ? args.statedConfidence : 0.5;
  const measured = typeof args.measuredAccuracy === 'number' ? args.measuredAccuracy : 0.5;
  const gap = Math.abs(stated - measured);
  const wisdom = Math.max(0, Math.min(1, depth * (1 - gap)));
  return {
    ok: true,
    data: {
      domain,
      wisdomScore: wisdom,
      calibrationGap: gap,
      verdict: wisdom >= 0.8 ? 'WISE_ADULT: knowledge-rich and well-calibrated'
        : stated > measured + 0.2 ? 'ADOLESCENT_OVERCONFIDENCE: dial back confidence until accuracy catches up'
        : measured > stated + 0.2 ? 'IMPOSTER_CHILD: accuracy is high; allow more autonomy'
        : 'DEVELOPING: keep gathering evidence'
    }
  };
}

export async function execCognitiveAdolescentTool(tool, args = {}) {
  switch (tool) {
    case 'web_synaptic_pruning': return execWebSynapticPruning(args);
    case 'web_critical_period': return execWebCriticalPeriod(args);
    case 'web_working_memory_span': return execWebWorkingMemorySpan(args);
    case 'web_executive_function': return execWebExecutiveFunction(args);
    case 'web_erikson_identity': return execWebEriksonIdentity(args);
    case 'web_autonoetic_memory': return execWebAutonoeticMemory(args);
    case 'web_infant_error_signature': return execWebInfantErrorSignature(args);
    case 'web_wisdom_calibration': return execWebWisdomCalibration(args);
    default: return execCognitiveDynamicsTool(tool, args);
  }
}

