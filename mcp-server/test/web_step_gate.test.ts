// A risky step inside a multi-step tool meets the approval gate exactly as the same direct call would.
//
// web_flow_run, web_replay, web_fanout and web_tab_fanout relay their steps with request() themselves, so a
// destructive-looking click inside them never reached gateBeforeRelay(): it was relayed unmarked (the extension
// was never told to ask a person) even to an extension that cannot ask at all. The same bridge and recorder as
// web_dispatch.test.ts show what each step looked like when it left the hub.
//
// "Asked" = relayed with `__gate.needsHuman`, so the extension's approval queue holds it for a person.
// "Refused" = USER_CONFIRMATION_REQUIRED, nothing relayed: the browser it would reach cannot ask anyone.

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABLE_A, OLD_B, DANGEROUS, HARMLESS, startHub, withGate, askedPerson, tabsAnswer, sleep, type Hub } from "./_web-hub-harness.js";

const gateRefusal = /^USER_CONFIRMATION_REQUIRED \(cognitive gate\)/;
const RISKY_FLOW = [{ tool: "web_click", args: HARMLESS }, { tool: "web_click", args: DANGEROUS }];
const marks = (hub: Hub) => hub.relayed.map((r) => `${r.tool}${askedPerson(r) ? "+asked" : ""}->${r.targetInstanceId}`);

test("flow run: the risky step is put to a person, like the direct call; the harmless step is not held up", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await withGate("enforce", async () => {
      const direct = await hub.call("web_click", DANGEROUS);
      assert.equal(direct.cognitiveGate?.verdict, "asked", "fixture: the direct call asks a person");
      hub.relayed.length = 0;

      await hub.call("web_flow_save", { name: "risky-flow", steps: RISKY_FLOW });
      const run = await hub.call("web_flow_run", { name: "risky-flow" });
      assert.deepEqual(marks(hub), ["web_click->inst-a", "web_click+asked->inst-a"]);
      assert.equal(run.ok, true, JSON.stringify(run.data?.results));
      assert.equal(run.data.results[1].cognitiveGate?.verdict, "asked", "the step result says a person was asked");
      assert.equal(run.data.results[0].cognitiveGate, undefined);
    });
  } finally {
    await hub.close();
  }
});

test("flow run: where the browser cannot ask anyone the risky step is refused, like the direct call, and never relayed", async () => {
  const hub = await startHub();
  try {
    await hub.register(OLD_B);
    await withGate("enforce", async () => {
      const direct = await hub.call("web_click", DANGEROUS);
      assert.match(String(direct.error), gateRefusal, "fixture: the direct call is refused");

      await hub.call("web_flow_save", { name: "risky-flow-old", steps: RISKY_FLOW });
      const run = await hub.call("web_flow_run", { name: "risky-flow-old" });
      assert.deepEqual(marks(hub), ["web_click->inst-b"], "only the harmless step reached the old extension");
      assert.equal(run.ok, false);
      assert.match(String(run.data.results[1].error), gateRefusal);
    });
  } finally {
    await hub.close();
  }
});

test("replay: a risky step is put to a person where the browser can ask, and refused where it cannot", async () => {
  for (const [browser, expectAsked] of [[CAPABLE_A, true], [OLD_B, false]] as const) {
    const hub = await startHub();
    try {
      await hub.register(browser);
      const replay = await withGate("enforce", () => hub.call("web_replay", { steps: [{ tool: "web_click", args: DANGEROUS }] }));
      if (expectAsked) {
        assert.deepEqual(marks(hub), ["web_click+asked->inst-a"]);
        assert.equal(replay.data.results[0].cognitiveGate?.verdict, "asked");
      } else {
        assert.deepEqual(marks(hub), [], "nothing reaches an extension that would just run it");
        assert.match(String(replay.data.results[0].error), gateRefusal);
      }
    } finally {
      await hub.close();
    }
  }
});

test("a non-risky flow and replay never reach the gate: nothing is held for a person, nothing is annotated", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await withGate("enforce", async () => {
      const steps = [{ tool: "web_navigate", args: { url: "https://gated.example/" } }, { tool: "web_click", args: HARMLESS }, { tool: "web_title", args: {} }];
      await hub.call("web_flow_save", { name: "harmless-flow", steps });
      const run = await hub.call("web_flow_run", { name: "harmless-flow" });
      const replay = await hub.call("web_replay", { steps });
      for (const reply of [run, replay]) {
        assert.equal(reply.ok, true);
        for (const r of reply.data.results) assert.equal(r.cognitiveGate, undefined, `${r.tool} was annotated by the gate`);
      }
      assert.deepEqual(marks(hub), [...Array(2)].flatMap(() => ["web_navigate->inst-a", "web_click->inst-a", "web_title->inst-a"]));
    });
  } finally {
    await hub.close();
  }
});

test("fanout: a risky inner call asks a person in the browser that can, and is refused in the one that cannot", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await hub.register(OLD_B);
    const reply = await withGate("enforce", () => hub.call("web_fanout", { tool: "web_click", args: DANGEROUS }));
    assert.deepEqual(marks(hub), ["web_click+asked->inst-a"], "B's old extension is never handed the call");
    const byBrowser = Object.fromEntries(reply.data.results.map((r: any) => [r.browserId, r]));
    assert.equal(byBrowser["inst-a"].cognitiveGate?.verdict, "asked");
    assert.match(String(byBrowser["inst-b"].error), gateRefusal);
  } finally {
    await hub.close();
  }
});

test("tab fanout: every risky per-tab call is put to a person; the tab listing is not", async () => {
  const hub = await startHub(tabsAnswer);
  try {
    await hub.register(CAPABLE_A);
    const reply = await withGate("enforce", () => hub.call("web_tab_fanout", { tool: "web_click", args: DANGEROUS }));
    assert.deepEqual(marks(hub), ["web_tabs->inst-a", "web_click+asked->inst-a", "web_click+asked->inst-a"]);
    assert.equal(reply.data.results[0].cognitiveGate?.verdict, "asked");
  } finally {
    await hub.close();
  }
});

// Scheduled runs are unattended, so they are deliberately NOT put to a person: a prompt nobody is there to answer
// would hold every run up. Nor does the hub gate them - see the report of this change for that gap. This pins
// the unattended half: a scheduled step leaves the hub unmarked, exactly as before.
test("scheduled runs stay unattended: the hub never holds a scheduled step for a person", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await withGate("enforce", async () => {
      await hub.call("web_flow_save", { name: "scheduled-risky", steps: [{ tool: "web_click", args: DANGEROUS }] });
      const sched = await hub.call("web_flow_schedule", { flow: "scheduled-risky", everyMinutes: 0.05 });
      assert.equal(sched.ok, true, JSON.stringify(sched));
      for (let waited = 0; hub.relayed.length === 0 && waited < 8_000; waited += 100) await sleep(100);
      await hub.call("web_flow_unschedule", { id: sched.data.id });
    });
    assert.ok(hub.relayed.length >= 1, "the schedule ran");
    assert.deepEqual(marks(hub).slice(0, 1), ["web_click->inst-a"]);
  } finally {
    hub.bridge.stopSchedules();
    await hub.close();
  }
});
