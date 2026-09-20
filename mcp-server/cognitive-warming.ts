// ScreenSync Predictive Speculative Warming & Circuit Breaker Engine (AP-CE Tiers 1 & 3)
// - Speculative Pre-Flight Warming: Evaluates environmental probes and pre-resolves playbook branches before execution.
// - Chaos Circuit Breaker: Detects anti-bot challenges and cascading failures, safely halting execution to prevent bans.

import type { CognitiveMemoryStore, PlaybookBranch, ProceduralPlaybook } from "./cognitive-memory.js";

export interface WarmPreFlightCheck {
  probe: string;
  status: "passed" | "failed" | "warning";
  details: string;
}

export interface SpeculativeWarmResult {
  ready: boolean;
  domain: string;
  intent: string;
  fastPathAvailable: boolean;
  /** The recalled playbook's lifecycle status, so a caller can see WHY there is no fast path. */
  playbookStatus?: "candidate" | "verified" | "deprecated" | null;
  guidance?: string;
  recommendedPlaybookId?: string;
  selectedBranch?: PlaybookBranch | null;
  estimatedSeconds: number;
  circuitBreakerStatus: "CLOSED" | "OPEN" | "HALF_OPEN";
  preFlightChecks: WarmPreFlightCheck[];
  warmedAt: string;
}

export interface CircuitBreakerState {
  domain: string;
  status: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailureAt?: string;
  tripReason?: string;
  openUntil?: string;
}

const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown

export class CognitiveCircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();

  public getState(domain: string): CircuitBreakerState {
    const key = domain.toLowerCase();
    let state = this.states.get(key);
    if (!state) {
      state = { domain: key, status: "CLOSED", failureCount: 0 };
      this.states.set(key, state);
    }
    // Check if cooldown expired to enter HALF_OPEN
    if (state.status === "OPEN" && state.openUntil && Date.now() > new Date(state.openUntil).getTime()) {
      state.status = "HALF_OPEN";
    }
    return state;
  }

  public recordSuccess(domain: string): void {
    const state = this.getState(domain);
    state.failureCount = 0;
    state.status = "CLOSED";
    state.tripReason = undefined;
    state.openUntil = undefined;
  }

  public recordFailure(domain: string, errorString: string, isChallenge: boolean = false): { tripped: boolean; reason: string } {
    const state = this.getState(domain);
    state.failureCount += 1;
    state.lastFailureAt = new Date().toISOString();

    // Immediate trip on anti-bot challenge
    if (isChallenge || /captcha|turnstile|arkose|challenge-platform|robot|unusual traffic/i.test(errorString)) {
      state.status = "OPEN";
      state.tripReason = `Anti-Bot challenge detected: ${errorString.slice(0, 100)}`;
      state.openUntil = new Date(Date.now() + CIRCUIT_COOLDOWN_MS * 5).toISOString(); // 5 min halt
      return { tripped: true, reason: state.tripReason };
    }

    // Trip on threshold breach
    if (state.failureCount >= CONSECUTIVE_FAILURE_THRESHOLD) {
      state.status = "OPEN";
      state.tripReason = `Circuit Breaker tripped: ${state.failureCount} consecutive failures on ${domain}.`;
      state.openUntil = new Date(Date.now() + CIRCUIT_COOLDOWN_MS).toISOString();
      return { tripped: true, reason: state.tripReason };
    }

    return { tripped: false, reason: `Failure recorded (${state.failureCount}/${CONSECUTIVE_FAILURE_THRESHOLD})` };
  }

  public isExecutionAllowed(domain: string): { allowed: boolean; reason?: string } {
    const state = this.getState(domain);
    if (state.status === "OPEN") {
      return {
        allowed: false,
        reason: `[CircuitBreaker OPEN] ${state.tripReason || "Execution halted to prevent ban."} Safely trigger web_request_help.`
      };
    }
    return { allowed: true };
  }

  public reset(domain: string): void {
    const state = this.getState(domain);
    state.status = "CLOSED";
    state.failureCount = 0;
    state.tripReason = undefined;
    state.openUntil = undefined;
  }
}

export const globalCircuitBreaker = new CognitiveCircuitBreaker();

/**
 * Speculatively warms target state and resolves optimal playbook branch.
 */
export function speculativeWarm(params: {
  store: CognitiveMemoryStore;
  domain: string;
  intent: string;
  profile?: string;
  detectedSignals?: Record<string, boolean>;
}): SpeculativeWarmResult {
  const { store, domain, intent, detectedSignals = {} } = params;
  const normalizedDomain = store.normalizeDomain(domain);
  const circuitState = globalCircuitBreaker.getState(normalizedDomain);

  const recallResult = store.recall({
    domain: normalizedDomain,
    intent,
    profile: params.profile,
    detectedSignals
  });

  const checks: WarmPreFlightCheck[] = [];

  // Check 1: Circuit breaker health
  if (circuitState.status === "OPEN") {
    checks.push({
      probe: "circuit_breaker",
      status: "failed",
      details: circuitState.tripReason || "Circuit breaker open."
    });
  } else {
    checks.push({
      probe: "circuit_breaker",
      status: "passed",
      details: "Circuit breaker is CLOSED (healthy)."
    });
  }

  // Check 2: Auth flame probe
  if (detectedSignals["flame_is_lit_auth_active"] === false) {
    checks.push({
      probe: "flame_is_lit_auth_active",
      status: "warning",
      details: "User authentication session appears inactive or expired."
    });
  } else {
    checks.push({
      probe: "flame_is_lit_auth_active",
      status: "passed",
      details: "Active authentication session confirmed."
    });
  }

  // Check 3: Compose modal state
  if (detectedSignals["pan_already_on_fire_compose_open"] === true) {
    checks.push({
      probe: "pan_already_on_fire_compose_open",
      status: "passed",
      details: "Target compose modal is already open; fast-branch activated (< 5s path)."
    });
  }

  // Defer to recall's verdict rather than re-deriving it from "a playbook exists". recall() only calls a
  // playbook a fast path once it is VERIFIED (cognitive-skills.ts); asking merely whether one was returned
  // would advertise a draft the model has just invented as a proven recipe, which is the exact thing the
  // lifecycle exists to prevent - and this tool is what agents are told to call before acting.
  const fastPathAvailable = recallResult.fastPathAvailable && circuitState.status !== "OPEN";
  if (recallResult.recommendedPlaybook && !recallResult.fastPathAvailable) {
    checks.push({
      probe: "playbook_verified",
      status: "warning",
      details: recallResult.guidance ?? "The recalled playbook is not verified; run it deliberately and confirm each step.",
    });
  }

  return {
    ready: circuitState.status !== "OPEN",
    domain: normalizedDomain,
    intent,
    fastPathAvailable,
    playbookStatus: recallResult.playbookStatus,
    ...(recallResult.guidance ? { guidance: recallResult.guidance } : {}),
    recommendedPlaybookId: recallResult.recommendedPlaybook?.id,
    selectedBranch: recallResult.selectedBranch,
    estimatedSeconds: recallResult.estimatedSeconds,
    circuitBreakerStatus: circuitState.status,
    preFlightChecks: checks,
    warmedAt: new Date().toISOString()
  };
}
