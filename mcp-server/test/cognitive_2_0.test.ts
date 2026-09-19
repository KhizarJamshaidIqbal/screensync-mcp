// ScreenSync Cognitive Memory 2.0 (AP-CE) Integration Test Suite
// Verifies:
// 1. Hippocampal Consolidation (Bronze -> Silver -> Gold Medallion Lakehouse)
// 2. Long-Term Potentiation (LTP) and Synaptic Depression (LTD)
// 3. Speculative Pre-Flight Warming (web_warm)
// 4. Chaos Circuit Breaker & Anti-Bot Detection
// 5. Semantic VOM Heuristic Recovery & Self-Healing Playbook Auto-Patching
// 6. Privacy-Safe Swarm Wisdom Sanitization

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveMemoryStore } from "../cognitive-memory.js";
import { runHippocampalConsolidation, sanitizeSwarmWisdom } from "../cognitive-consolidation.js";
import { findSemanticCandidates, healPlaybookStep } from "../cognitive-healer.js";
import { CognitiveCircuitBreaker, speculativeWarm } from "../cognitive-warming.js";

test("AP-CE Tier 4: Hippocampal Consolidation & LTP/LTD Medallion Tiering", () => {
  const store = new CognitiveMemoryStore();
  const mem = store.load();

  // Add sample execution episodes (Bronze layer)
  for (let i = 0; i < 60; i++) {
    mem.episodes.push({
      id: `ep_test_${i}`,
      timestamp: new Date().toISOString(),
      domain: "x.com",
      intent: "post",
      profile: "test@example.com",
      conditionSignals: { flame_is_lit_auth_active: true },
      success: true,
      durationMs: 12000
    });
  }

  // Run consolidation
  const { data, silver, goldMeta, report } = runHippocampalConsolidation(mem);

  // Bronze pruning verification (max 50 retained)
  assert.equal(data.episodes.length, 50, "Bronze buffer must retain at most 50 episodes");
  assert.ok(report.bronzePrunedCount >= 10, "Should have pruned at least 10 episodes");

  // Silver telemetry verification
  const silverMetric = silver["x.com::post"];
  assert.ok(silverMetric, "Silver metric must exist for x.com::post");
  assert.equal(silverMetric.successRate, 1.0);
  assert.ok(Math.abs(silverMetric.avgDurationMs - 12000) < 100, "avgDurationMs should be approximately 12000");

  // Gold LTP verification
  const goldMetaEntry = goldMeta["x_publish_post"];
  assert.ok(goldMetaEntry, "Gold meta must exist for x_publish_post");
  assert.ok(goldMetaEntry.confidenceScore >= 0.8, "Successful runs must boost confidence via LTP");
  assert.equal(goldMetaEntry.status, "active");
});

test("AP-CE Tier 4: Swarm Wisdom Sanitization Filter", () => {
  const rawWisdom = {
    profile: "epsoldev@gmail.com",
    command: "curl -H 'Authorization: Bearer secret_token_1234567890' https://x.com",
    cookies: "auth_token=super_secret_cookie_val; path=/;",
    safePlaybookNote: "Use execCommand('insertText') for Draft.js React inputs."
  };

  const sanitized = sanitizeSwarmWisdom(rawWisdom);

  assert.equal(sanitized.profile, "[USER_EMAIL]");
  assert.ok(!sanitized.command.includes("secret_token_1234567890"), "Bearer token must be redacted");
  assert.ok(!sanitized.cookies.includes("super_secret_cookie_val"), "Cookie must be redacted");
  assert.equal(sanitized.safePlaybookNote, "Use execCommand('insertText') for Draft.js React inputs.");
});

test("AP-CE Tier 1: Speculative Pre-Flight Warming (web_warm)", () => {
  const store = new CognitiveMemoryStore();

  // Test warming with compose modal already open
  const warmRes = speculativeWarm({
    store,
    domain: "x.com",
    intent: "post",
    detectedSignals: {
      flame_is_lit_auth_active: true,
      pan_already_on_fire_compose_open: true
    }
  });

  assert.equal(warmRes.ready, true);
  assert.equal(warmRes.domain, "x.com");
  assert.equal(warmRes.fastPathAvailable, true);
  assert.equal(warmRes.circuitBreakerStatus, "CLOSED");
  assert.equal(warmRes.estimatedSeconds, 5);
  assert.ok(warmRes.selectedBranch, "Should resolve fast branch");
  assert.equal(warmRes.preFlightChecks.length, 3);
});

test("AP-CE Tier 3: Chaos Circuit Breaker Anti-Bot & Cascading Failure Guard", () => {
  const breaker = new CognitiveCircuitBreaker();
  const domain = "reddit.com";

  // Initial state should be CLOSED
  assert.equal(breaker.getState(domain).status, "CLOSED");
  assert.equal(breaker.isExecutionAllowed(domain).allowed, true);

  // Challenge modal detection trips immediately
  const tripRes = breaker.recordFailure(domain, "Cloudflare Turnstile challenge detected", true);
  assert.equal(tripRes.tripped, true);
  assert.equal(breaker.getState(domain).status, "OPEN");

  // Subsequent executions must be blocked safely
  const allowCheck = breaker.isExecutionAllowed(domain);
  assert.equal(allowCheck.allowed, false);
  assert.ok(allowCheck.reason?.includes("CircuitBreaker OPEN"));

  // Reset restores CLOSED
  breaker.reset(domain);
  assert.equal(breaker.getState(domain).status, "CLOSED");
});

test("AP-CE Tier 3: DOM Drift Detection & Playbook Auto-Patching", () => {
  const store = new CognitiveMemoryStore();
  const oldSelector = 'div[data-testid="tweetTextarea_0"]';
  const newDriftedSelector = 'div[data-testid="tweet_compose_editor_v2"]';

  // Simulated DOM snapshot where old selector drifted to a new one
  const domSnapshot = [
    {
      selector: newDriftedSelector,
      role: "textbox",
      tag: "div",
      attributes: {
        "contenteditable": "true",
        "data-testid": "tweet_compose_editor_v2"
      },
      visible: true,
      interactive: true
    }
  ];

  // 1. Search semantic candidates
  const candidates = findSemanticCandidates({
    originalSelector: oldSelector,
    intent: "post",
    domSnapshotElements: domSnapshot
  });

  assert.ok(candidates.length > 0, "Must identify semantic replacement candidate");
  assert.equal(candidates[0].selector, newDriftedSelector);
  assert.ok(candidates[0].confidence >= 0.8);

  // 2. Heal the playbook step
  const healRes = healPlaybookStep({
    store,
    playbookId: "x_publish_post",
    stepIndex: 2, // Step 3: wait for editor
    failingSelector: oldSelector,
    candidate: candidates[0]
  });

  assert.equal(healRes.healed, true);
  assert.equal(healRes.newSelector, newDriftedSelector);

  // 3. Verify in-memory persistence
  const updatedPb = store.load().playbooks["x_publish_post"];
  assert.equal(updatedPb.steps[2].args?.selector, newDriftedSelector);

  // Clean up test mutation back to standard
  updatedPb.steps[2].args = { selector: oldSelector, timeoutMs: 5000 };
  store.save();
});
