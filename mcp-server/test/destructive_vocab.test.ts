// The destructive-action appraisal behind the cognitive gate (`destructive_keyword`).
//
// It used to be a bare substring regex, so a read-only web_eval that looked up `[data-nav-dropdown]` was
// "destructive" (drop), as were `display` (pay), `backdrop`, `removeEventListener` and `deleted`. The live
// incident: that check was queued for a human, nobody saw it, and the agent was told the hub was down. At the
// same time the gate never flagged code that really does change things when it avoided the magic words:
// `.submit()`, a POST fetch, `localStorage.clear()`, a cookie write, `location.href =`, `.click()`.
//
// One table (extension/test/destructive_cases.json) is shared with the extension's copy of the appraisal.

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gateBeforeRelay } from "../cognitive-policy.js";
import { TranscendentalCognitionEngine } from "../cognitive-transcendental.js";

type Cases = { code: { safe: string[]; destructive: string[] }; ui: { safe: string[]; destructive: string[] } };
const cases = JSON.parse(readFileSync(new URL("../../extension/test/destructive_cases.json", import.meta.url), "utf8")) as Cases;
const engine = new TranscendentalCognitionEngine();
const flagged = (markers: string[]) => markers.filter((m) => m === "destructive_keyword" || m.startsWith("destructive_code"));

test("the live incident: a read-only web_eval that mentions a dropdown is not gated", () => {
  const code = cases.code.safe[0];
  assert.match(code, /data-nav-dropdown/);
  assert.deepEqual(flagged(engine.somaticMarkerRisk("citytourinbarcelona.com", { text: code }).markers), []);
  assert.equal(gateBeforeRelay("web_eval", { url: "https://citytourinbarcelona.com/", code }, "s-incident"), null);
});

test("code that only reads the page raises no destructive marker and is not gated", () => {
  for (const code of cases.code.safe) {
    const risk = engine.somaticMarkerRisk("novice-vocab.example", { text: code });
    assert.deepEqual(flagged(risk.markers), [], `must not be flagged: ${code}`);
    assert.equal(gateBeforeRelay("web_eval", { url: "https://novice-vocab.example/", code }, "s-safe"), null, `must not be gated: ${code}`);
  }
});

test("code that changes things is still flagged, and gated on a NOVICE domain", () => {
  for (const code of cases.code.destructive) {
    const risk = engine.somaticMarkerRisk("novice-vocab.example", { text: code });
    assert.notDeepEqual(flagged(risk.markers), [], `must be flagged: ${code}`);
    const gate = gateBeforeRelay("web_eval", { url: "https://novice-vocab.example/", code }, "s-danger");
    assert.ok(gate, `must be gated: ${code}`);
    assert.ok(gate.decision.riskScore >= 0.34, `${code}: risk ${gate.decision.riskScore}`);
  }
});

test("clicks and typed text: identifiers and look-alike words are not destructive, real ones are", () => {
  for (const selector of cases.ui.safe) {
    assert.equal(gateBeforeRelay("web_click", { url: "https://novice-ui.example/", selector }, "s-ui"), null, `must not be gated: ${selector}`);
  }
  for (const selector of cases.ui.destructive) {
    assert.ok(gateBeforeRelay("web_click", { url: "https://novice-ui.example/", selector }, "s-ui"), `must be gated: ${selector}`);
  }
});

test("the gate says which word or construct it found, so the person asked can judge it", () => {
  const gate = gateBeforeRelay("web_eval", { url: "https://novice-reason.example/", code: "document.querySelector('form').submit()" }, "s-reason");
  assert.ok(gate);
  assert.ok(gate.decision.markers.some((m) => m.startsWith("destructive_code")), JSON.stringify(gate.decision.markers));
  assert.match(gate.decision.reason, /submit/);
  assert.match(gate.decision.reason, /needed to act on it unsupervised/, "the rest of the reason is unchanged");

  const word = gateBeforeRelay("web_click", { url: "https://novice-reason.example/", selector: "button.delete-account" }, "s-reason");
  assert.ok(word);
  assert.ok(word.decision.markers.includes("destructive_keyword"), "the marker name other code relies on is unchanged");
  assert.match(word.decision.reason, /delete/);
});
