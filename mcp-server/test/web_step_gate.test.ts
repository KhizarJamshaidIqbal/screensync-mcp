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
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { CAPABLE_A, OLD_B, DANGEROUS, HARMLESS, headers, startHub, withGate, askedPerson, tabsAnswer, sleep, type Hub, type ToolReply } from "./_web-hub-harness.js";
import { createWebBridge } from "../web.js";

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

// Scheduled runs are unattended, so they are never put to a person: a prompt nobody is there to answer would hold
// every run up. Nor may scheduling be a way around the gate: a step the gate would put to a person, or one that
// waits for a person (web_takeover), is refused in a scheduled run and never relayed; a harmless step runs unmarked.
test("scheduled runs stay unattended: a gated or person-only step is refused, never relayed unmarked", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    await withGate("enforce", async () => {
      const steps = [{ tool: "web_click", args: HARMLESS }, { tool: "web_click", args: DANGEROUS }, { tool: "web_takeover", args: { reason: "login" } }];
      await hub.call("web_flow_save", { name: "scheduled-risky", steps });
      const sched = await hub.call("web_flow_schedule", { flow: "scheduled-risky", everyMinutes: 0.05, stopOnError: false });
      assert.equal(sched.ok, true, JSON.stringify(sched));
      for (let waited = 0; hub.relayed.length === 0 && waited < 8_000; waited += 100) await sleep(100);
      await sleep(300);
      await hub.call("web_flow_unschedule", { id: sched.data.id });
    });
    assert.ok(hub.relayed.length >= 1, "the schedule ran");
    assert.ok(marks(hub).every((m) => m === "web_click->inst-a"), `only unmarked clicks: ${marks(hub)}`);
    assert.ok(hub.relayed.every((r) => r.args.selector === HARMLESS.selector), "the risky click and the takeover were never relayed");
  } finally {
    hub.bridge.stopSchedules();
    await hub.close();
  }
});

test("schedules: a run still going makes the next tick a no-op; an interval past the timer limit is refused", async () => {
  const relayed: string[] = [];
  const bridge = createWebBridge((p) => { if ((p as { type?: string }).type === "web_request") relayed.push((p as { tool: string }).tool); });
  const app = express();
  app.use(express.json());
  bridge.registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (tool: string, args: Record<string, unknown>) =>
    (await (await fetch(`${base}/api/web/tool`, { method: "POST", headers, body: JSON.stringify({ tool, args }) })).json()) as ToolReply;
  try {
    await fetch(`${base}/api/web/register`, { method: "POST", headers, body: JSON.stringify(CAPABLE_A) });
    // Nobody answers: each run's click waits its full 45s, far longer than the 3s interval.
    await call("web_flow_save", { name: "slow", steps: [{ tool: "web_click", args: HARMLESS }] });
    const sched = await call("web_flow_schedule", { flow: "slow", everyMinutes: 0.05 });
    assert.equal(sched.ok, true, JSON.stringify(sched));
    await sleep(7_500); // ticks at ~3s and ~6s
    assert.deepEqual(relayed, ["web_click"], "the second tick did not start a run on top of the first");
    const tooLong = await call("web_flow_schedule", { flow: "slow", everyMinutes: 43_200 });
    assert.equal(tooLong.ok, false, "30 days would overflow the timer to 1ms and run continuously");
    assert.match(String(tooLong.error), /maximum \d+/);
  } finally {
    bridge.stopSchedules();
    bridge.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("web_test_run: a risky step is put to a person where the browser can ask, and refused where it cannot", async () => {
  for (const [browser, expectAsked] of [[CAPABLE_A, true], [OLD_B, false]] as const) {
    const hub = await startHub();
    try {
      await hub.register(browser);
      const direct = await withGate("enforce", () => hub.call("web_click", DANGEROUS));
      hub.relayed.length = 0;
      // Wrapping the refused (or asked) direct call in a test must not relay it unmarked.
      const run = await withGate("enforce", () => hub.call("web_test_run", { steps: [{ tool: "web_click", args: DANGEROUS }] }));
      if (expectAsked) {
        assert.equal(direct.cognitiveGate?.verdict, "asked", "fixture: the direct call asks a person");
        assert.deepEqual(marks(hub), ["web_click+asked->inst-a"]);
      } else {
        assert.match(String(direct.error), gateRefusal, "fixture: the direct call is refused");
        assert.deepEqual(marks(hub), [], "nothing reaches an extension that would just run it");
        assert.equal(run.ok, false);
      }
    } finally {
      await hub.close();
    }
  }
});

test("web_test_run: a person who declined a gated step is not asked again by the test's retries", async () => {
  const declined = { __reply: { ok: false, code: "USER_DECLINED", error: "The user declined this action. Do not retry it." } };
  const hub = await startHub((ev) => (ev.tool === "web_click" ? declined : { ranIn: ev.targetInstanceId }));
  try {
    await hub.register(CAPABLE_A);
    const run = await withGate("enforce", () => hub.call("web_test_run", { steps: [{ tool: "web_click", args: DANGEROUS }], retries: 3 }));
    assert.deepEqual(marks(hub), ["web_click+asked->inst-a"], "asked once, not once per retry");
    assert.equal(run.ok, false);
    assert.equal(run.data.tests[0].attempts, 1);
    // A step the gate refuses outright (nobody can be asked) is not retried either.
    const old = await startHub();
    try {
      await old.register(OLD_B);
      const refused = await withGate("enforce", () => old.call("web_test_run", { steps: [{ tool: "web_click", args: DANGEROUS }], retries: 3 }));
      assert.equal(refused.data.tests[0].attempts, 1);
    } finally {
      await old.close();
    }
  } finally {
    await hub.close();
  }
});

test("a gated step whose browser's stream is down was never sent: its verdict is not 'asked'", async () => {
  const hub = await startHub(undefined, { presence: () => false, streamGraceMs: 50 });
  try {
    await hub.register({ ...CAPABLE_A, sseAttribution: true });
    const replay = await withGate("enforce", () => hub.call("web_replay", { steps: [{ tool: "web_click", args: DANGEROUS }] }));
    const step = replay.data.results[0];
    assert.equal(step.code, "BROWSER_STREAM_DOWN", JSON.stringify(step));
    assert.deepEqual(marks(hub), [], "nothing was relayed");
    assert.equal(step.cognitiveGate?.verdict, "block", "nobody was asked, so it is not reported as asked");
  } finally {
    await hub.close();
  }
});

test("a long-wait step inside a flow, replay or test run waits its own budget, not the 5-60s step clamp", async () => {
  const hub = await startHub();
  try {
    await hub.register(CAPABLE_A);
    const steps = [{ tool: "web_takeover", args: { reason: "login", timeoutMs: 200_000 } }, { tool: "web_click", args: HARMLESS }];
    await hub.call("web_flow_save", { name: "login-flow", steps });
    assert.equal((await hub.call("web_flow_run", { name: "login-flow", stepTimeoutMs: 10_000 })).ok, true);
    assert.equal((await hub.call("web_replay", { steps, stepTimeoutMs: 10_000 })).ok, true);
    await hub.call("web_test_run", { steps });
    const waits = hub.relayed.map((r) => `${r.tool}:${(r as unknown as { remainingMs: number }).remainingMs}`);
    assert.deepEqual(waits, [
      "web_takeover:205000", "web_click:10000", // flow run: the takeover's 200s + margin; the click keeps the clamp
      "web_takeover:205000", "web_click:10000", // replay
      "web_takeover:205000", "web_click:45000", // test run
    ]);
  } finally {
    await hub.close();
  }
});
