// ScreenSync Cognitive Memory & Auto-Learning Unit Tests
// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { toolDefinitions } from "../catalog.js";
import { CognitiveMemoryStore } from "../cognitive-memory.js";

test("web_recall & web_learn: catalogue schema validation", () => {
  const tools = toolDefinitions();
  const recallTool = tools.find((t) => t.name === "web_recall");
  const learnTool = tools.find((t) => t.name === "web_learn");

  assert.ok(recallTool, "web_recall must exist in catalog");
  assert.ok(learnTool, "web_learn must exist in catalog");

  const recallSchema = recallTool.inputSchema as any;
  assert.equal(recallSchema.type, "object");
  assert.ok(recallSchema.properties.domain, "domain property exists in recall");
  assert.ok(recallSchema.properties.intent, "intent property exists in recall");

  const learnSchema = learnTool.inputSchema as any;
  assert.equal(learnSchema.type, "object");
  assert.ok(learnSchema.required.includes("action"), "action required in learn");
  assert.ok(learnSchema.required.includes("domain"), "domain required in learn");
});

test("CognitiveMemoryStore: recall on unknown domain returns empty gracefully", () => {
  const store = new CognitiveMemoryStore();
  const res = store.recall({ domain: "completely-unknown-domain-12345.org" });
  assert.equal(res.found, false);
  assert.equal(res.fastPathAvailable, false);
  assert.equal(res.pitfalls.length, 0);
  assert.equal(res.recommendedPlaybook, null);
});

test("CognitiveMemoryStore: recall on x.com returns seeded playbook and pitfalls", () => {
  const store = new CognitiveMemoryStore();
  const res = store.recall({ url: "https://x.com/compose/post", intent: "post" });

  assert.equal(res.found, true);
  assert.equal(res.domain, "x.com");
  assert.equal(res.fastPathAvailable, true);
  assert.ok(res.recommendedPlaybook, "Recommended playbook must exist");
  assert.equal(res.recommendedPlaybook?.name, "x_publish_post");
  assert.equal(res.recommendedPlaybook?.steps.length, 6);

  // Verify critical pitfalls
  assert.ok(res.pitfalls.length >= 4, "Must have at least 4 seeded pitfalls");
  const draftJsPitfall = res.pitfalls.find((p) => p.id === "pitfall_x_draftjs_fill");
  assert.ok(draftJsPitfall, "Must contain pitfall_x_draftjs_fill");
  assert.ok(draftJsPitfall?.provenSolution.includes("execCommand"), "Must guide agent to execCommand");

  const cspPitfall = res.pitfalls.find((p) => p.id === "pitfall_x_csp_eval");
  assert.ok(cspPitfall, "Must contain pitfall_x_csp_eval");

  const windowPitfall = res.pitfalls.find((p) => p.id === "pitfall_x_unfocused_screenshot");
  assert.ok(windowPitfall, "Must contain pitfall_x_unfocused_screenshot");
});

test("CognitiveMemoryStore: learn new pitfall and immediately recall it", () => {
  const store = new CognitiveMemoryStore();
  const testDomain = "test-site-" + Date.now() + ".com";

  const learnRes = store.learn({
    action: "pitfall",
    domain: testDomain,
    data: {
      symptom: "Modal refuses to submit with standard click",
      rootCause: "Shadow DOM submit button intercepts pointer events",
      antiPattern: "web_click('button#submit')",
      provenSolution: "Use pierce/ locator or dispatch synthetic PointerEvent"
    }
  });

  assert.equal(learnRes.learned, true);
  assert.equal(learnRes.domain, testDomain);

  // Recall immediately
  const recallRes = store.recall({ domain: testDomain });
  assert.equal(recallRes.found, true);
  assert.equal(recallRes.pitfalls.length, 1);
  assert.equal(recallRes.pitfalls[0].symptom, "Modal refuses to submit with standard click");
  assert.ok(recallRes.pitfalls[0].rootCause.includes("Shadow DOM"));
});

test("CognitiveMemoryStore: learn new procedural playbook and retrieve fast-path", () => {
  const store = new CognitiveMemoryStore();
  const testDomain = "cms-example-" + Date.now() + ".org";

  const learnRes = store.learn({
    action: "playbook",
    domain: testDomain,
    intent: "publish_article",
    data: {
      name: "quick_publish",
      description: "Automated article publish workflow",
      targetDurationSeconds: 10,
      steps: [
        { step: 1, name: "Navigate to Editor", tool: "web_navigate", args: { url: "https://" + testDomain + "/edit" } },
        { step: 2, name: "Click Publish", tool: "web_click", args: { selector: "#publish-btn" } }
      ]
    }
  });

  assert.equal(learnRes.learned, true);

  const recallRes = store.recall({ domain: testDomain, intent: "publish_article" });
  assert.equal(recallRes.found, true);
  assert.equal(recallRes.fastPathAvailable, true);
  assert.equal(recallRes.recommendedPlaybook?.name, "quick_publish");
  assert.equal(recallRes.recommendedPlaybook?.steps.length, 2);
  assert.equal(recallRes.estimatedSeconds, 10);
});

test("CognitiveMemoryStore: condition probing & adaptive branching", () => {
  const store = new CognitiveMemoryStore();
  // Standard recall without signals
  const stdRes = store.recall({ domain: "x.com", intent: "post" });
  assert.equal(stdRes.found, true);
  assert.equal(stdRes.environmentalProbes.length, 4);
  assert.equal(stdRes.selectedBranch, null);
  assert.equal(stdRes.estimatedSeconds, 15);

  // Recall with condition signal: compose modal is already open
  const fastRes = store.recall({
    domain: "x.com",
    intent: "post",
    detectedSignals: { pan_already_on_fire_compose_open: true }
  });
  assert.ok(fastRes.selectedBranch, "Should select fast branch when compose modal is already open");
  assert.equal(fastRes.selectedBranch?.skipToStep, 4);
  assert.equal(fastRes.estimatedSeconds, 5);
});
