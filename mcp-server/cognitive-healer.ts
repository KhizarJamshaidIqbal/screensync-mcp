// ScreenSync Chaos-Immune Self-Healing Engine (AP-CE Tier 3)
// Autonomous DOM Drift Detection, VOM Heuristic Recovery, and Playbook Auto-Patching

import type { CognitiveMemoryStore, PlaybookStep, ProceduralPlaybook } from "./cognitive-memory.js";

export interface HealCandidate {
  selector: string;
  role?: string;
  tag: string;
  confidence: number; // 0.0 - 1.0
  reason: string;
}

export interface HealResult {
  healed: boolean;
  originalSelector: string;
  newSelector?: string;
  candidate?: HealCandidate;
  patchedPlaybookId?: string;
  patchedStep?: number;
  reason?: string;
}

export interface HealedEvent {
  timestamp: string;
  domain: string;
  playbookId: string;
  stepIndex: number;
  oldSelector: string;
  newSelector: string;
  reason: string;
}

/**
 * Searches candidates when an original CSS/attribute selector drifts or disappears.
 * Inspects semantic attributes, ARIA roles, and contenteditable flags.
 */
export function findSemanticCandidates(params: {
  originalSelector: string;
  intent: string;
  stepName?: string;
  domSnapshotElements?: Array<{
    selector: string;
    role?: string;
    tag: string;
    text?: string;
    attributes?: Record<string, string>;
    visible?: boolean;
    interactive?: boolean;
  }>;
}): HealCandidate[] {
  const { originalSelector, intent, domSnapshotElements = [] } = params;
  const candidates: HealCandidate[] = [];

  // Common heuristics based on intent and failing selector
  const isTextInput =
    /textarea|input|editor|compose|tweet|text/i.test(originalSelector) ||
    /post|comment|compose|message/i.test(intent);

  const isButton =
    /button|submit|send|tweetButton|publish/i.test(originalSelector) ||
    /submit|click|publish/i.test(intent);

  for (const el of domSnapshotElements) {
    if (el.visible === false) continue;

    let score = 0;
    let reason = "";

    if (isTextInput) {
      if (el.role === "textbox" || el.attributes?.["contenteditable"] === "true") {
        score += 0.5;
        reason += "Matches interactive editable textbox role. ";
      }
      if (el.attributes?.["data-testid"]?.toLowerCase().includes("text") || el.attributes?.["data-testid"]?.toLowerCase().includes("editor")) {
        score += 0.3;
        reason += "data-testid matches editor pattern. ";
      }
      if (el.tag.toLowerCase() === "textarea" || el.tag.toLowerCase() === "input") {
        score += 0.2;
        reason += `Native <${el.tag}> element. `;
      }
    }

    if (isButton) {
      if (el.role === "button" || el.tag.toLowerCase() === "button") {
        score += 0.5;
        reason += "Matches interactive button role. ";
      }
      if (el.attributes?.["data-testid"]?.toLowerCase().includes("button") || el.attributes?.["data-testid"]?.toLowerCase().includes("submit")) {
        score += 0.3;
        reason += "data-testid matches submit button pattern. ";
      }
    }

    if (score >= 0.5) {
      candidates.push({
        selector: el.selector,
        role: el.role,
        tag: el.tag,
        confidence: Math.min(1.0, Number(score.toFixed(2))),
        reason: reason.trim()
      });
    }
  }

  // Sort descending by confidence
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Attempts to self-heal a broken playbook step using semantic candidate recovery.
 * If verified, mutates the playbook in-flight and saves to persistent memory.
 */
export function healPlaybookStep(params: {
  store: CognitiveMemoryStore;
  playbookId: string;
  stepIndex: number;
  failingSelector: string;
  candidate: HealCandidate;
}): HealResult {
  const { store, playbookId, stepIndex, failingSelector, candidate } = params;
  const mem = store.load();
  const playbook = mem.playbooks[playbookId];

  if (!playbook) {
    return {
      healed: false,
      originalSelector: failingSelector,
      reason: `Playbook ${playbookId} not found in cognitive memory.`
    };
  }

  const step = playbook.steps[stepIndex];
  if (!step) {
    return {
      healed: false,
      originalSelector: failingSelector,
      reason: `Step index ${stepIndex} out of bounds in playbook ${playbookId}.`
    };
  }

  // Verify candidate has high confidence
  if (candidate.confidence < 0.5) {
    return {
      healed: false,
      originalSelector: failingSelector,
      reason: `Candidate confidence ${candidate.confidence} too low for auto-heal.`
    };
  }

  // Apply in-flight mutation
  const oldSelector = failingSelector;
  const newSelector = candidate.selector;

  if (step.args && typeof step.args === "object" && "selector" in step.args) {
    step.args.selector = newSelector;
  }
  if (step.codeSnippet && step.codeSnippet.includes(oldSelector)) {
    step.codeSnippet = step.codeSnippet.replaceAll(oldSelector, newSelector);
  }

  playbook.lastExecutedAt = new Date().toISOString();
  store.save();

  return {
    healed: true,
    originalSelector: oldSelector,
    newSelector,
    candidate,
    patchedPlaybookId: playbookId,
    patchedStep: stepIndex,
    reason: `Successfully auto-patched selector: [${oldSelector}] -> [${newSelector}] (${candidate.reason})`
  };
}
