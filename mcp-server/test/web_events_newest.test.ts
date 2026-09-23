// web_events {since, limit, newest}. The default is unchanged: the most recent `limit` matching events, oldest
// first, with lastSeq. `newest: true` asks for exactly that; `newest: false` returns the first `limit` after
// `since`, so an agent can page forward through a burst without the gap the tail leaves. `skipped` says how
// many matching events a reply left out. Driven through the real /api/web/tool route (web.ts -> events.ts).

import "./_isolate-data-dir.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { startHub } from "./_web-hub-harness.js";
import { recordHubEvent, lastEventSeq } from "../events.js";

type Ev = { seq: number; type: string; label: string };

test("web_events: default tail, newest:true, newest:false paging, types filter", async () => {
  const hub = await startHub();
  try {
    const before = lastEventSeq();
    for (let i = 0; i < 12; i++) recordHubEvent({ type: i % 3 === 0 ? "web_navigation" : "tool", label: `e${i}` });
    const labels = (d: any) => (d.events as Ev[]).map((e) => e.label);

    // Default: the LAST 4, ascending, as before.
    const tail = (await hub.call("web_events", { since: before, limit: 4 })).data;
    assert.deepEqual(labels(tail), ["e8", "e9", "e10", "e11"]);
    assert.equal(tail.lastSeq, lastEventSeq());
    assert.equal(tail.newest, true);
    assert.equal(tail.skipped, 8);
    const seqs = (tail.events as Ev[]).map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "ascending");

    // newest:true is the same answer.
    const explicit = (await hub.call("web_events", { since: before, limit: 4, newest: true })).data;
    assert.deepEqual(labels(explicit), labels(tail));
    assert.equal(explicit.lastSeq, tail.lastSeq);

    // since:0 (the whole ring) still gives the newest, not the oldest the ring holds.
    const whole = (await hub.call("web_events", { since: 0, limit: 3, newest: true })).data;
    assert.deepEqual(labels(whole), ["e9", "e10", "e11"]);

    // newest:false pages forward from `since` with no gaps.
    const seen: string[] = [];
    let since = before;
    for (let guard = 0; guard < 10; guard++) {
      const page = (await hub.call("web_events", { since, limit: 5, newest: false })).data;
      assert.equal(page.newest, false);
      if (!page.events.length) break;
      seen.push(...labels(page));
      since = page.events[page.events.length - 1].seq;
    }
    assert.deepEqual(seen, Array.from({ length: 12 }, (_, i) => `e${i}`));

    // The types filter applies before the window.
    const navs = (await hub.call("web_events", { since: before, limit: 2, types: "web_navigation", newest: true })).data;
    assert.deepEqual(labels(navs), ["e6", "e9"]);
    assert.equal(navs.skipped, 2);
    const firstNavs = (await hub.call("web_events", { since: before, limit: 2, types: ["web_navigation"], newest: false })).data;
    assert.deepEqual(labels(firstNavs), ["e0", "e3"]);
  } finally {
    await hub.close();
  }
});
