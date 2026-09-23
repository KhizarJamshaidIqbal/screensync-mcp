// The soft gate (Phase 3 of the cognitive spine): a domain's EARNED level finally changes behaviour.
//
// Before this, "growing up" changed nothing: the scaffolding flags the level engines produced were read
// by no execution path, one gate actually LOWERED safety as a domain aged, and the reflex gate read its
// thresholds from the caller's own arguments. These tests pin the replacement, including the ways a
// caller might try to talk its way past it.

import { ISOLATED_DATA_DIR } from "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { toolDefinitions } from "../catalog.js";
import { GATED_TOOLS, REQUIRED_LEVEL, forRelay, gateBeforeRelay, gateMode, humanCanBeAsked, resetPolicyCache } from "../cognitive-policy.js";
import { globalSpine } from "../cognitive-spine.js";
import { observeToolResult } from "../cognitive-spine-observer.js";
import { AdolescentCognitionEngine } from "../cognitive-adolescent.js";
import { handleCognitiveTool } from "../web-cognitive-handlers.js";
import { createProfileRegistry } from "../profile-registry.js";

const POLICY_DIR = path.join(ISOLATED_DATA_DIR, "cognitive");
const POLICY_FILE = path.join(POLICY_DIR, "policy.json");

/** Runs `fn` with the gate in `mode`, then puts the environment back. */
function withMode<T>(mode: string | undefined, fn: () => T): T {
  const before = process.env.SCREEN_SYNC_COGNITIVE_GATE;
  if (mode === undefined) delete process.env.SCREEN_SYNC_COGNITIVE_GATE; else process.env.SCREEN_SYNC_COGNITIVE_GATE = mode;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.SCREEN_SYNC_COGNITIVE_GATE; else process.env.SCREEN_SYNC_COGNITIVE_GATE = before;
  }
}

/** Earns `sessions` distinct sessions of verified successes, spread over the last few seconds. */
function earn(domain: string, sessions: number, per = 3): void {
  const base = Date.now() - 10_000;
  for (let s = 0; s < sessions; s += 1) for (let i = 0; i < per; i += 1) globalSpine.record(domain, "verified", `earn-${domain}-${s}`, base + s * 100 + i);
}

const DANGEROUS = { url: "https://gate-fresh.example/account", selector: "button.delete-account" };

test("the mode defaults to enforce (a person is asked), and only 'warn' and 'off' relax it", () => {
  assert.equal(withMode(undefined, gateMode), "enforce");
  assert.equal(withMode("enforce", gateMode), "enforce");
  assert.equal(withMode(" ENFORCE ", gateMode), "enforce");
  assert.equal(withMode("warn", gateMode), "warn");
  assert.equal(withMode("off", gateMode), "off");
  assert.equal(withMode("banana", gateMode), "enforce", "an unknown value must fail closed, never silently loosen the gate");
  assert.equal(withMode("", gateMode), "enforce");
});

test("every gated tool is a real tool in the catalogue", () => {
  const declared = new Set(toolDefinitions().map((t) => t.name));
  for (const tool of GATED_TOOLS) assert.ok(declared.has(tool), `${tool} is not a declared tool (renamed, or a typo?)`);
});

test("reads and perception are never gated, whatever the words in their arguments", () => {
  for (const tool of ["web_screenshot", "web_element_screenshot", "web_aria_snapshot", "web_content", "web_cookies", "web_page_observe", "web_expect", "web_tabs"]) {
    assert.equal(gateBeforeRelay(tool, { ...DANGEROUS, text: "delete account" }, "s-reads"), null, tool);
  }
});

// Confirmed live 2026-09-23: web_screenshot timed out and web_element_screenshot returned a blank
// image mid-session, which raised the question of whether either was accidentally waiting on an
// approval nothing ever answered. They are not: neither is in GATED_TOOLS (the set above already
// pins that they pass DANGEROUS-looking arguments untouched), so gateBeforeRelay short-circuits on
// `!GATED_TOOLS.has(tool)` before it ever resolves a domain or asks a person. Pinned explicitly so a
// future change to GATED_TOOLS (e.g. a careless spread of another tool set into it) cannot silently
// start gating a read-only capture behind a prompt nobody will see.
test("web_screenshot and web_element_screenshot are read-only captures, never in GATED_TOOLS", () => {
  assert.equal(GATED_TOOLS.has("web_screenshot"), false);
  assert.equal(GATED_TOOLS.has("web_element_screenshot"), false);
});

test("a fresh domain stays usable: mutations that do not look destructive pass at every level", () => {
  for (const [tool, args] of [
    ["web_click", { url: "https://gate-fresh.example/", selector: "#save-draft" }],
    ["web_type", { url: "https://gate-fresh.example/", selector: "#title", text: "hello world" }],
    ["web_navigate", { url: "https://gate-fresh.example/settings" }],
    ["web_fill", { url: "https://gate-fresh.example/", selector: "#email", value: "me@example.com" }],
    ["web_key", { url: "https://gate-fresh.example/", key: "Enter" }],
  ] as Array<[string, Record<string, unknown>]>) {
    assert.equal(gateBeforeRelay(tool, args, "s-usable"), null, `${tool} on a NOVICE domain must flow`);
  }
});

test("a destructive-looking mutation on a NOVICE domain is warned about in warn mode, refused in enforce mode", () => {
  const warn = withMode("warn", () => gateBeforeRelay("web_click", DANGEROUS, "s-danger"))!;
  assert.equal(warn.block, false, "warn mode never blocks");
  assert.equal(warn.message, null);
  assert.equal(warn.decision.verdict, "warn");
  assert.equal(warn.decision.domain, "gate-fresh.example");
  assert.equal(warn.decision.earnedName, "NOVICE");
  assert.equal(warn.decision.requiredName, "COMPETENT");
  assert.ok(warn.decision.markers.includes("destructive_keyword"));
  assert.match(warn.decision.reason, /needed to act on it unsupervised/);

  const enforce = withMode("enforce", () => gateBeforeRelay("web_click", DANGEROUS, "s-danger"))!;
  assert.equal(enforce.block, true);
  assert.equal(enforce.decision.verdict, "block");
  assert.match(enforce.message!, /^USER_CONFIRMATION_REQUIRED \(cognitive gate\)/, "the code the extension and observer already treat as 'ask the human'");
});

test("the gate lifts only with EARNED COMPETENT: a vouch, or a level below it, does not", () => {
  const args = { url: "https://gate-earn.example/", selector: "button.delete-account" };
  assert.ok(gateBeforeRelay("web_click", args, "s-earn"), "NOVICE is gated");

  earn("gate-earn.example", 2, 2); // two sessions: ADVANCED_BEGINNER
  assert.equal(globalSpine.earnedLevel("gate-earn.example"), 2);
  assert.ok(gateBeforeRelay("web_click", args, "s-earn"), "ADVANCED_BEGINNER is still gated");

  globalSpine.vouch("gate-earn.example", 5, "operator says it is fine", "op");
  assert.equal(globalSpine.evaluate("gate-earn.example").effectiveLevel, 3);
  assert.ok(gateBeforeRelay("web_click", args, "s-earn"), "a vouch shows as COMPETENT but never counts as earned evidence");

  earn("gate-earn.example", 4, 3);
  assert.ok(globalSpine.earnedLevel("gate-earn.example") >= REQUIRED_LEVEL);
  assert.equal(gateBeforeRelay("web_click", args, "s-earn"), null, "earned COMPETENT acts on it unsupervised");
});

test("the destructive vocabulary is read from selector, text, value, method and url", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["web_type", { url: "https://gate-vocab.example/", selector: "#note", text: "please delete account now" }],
    ["web_fill", { url: "https://gate-vocab.example/", selector: "#confirm", value: "purchase" }],
    ["web_api_fetch", { url: "https://gate-vocab.example/api/items/1", method: "DELETE" }],
    ["web_eval", { url: "https://gate-vocab.example/", code: "document.querySelector('#row').remove()" }],
    ["web_navigate", { url: "https://gate-vocab.example/cancel-subscription/confirm-delete" }],
  ];
  for (const [tool, args] of cases) assert.ok(gateBeforeRelay(tool, args, "s-vocab"), `${tool} ${JSON.stringify(args)} must be flagged`);
});

test("'confirmed' and 'force' arguments do not open the gate", () => {
  const out = gateBeforeRelay("web_click", { ...DANGEROUS, confirmed: true, force: true, __humanApproved: true, __actGranted: true }, "s-bypass");
  assert.ok(out, "an argument the caller supplies itself proves nothing");
});

test("off does nothing at all", () => {
  assert.equal(withMode("off", () => gateBeforeRelay("web_click", DANGEROUS, "s-off")), null);
});

test("an unresolvable domain is treated as a NOVICE, and a domain seen earlier in the session is inherited", () => {
  const lone = gateBeforeRelay("web_click", { selector: "button.delete-account" }, "s-lone-context")!;
  assert.ok(lone, "no domain means no evidence, so no trust");
  assert.equal(lone.decision.domain, null);
  assert.equal(lone.decision.earnedName, "NOVICE");

  observeToolResult("web_navigate", { url: "https://gate-inherit.example/" }, { ok: true, data: { url: "https://gate-inherit.example/" } }, "s-inherit");
  const inherited = gateBeforeRelay("web_click", { selector: "button.delete-account" }, "s-inherit")!;
  assert.equal(inherited.decision.domain, "gate-inherit.example", "a click names no domain; it inherits the session's");
});

test("a human can allowlist a domain in policy.json; a missing or corrupt file allowlists nothing", () => {
  mkdirSync(POLICY_DIR, { recursive: true });
  try {
    writeFileSync(POLICY_FILE, JSON.stringify({ allowDomains: ["Allowed.Example", "  ", 42] }));
    resetPolicyCache();
    assert.equal(gateBeforeRelay("web_click", { url: "https://allowed.example/", selector: "button.delete-account" }, "s-allow"), null);
    assert.ok(gateBeforeRelay("web_click", { url: "https://not-allowed.example/", selector: "button.delete-account" }, "s-allow"), "only the named domain");

    writeFileSync(POLICY_FILE, "{ this is not json");
    resetPolicyCache();
    assert.ok(gateBeforeRelay("web_click", { url: "https://allowed.example/", selector: "button.delete-account" }, "s-allow"), "an unreadable policy must fail closed");
  } finally {
    rmSync(POLICY_FILE, { force: true });
    resetPolicyCache();
  }
});

// ── the reflex gate reads the spine, not the caller ────────────────────────

function call(tool: string, args: Record<string, unknown>): any {
  let body: unknown;
  const res = { json: (b: unknown) => { body = b; } } as unknown as Response;
  assert.equal(handleCognitiveTool(tool, args, res, { session: "policy-test" }), true, `${tool} must be handled by the hub`);
  return body;
}
const playbook = (extra: Record<string, unknown> = {}) => ({ id: "pb_reflex", steps: [{ action: "click", selector: "#go" }], ...extra });

test("a caller cannot compile a reflex by typing successCount 10 and wisdomScore 1", () => {
  const cold = call("web_system1_reflex_compile", { domain: "reflex-cold.example", playbook: playbook({ successCount: 999, wisdomScore: 1 }) });
  assert.equal(cold.data.compiled, false, "the domain has no evidence, whatever the caller claims");
  assert.equal(cold.data.source, "spine");
  assert.deepEqual(cold.data.argsIgnored, ["playbook.successCount", "playbook.wisdomScore"]);
  assert.match(cold.data.reason, /Automatism not reached: 0\/10/);
});

test("a reflex compiles once the HUB has seen 10 verified successes and holds a good wisdom score", () => {
  const dom = "reflex-warm.example";
  earn(dom, 4, 3); // 12 verified across 4 sessions
  const noWisdom = call("web_system1_reflex_compile", { domain: dom, playbook: playbook() });
  assert.equal(noWisdom.data.compiled, false);
  assert.match(noWisdom.data.reason, /poorly calibrated/, "practised, but no hub-held wisdom score yet");

  globalSpine.setWisdom(dom, 0.9);
  const warm = call("web_system1_reflex_compile", { domain: dom, playbook: playbook({ successCount: 0, wisdomScore: 0 }) });
  assert.equal(warm.data.compiled, true, "the hub's numbers win over the caller's zeros");
  assert.equal(warm.data.source, "spine");
});

test("with no domain the tool stays the calculator it always was", () => {
  const calc = call("web_system1_reflex_compile", { playbook: playbook({ successCount: 12, wisdomScore: 0.9 }) });
  assert.equal(calc.data.source, "caller");
  assert.equal(calc.data.compiled, true);
  assert.equal(calc.data.argsIgnored, undefined);
});

// ── the safety inversion ────────────────────────────────────────────────────

test("asking a human to look first no longer switches off as a domain 'grows up'", () => {
  const engine = new AdolescentCognitionEngine();
  // The old rule keyed on the Erikson stage, i.e. on an age the caller can set. A 60-year-old domain
  // (EGO_INTEGRITY) was never advised to check a risky action with the human.
  engine.eriksonIdentity("old.example", 60, 50, 0);
  assert.equal(engine.infantErrorSignature("old.example", { errorOccurred: false, riskyActionPlanned: true }).socialReferencingAdvised, true, "an unknown level counts as NOVICE");
  assert.equal(engine.infantErrorSignature("old.example", { errorOccurred: false, riskyActionPlanned: true, earnedLevel: 2 }).socialReferencingAdvised, true);
  assert.equal(engine.infantErrorSignature("old.example", { errorOccurred: false, riskyActionPlanned: true, earnedLevel: 3 }).socialReferencingAdvised, false, "COMPETENT may act unsupervised");
  assert.equal(engine.infantErrorSignature("old.example", { errorOccurred: false, riskyActionPlanned: false, earnedLevel: 1 }).socialReferencingAdvised, false, "no risky plan, no advice");
});

test("the tool uses the level the hub earned, and ignores an earnedLevel the caller claims", () => {
  const dom = "infant-advice.example";
  const claimed = call("web_infant_error_signature", { domain: dom, event: { errorOccurred: false, riskyActionPlanned: true, earnedLevel: 5 } });
  assert.equal(claimed.data.socialReferencingAdvised, true, "claiming level 5 changes nothing");

  earn(dom, 4, 3);
  const earned = call("web_infant_error_signature", { domain: dom, event: { errorOccurred: false, riskyActionPlanned: true } });
  assert.equal(earned.data.socialReferencingAdvised, false, "earned COMPETENT stops the advice");
});

// ── asking a person (Phase 5) ───────────────────────────────────────────────

type FakeBrowser = { instanceId: string; browserName: string; webAccessEnabled: boolean; approvals: boolean; windows?: unknown[] };
const browser = (over: Partial<FakeBrowser> = {}): FakeBrowser => ({ instanceId: "i1", browserName: "chrome", webAccessEnabled: true, approvals: true, ...over });
/** A real registry with these browsers connected: the same resolveDispatch() web.ts dispatches with. */
const registryOf = (...browsers: FakeBrowser[]) => {
  const registry = createProfileRegistry();
  for (const b of browsers) registry.register({ ...b, browserId: b.instanceId });
  return registry;
};
const canAsk = (registry: ReturnType<typeof createProfileRegistry>, args: Record<string, unknown>) => humanCanBeAsked(registry.resolveDispatch(args));

test("a person can be asked only when the browser this call will reach says it can ask", () => {
  assert.equal(canAsk(registryOf(browser()), {}), true);
  assert.equal(canAsk(registryOf(browser({ approvals: false })), {}), false, "an older extension would simply run the call");
  assert.equal(canAsk(registryOf(browser({ webAccessEnabled: false })), {}), false);
  assert.equal(canAsk(registryOf(), {}), false, "no browser at all");

  // The hint decides WHICH browser is asked: a capable one elsewhere does not cover an incapable target.
  const mixed = registryOf(browser({ instanceId: "new" }), browser({ instanceId: "old", browserName: "edge", approvals: false }));
  assert.equal(canAsk(mixed, { __instance: "new" }), true);
  assert.equal(canAsk(mixed, { __instance: "old" }), false);
  assert.equal(canAsk(mixed, { __browser: "edge" }), false);
  assert.equal(canAsk(mixed, { profile: "old", __browser: "new" }), false, "profile outranks __browser, exactly as in web.ts");
  assert.equal(canAsk(mixed, { __browser: "firefox" }), false, "a hint naming no connected browser reaches nobody");
});

test("the browser judged is the tab's owner, the one the call is dispatched to, not the selected profile", () => {
  const registry = registryOf(
    browser({ instanceId: "new", windows: [{ id: 1, focused: true, activeTab: { tabId: 11 } }] }),
    browser({ instanceId: "old", browserName: "edge", approvals: false, windows: [{ id: 2, activeTab: { tabId: 22 } }] }),
  );
  registry.setSelectedProfile("new");
  assert.equal(canAsk(registry, {}), true);
  assert.equal(canAsk(registry, { tabId: 22 }), false, "tab 22 runs in 'old', which cannot ask");
  assert.equal(canAsk(registry, { windowId: 2 }), false);
  registry.setSelectedProfile("old");
  assert.equal(canAsk(registry, { tabId: 11 }), true, "tab 11 runs in 'new', which can");
});

test("forRelay drops every internal flag a caller sent, at any depth, and adds the hub's own only when a person must be asked", () => {
  const args = { selector: "#x", confirmed: true, __humanApproved: true, __actGranted: true, __gate: { needsHuman: false }, args: { __humanApproved: true, keep: 1, deeper: [{ __actGranted: true }] } };
  const plain = forRelay(args);
  assert.deepEqual(Object.keys(plain).sort(), ["args", "confirmed", "selector"]);
  assert.deepEqual(plain.args, { keep: 1, deeper: [{}] });
  assert.equal(args.__humanApproved, true, "the caller's own object is left as it was");

  const decision = (verdict: string) => ({
    mode: "enforce", verdict, tool: "web_click", domain: "shop.example", earnedLevel: 1, earnedName: "NOVICE", requiredLevel: 3, requiredName: "COMPETENT",
    riskScore: 0.5, markers: ["destructive_keyword"], reason: "r".repeat(500),
  }) as unknown as Parameters<typeof forRelay>[1];
  const asked = forRelay(args, decision("block"));
  assert.equal(asked.__humanApproved, undefined, "the caller's flag is gone even though the hub added its own");
  assert.deepEqual(asked.__gate, { needsHuman: true, reason: "r".repeat(300), riskScore: 0.5, markers: ["destructive_keyword"], domain: "shop.example", level: "NOVICE" });
  assert.equal(forRelay(args, decision("warn")).__gate, undefined, "warn only annotates: nobody is asked");
  assert.equal(forRelay(args).__gate, undefined);
});

test("when nobody can be asked the refusal says how to fix that", () => {
  const out = withMode("enforce", () => gateBeforeRelay("web_click", DANGEROUS, "s-refusal"))!;
  assert.match(out.message!, /^USER_CONFIRMATION_REQUIRED \(cognitive gate\)/);
  assert.match(out.message!, /1\.11\.0/, "names the extension version that can ask");
  assert.match(out.message!, /policy\.json/, "and the other way out");
});
