// The spine's eyes and mouth (Phase 2): what the hub counts as evidence, and how the tools report it.
//
// The auto-tracker this replaces scored every ok:true as a success. But web_expect answers ok:true
// even when the assertion FAILED (passed:false), so a failed check earned XP, and the extension's own
// refusals (awaiting the human, web access off) were scored as "trauma". These tests pin the stricter
// rules: a full-weight success is an action followed by a passing, non-trivial assertion.

import "./_isolate-data-dir.js"; // Must stay the first import (points the data dir at a temp folder)
import test from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { toolDefinitions } from "../catalog.js";
import { CognitiveSpine, globalSpine } from "../cognitive-spine.js";
import { ACTION_TOOLS, SpineObserver, VERIFIER_TOOLS, hostOf, isTrivialCheck, sessionOf, type ToolResultLike } from "../cognitive-spine-observer.js";
import { handleCognitiveTool } from "../web-cognitive-handlers.js";

const T0 = Date.UTC(2026, 0, 1, 12);

function rig() {
  let now = T0;
  const spine = new CognitiveSpine(() => now);
  const obs = new SpineObserver(spine, () => now);
  return {
    spine, obs,
    tick: (ms: number) => { now += ms; },
    ev: (domain: string) => spine.evaluate(domain, now).evidence,
    see: (tool: string, args: Record<string, unknown>, result: ToolResultLike, session = "s1") => obs.observe({ tool, args, result, session }),
  };
}
const ok = (data?: unknown): ToolResultLike => ({ ok: true, data });
const fail = (error: string): ToolResultLike => ({ ok: false, error });
const SHOP = "https://shop.example/cart";

// ── what counts as evidence ─────────────────────────────────────────────────

test("an action followed by a passing assertion on the same domain is a VERIFIED success", () => {
  const r = rig();
  assert.equal(r.see("web_navigate", { url: SHOP }, ok({ url: SHOP })).outcome, "weak", "a bare 'ok' is only weak evidence");
  r.tick(2000);
  assert.equal(r.see("web_click", { selector: "#buy" }, ok()).domain, "shop.example", "a click names no domain, so it inherits the session's");
  r.tick(2000);
  const verdict = r.see("web_expect", { selector: "#confirmation", condition: "visible" }, ok({ passed: true }));
  assert.equal(verdict.outcome, "verified");
  assert.deepEqual([r.ev("shop.example").verified, r.ev("shop.example").weak], [1, 2]);
});

test("a FAILED web_expect (ok:true, passed:false) is a failure, not the success the old tracker scored it as", () => {
  const r = rig();
  r.see("web_click", { url: SHOP, selector: "#buy" }, ok());
  r.tick(1000);
  assert.equal(r.see("web_expect", { selector: "#confirmation", condition: "visible" }, ok({ passed: false })).outcome, "failure");
  assert.deepEqual([r.ev("shop.example").failures, r.ev("shop.example").verified], [1, 0]);
});

test("web_assert reports failure the other way round (ok:false, 'Assertion failed'), and both are handled", () => {
  const r = rig();
  r.see("web_click", { url: SHOP, selector: "#a" }, ok());
  r.tick(500);
  assert.equal(r.see("web_assert", { selector: "#a", condition: "visible" }, ok({ passed: true })).outcome, "verified");

  r.tick(500);
  r.see("web_click", { selector: "#b" }, ok());
  r.tick(500);
  assert.equal(r.see("web_assert", { selector: "#b", condition: "visible" }, fail('Assertion failed: expected condition "visible" for "#b", but found "not_in_dom".')).outcome, "failure");

  r.tick(500);
  r.see("web_click", { selector: "#c" }, ok());
  r.tick(500);
  assert.equal(r.see("web_assert", { selector: "#c", condition: "nonsense" }, fail("Unknown assertion condition: nonsense")).outcome, "neutral", "an assertion that could not run says nothing either way");
  assert.deepEqual([r.ev("shop.example").verified, r.ev("shop.example").failures], [1, 1]);
});

test("a trivially-true assertion verifies nothing", () => {
  for (const args of [{ selector: "body" }, { selector: "html" }, { selector: "css=body" }, { selector: ":root" }, { condition: "visible" }, { condition: "text", text: "ok" }]) {
    assert.equal(isTrivialCheck({ condition: "visible", ...args }), true, JSON.stringify(args));
  }
  for (const args of [{ selector: "#confirmation" }, { condition: "url", text: "/thanks" }, { condition: "text", text: "Order placed" }, { condition: "title", text: "Receipt" }]) {
    assert.equal(isTrivialCheck({ condition: "visible", ...args }), false, JSON.stringify(args));
  }
  const r = rig();
  r.see("web_click", { url: SHOP, selector: "#buy" }, ok());
  r.tick(500);
  assert.equal(r.see("web_expect", { selector: "body", condition: "visible" }, ok({ passed: true })).outcome, "neutral");
  assert.equal(r.ev("shop.example").verified, 0);
});

test("a lone assertion, a stale one, and a repeated one verify nothing; each action is verified at most once", () => {
  const r = rig();
  r.see("web_navigate", { url: SHOP }, ok({ url: SHOP })); // pending action
  r.tick(500);
  assert.equal(r.see("web_expect", { selector: "#x", condition: "visible" }, ok({ passed: true })).outcome, "verified");
  assert.equal(r.see("web_expect", { selector: "#x", condition: "visible" }, ok({ passed: true })).outcome, "neutral", "the action was already verified once");

  const lone = rig();
  lone.see("web_screenshot", { url: SHOP }, ok());
  assert.equal(lone.see("web_expect", { selector: "#x", condition: "visible" }, ok({ passed: true })).outcome, "neutral", "no action came before it");

  const stale = rig();
  stale.see("web_click", { url: SHOP, selector: "#buy" }, ok());
  stale.tick(61_000);
  assert.equal(stale.see("web_expect", { selector: "#x", condition: "visible" }, ok({ passed: true })).outcome, "neutral", "a minute later it no longer verifies that click");
});

test("policy refusals and outages are neutral; a genuine page failure is a failure", () => {
  const r = rig();
  r.see("web_click", { url: SHOP, selector: "#buy" }, ok()); // leaves an action pending
  for (const error of [
    "USER_CONFIRMATION_REQUIRED: this action needs the user's approval",
    "Web access is disabled in the ScreenSync extension.",
    "Timed out after 45000ms waiting for the browser extension.",
    "No connected browser matches the requested set.",
    // The extension's origin grants (consent.js): the guard doing its job, found by driving a real tab.
    "Read access not granted for origin https://example.com. Grant read permission in extension dashboard.",
    "Action access not granted for origin https://example.com. Grant action permission in extension dashboard.",
    "Cookie access not granted for origin https://example.com. Grant cookie permission in extension dashboard.",
    "Rate limit exceeded for origin https://example.com",
    // A person's answer at the extension's approval queue (approval-gate.js): the human saying no, or not answering.
    "The user declined the approval request for web_click on https://example.com. Do not retry it; ask the user what they want instead.",
    "No answer to the approval request for web_click on https://example.com within 60s, so it was declined by default. Ask the user to approve it, then try again.",
  ]) {
    r.tick(100);
    assert.equal(r.see("web_click", { selector: "#again" }, fail(error)).outcome, "neutral", error);
  }
  assert.equal(r.ev("shop.example").failures, 0, "the safety layer saying no is not the agent's fault");

  r.tick(100);
  assert.equal(r.see("web_expect", { selector: "#done", condition: "visible" }, ok({ passed: true })).outcome, "verified", "a refusal must not cancel the earlier action's pending verification");

  r.tick(100);
  assert.equal(r.see("web_click", { selector: "#gone" }, fail("Element not found: #gone")).outcome, "failure");
});

test("perception and other read-only tools carry no competence signal", () => {
  const r = rig();
  for (const tool of ["web_screenshot", "web_aria_snapshot", "web_page_observe", "web_tabs", "web_console"]) {
    assert.equal(r.see(tool, { url: SHOP }, ok()).outcome, null, tool);
  }
  assert.equal(r.spine.has("shop.example"), false);
});

// ── which domain, which session ─────────────────────────────────────────────

test("a click inherits the domain of its own tab, else the session's latest, else nothing", () => {
  const r = rig();
  r.see("web_navigate", { url: "https://a.example/", tabId: 1 }, ok({ url: "https://a.example/", tabId: 1 }));
  r.tick(1000);
  r.see("web_navigate", { url: "https://b.example/", tabId: 2 }, ok({ url: "https://b.example/", tabId: 2 }));
  r.tick(1000);
  assert.equal(r.see("web_click", { tabId: 1, selector: "#x" }, ok()).domain, "a.example");
  assert.equal(r.see("web_click", { tabId: 2, selector: "#x" }, ok()).domain, "b.example");
  assert.equal(r.see("web_click", { selector: "#x" }, ok()).domain, "b.example", "no tab given: the most recent domain in this session");

  assert.equal(r.see("web_click", { selector: "#x" }, ok(), "another-session").outcome, null, "a different session inherits nothing");

  r.tick(121_000);
  assert.equal(r.see("web_click", { selector: "#x" }, ok()).outcome, null, "context goes stale after two minutes");
});

test("one session's assertion cannot verify another session's action", () => {
  const r = rig();
  r.see("web_click", { url: SHOP, selector: "#buy" }, ok(), "session-A");
  r.tick(500);
  assert.equal(r.see("web_expect", { url: SHOP, selector: "#x", condition: "visible" }, ok({ passed: true }), "session-B").outcome, "neutral");
  assert.equal(r.ev("shop.example").verified, 0);
});

test("hostOf and sessionOf", () => {
  assert.equal(hostOf("https://www.Example.com/x?y=1"), "example.com");
  assert.equal(hostOf("example.com"), "example.com");
  for (const bad of ["not a url", "http://127.0.0.1:3000/", "https://localhost/", "localhost:3000", "", undefined, 42, null]) {
    assert.equal(hostOf(bad), "", String(bad));
  }
  assert.equal(sessionOf("mcp-abc-123"), "mcp-abc-123");
  assert.equal(sessionOf("  weird <script>id  "), "weirdscriptid", "junk characters are stripped");
  assert.equal(sessionOf("x".repeat(200)).length, 64);
  assert.equal(sessionOf(undefined, T0), "http:2026-01-01");
  assert.notEqual(sessionOf("", T0), sessionOf("", T0 + 86_400_000), "a header-less caller counts as a new session each day, not forever the same one");
});

test("observe never throws on hostile input", () => {
  const r = rig();
  for (const args of [{ url: 42 }, { url: { toString() { throw new Error("boom"); } } }, { tabId: {} }, {}] as Array<Record<string, unknown>>) {
    assert.doesNotThrow(() => r.see("web_click", args, { ok: true, data: undefined }));
  }
});

test("every tool the observer classifies is a real tool in the catalogue", () => {
  const declared = new Set(toolDefinitions().map((t) => t.name));
  for (const tool of [...ACTION_TOOLS, ...VERIFIER_TOOLS]) assert.ok(declared.has(tool), `${tool} is not a declared tool (renamed, or a typo?)`);
});

// ── the loop earns a level; clicking does not ───────────────────────────────

test("the act, expect loop earns a level over sessions, while bare clicks stay capped", () => {
  const r = rig();
  const dom = "loop.example";
  for (let s = 0; s < 3; s += 1) {
    for (let i = 0; i < 3; i += 1) {
      r.see("web_click", { url: `https://${dom}/`, selector: `#b${i}` }, ok(), `sess-${s}`);
      r.tick(100);
      r.see("web_expect", { selector: `#r${i}`, condition: "visible" }, ok({ passed: true }), `sess-${s}`);
      r.tick(100);
    }
    r.tick(60_000);
  }
  assert.equal(r.spine.evaluate(dom, T0 + 3_600_000).levelName, "COMPETENT");

  const clicks = rig();
  for (let s = 0; s < 3; s += 1) for (let i = 0; i < 300; i += 1) clicks.see("web_click", { url: "https://clicky.example/", selector: "#x" }, ok(), `sess-${s}`);
  const ev = clicks.spine.evaluate("clicky.example", T0);
  assert.equal(ev.evidence.verified, 0);
  assert.equal(ev.level, 2, "900 unverified clicks reach ADVANCED_BEGINNER at most");
});

// ── the tools that report the level ─────────────────────────────────────────

function call(tool: string, args: Record<string, unknown>, session = "test-session"): any {
  let body: unknown;
  const res = { json: (b: unknown) => { body = b; } } as unknown as Response;
  assert.equal(handleCognitiveTool(tool, args, res, { session }), true, `${tool} must be handled by the hub`);
  return body;
}

test("web_cognitive_stage reports the earned level and no longer lets a caller force a stage", () => {
  const fresh = call("web_cognitive_stage", { domain: "handler-stage.example" });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.data.stage, 1);
  assert.equal(fresh.data.competence.levelName, "NOVICE");
  assert.equal(fresh.data.competence.source, "earned");

  const evaluated = call("web_cognitive_stage", { domain: "handler-stage.example", action: "evaluate" });
  assert.equal(evaluated.data.evaluated, true, "the advertised 'evaluate' action now exists");
  assert.equal(evaluated.data.promotable, false);
  assert.ok(evaluated.data.competence.next.needs.length > 0, "and says what it would take");

  const forced = call("web_cognitive_stage", { domain: "handler-stage.example", action: "override", stage: 5, reason: "test" });
  assert.equal(forced.data.vouchApplied.appliedLevel, 3);
  assert.equal(forced.data.vouchApplied.cappedAtCompetent, true);
  assert.equal(forced.data.competence.level, 1, "the earned level is untouched");
  assert.equal(forced.data.competence.effectiveLevel, 3);
  assert.equal(forced.data.competence.source, "vouched");
  assert.equal(forced.data.stage, 3, "the advisory view shows the vouched stage");
  assert.equal(globalSpine.earnedLevel("handler-stage.example"), 1);

  // ...and the other level tools agree with it.
  assert.equal(call("web_cognitive_maturation", { domain: "handler-stage.example" }).data.stageLevel, 3);
  assert.match(call("web_cognitive_lifespan", { domain: "handler-stage.example" }).data.stage, /LEVEL_3/);
});

test("a caller cannot promote a domain by reporting a big win", () => {
  const dom = "handler-claims.example";
  let last: any;
  for (let i = 0; i < 5; i += 1) last = call("web_cognitive_maturation", { domain: dom, event: { outcome: "success", xpGain: 500 } });
  assert.deepEqual(last.data.argsIgnored, ["event.xpGain"], "the caller is told the number was ignored");
  assert.equal(last.data.stageLevel, 1);
  assert.equal(last.data.competence.evidence.reported, 5);
  assert.equal(last.data.competence.evidence.weightedSuccesses, 0.5, "five self-reports are worth half of one verified success");
  assert.ok(last.data.cognitiveXp < XP_ONE_STAGE, `XP ${last.data.cognitiveXp} must stay far below the next stage`);
});
const XP_ONE_STAGE = 100;

test("a reported burn or trauma is a failure, and a tripped breaker is the strongest one", () => {
  const dom = "handler-burn.example";
  assert.equal(call("web_cognitive_lifespan", { domain: dom, event: { outcome: "burn" } }).data.competence.evidence.failures, 1);
  assert.equal(call("web_cognitive_maturation", { domain: dom, event: { outcome: "trauma" } }).data.competence.evidence.failures, 2);

  const trip = call("web_amygdala_threat_inoculation", { domain: "handler-trip.example", signal: { fingerprint: "cloudflare_turnstile" } });
  assert.equal(trip.data.breakerState, "TRIPPED");
  assert.equal(globalSpine.evaluate("handler-trip.example").evidence.breakers, 1, "the breaker feeds the spine");
  const calm = call("web_amygdala_threat_inoculation", { domain: "handler-calm.example", signal: {} });
  assert.notEqual(calm.data.breakerState, "TRIPPED");
  assert.equal(globalSpine.has("handler-calm.example"), false, "a clean encounter is not evidence of a breaker");
});

test("an empty domain is refused by the three level tools instead of creating a record under ''", () => {
  for (const tool of ["web_cognitive_stage", "web_cognitive_maturation", "web_cognitive_lifespan"]) {
    const body = call(tool, { domain: "   " });
    assert.equal(body.ok, false, tool);
    assert.match(body.data.error, /domain is required/, tool);
  }
});

test("age-taking tools default to the spine's age for the domain, and an explicit age is still a plain input", () => {
  const dom = "age-default.example";
  assert.equal(call("web_working_memory_span", { domain: dom }).data.digitSpanChunks, 2, "a domain with no evidence is an infant");
  const infant = call("web_erikson_identity", { domain: dom }).data.eriksonStage;

  globalSpine.vouch(dom, 3, "operator", "op");
  assert.equal(call("web_working_memory_span", { domain: dom }).data.digitSpanChunks, 4, "a COMPETENT domain gets the child span, without the caller saying so");
  assert.equal(call("web_erikson_identity", { domain: dom }).data.eriksonStage, "INDUSTRY_VS_INFERIORITY");
  assert.notEqual(call("web_erikson_identity", { domain: dom }).data.eriksonStage, infant);

  assert.equal(call("web_working_memory_span", { domain: dom, cognitiveAgeYears: 25 }).data.digitSpanChunks, 7, "asking 'what would the span be at 25?' still works");
});

test("wisdom: the hub measures depth and accuracy once it has evidence, and only that score is stored for the gate", () => {
  const cold = "wisdom-cold.example";
  const c = call("web_wisdom_calibration", { domain: cold, knowledgeDepth: 1, statedConfidence: 0.9, measuredAccuracy: 0.9 });
  assert.equal(c.data.source, "caller", "with no evidence the tool is the calculator it always was");
  assert.equal(c.data.stored, false);
  assert.ok(c.data.wisdomScore > 0.8);
  assert.equal(globalSpine.wisdom(cold), null, "a caller-computed score is never stored for the gate to read");

  const warm = "wisdom-warm.example";
  for (let i = 0; i < 4; i += 1) globalSpine.record(warm, "verified", `w${i}`);
  globalSpine.record(warm, "failure", "w0");
  globalSpine.record(warm, "weak", "w1");
  const w = call("web_wisdom_calibration", { domain: warm, knowledgeDepth: 1, statedConfidence: 1, measuredAccuracy: 1 });
  assert.equal(w.data.source, "spine");
  assert.equal(w.data.stored, true);
  assert.deepEqual(w.data.argsIgnored, ["knowledgeDepth", "measuredAccuracy"]);
  assert.ok(w.data.wisdomScore < 0.5, `claiming perfection must not make it so (got ${w.data.wisdomScore})`);
  assert.equal(globalSpine.wisdom(warm)!.score, w.data.wisdomScore, "the stored score is the hub-measured one");
});
