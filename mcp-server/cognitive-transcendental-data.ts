// ScreenSync Transcendental Cognition (Architecture 12.0) - shared types and fixed tables.
//
// Split out of cognitive-transcendental.ts, which had passed the 500-line ceiling. Pure data and
// helpers only: the engine and its tests import from here. Nothing in this file holds state.

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
export const PERTURBATIONS = Object.freeze([
  { id: "occluding_overlay", guard: "assert the target is unoccluded (web_actionable) before clicking" },
  { id: "latency_spike_3000ms", guard: "wrap the step in an explicit web_wait_for instead of a fixed sleep" },
  { id: "selector_drift", guard: "resolve by role/text before falling back to a brittle css selector" },
  { id: "auth_expiry", guard: "re-check the session (web_expect on a logged-in marker) before acting" },
  { id: "shadow_root_reparent", guard: "use a shadow-piercing locator (>>>) rather than a flat query" },
]);

/** Failure vectors the internal adversary raises against a candidate plan. */
export const FAILURE_VECTORS = Object.freeze([
  { id: "unpierced_shadow_root", when: (s: string) => /css=|queryselector|^#|^\./.test(s), guard: "locator may sit inside a shadow root - use >>> or pierce/" },
  { id: "disabled_until_in_view", when: (s: string) => /click|submit|press/.test(s), guard: "element may be disabled until scrolled into view - web_scroll_to then web_actionable" },
  { id: "unsaved_state_dialog", when: (s: string) => /navigate|reload|goto|close/.test(s), guard: "navigation may raise beforeunload - run web_contract_check first" },
  { id: "iframe_boundary", when: (s: string) => /click|fill|type/.test(s), guard: "target may live in an iframe - confirm with web_frame_tree, act via web_in_frame" },
  { id: "lazy_mount_race", when: (s: string) => /fill|type|select/.test(s), guard: "control may mount after paint - web_wait_for the selector before input" },
]);

/** Catastrophic intents that dominate the somatic appraisal regardless of wording. */
export const CATASTROPHIC = Object.freeze([
  "purge database", "drop database", "delete account", "close account",
  "transfer funds", "wire transfer", "withdraw", "production dns", "rotate key", "revoke access",
]);

// The destructive-action vocabulary lives in destructive-vocab.ts (whole words plus page-changing code),
// shared with the extension and its page-side units.

export const round = (n: number, dp = 3): number => Math.round(n * 10 ** dp) / 10 ** dp;
export const clean = (d: string): string => String(d || "").toLowerCase().trim();
