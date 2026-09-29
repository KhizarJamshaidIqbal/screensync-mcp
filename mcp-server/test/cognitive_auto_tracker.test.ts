// cognitive-auto-tracker.ts: every relayed tool result becomes an episode under the domain the observer
// resolved (M6), and those episodes are written with one coalesced save rather than one fsync per call (M9).

// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import test from "node:test";
import assert from "node:assert/strict";
import { isDegradedResult, trackToolExecution } from "../cognitive-auto-tracker.js";
import { CognitiveMemoryStore, cognitiveStore } from "../cognitive-memory.js";
import { stopCognitivePersistence } from "../cognitive-engines.js";

const episodesFor = (store: CognitiveMemoryStore, domain: string, intent?: string) =>
  store.load().episodes.filter((e) => e.domain === domain && (!intent || e.intent === intent));

test("M6: navigate then click on the same tab records a click episode for x.com", () => {
  const session = "tracker-m6";
  const before = episodesFor(cognitiveStore, "x.com", "click").length;

  trackToolExecution("web_navigate", { url: "https://www.x.com/home", tabId: 41 }, { ok: true, data: { tabId: 41 } }, 300, session);
  // A click names no url: its domain can only come from the tab it ran on.
  trackToolExecution("web_click", { tabId: 41, selector: "[data-testid=tweetButton]" }, { ok: true, data: { clicked: true } }, 120, session);

  const clicks = episodesFor(cognitiveStore, "x.com", "click");
  assert.equal(clicks.length, before + 1, "the click is logged under the tab's domain");
  const click = clicks[clicks.length - 1];
  assert.equal(click.success, true);
  assert.equal(click.outcome, "weak", "the observer's classification is kept on the episode");
  assert.equal(episodesFor(cognitiveStore, "x.com", "navigate").length >= 1, true);
});

test("M6: a failed type on the same tab is a failure episode for that domain", () => {
  const session = "tracker-m6-fail";
  trackToolExecution("web_navigate", { url: "https://Example.org:443/login", tabId: 9 }, { ok: true }, 200, session);
  trackToolExecution("web_type", { tabId: 9, selector: "#missing", text: "hi" }, { ok: false, error: "Element not found" }, 80, session);
  const typed = episodesFor(cognitiveStore, "example.org", "type");
  assert.equal(typed.length, 1);
  assert.equal(typed[0].success, false);
  assert.equal(typed[0].outcome, "failure");
  assert.match(String(typed[0].notes), /Element not found/);
});

test("a dead browser event stream is neutral: it says nothing about the domain", () => {
  const session = "tracker-stream-down";
  trackToolExecution("web_navigate", { url: "https://stream.example/", tabId: 2 }, { ok: true }, 20, session);
  trackToolExecution("web_click", { tabId: 2, selector: "#a" }, { ok: false, error: "BROWSER_STREAM_DOWN: The browser's live event stream (SSE) to the hub is down" }, 20, session);
  const click = episodesFor(cognitiveStore, "stream.example", "click")[0];
  assert.equal(click.outcome, "neutral");
});

test("a result the tool flagged degraded is logged as degraded, and reflection does not count it as a clean success", () => {
  // Seen live 2026-09-29: stale or mislabelled screenshots answered ok:true, were logged as clean successes,
  // and reflection then reported "screenshot has succeeded in all 28 recorded runs".
  const session = "tracker-degraded";
  const d = "shots.example";
  const shot = (data: Record<string, unknown>) =>
    trackToolExecution("web_screenshot", { tabId: 77 }, { ok: true, data: { imageDataUrl: "data:image/jpeg;base64,AA", url: `https://${d}/page`, title: "Page", format: "jpeg", ...data } }, 150, session);

  for (let i = 0; i < 5; i += 1) shot({ paintConfirmed: true });
  const warning = "The capture went ahead without a freshly painted frame: the page reported document.visibilityState 'hidden'.";
  shot({ paintConfirmed: false, degraded: true, warning });
  shot({ navigatedDuringCapture: { before: "https://other.example/", after: `https://${d}/page` }, degraded: true, warning: "The tab navigated while it was being captured." });

  const eps = episodesFor(cognitiveStore, d, "screenshot");
  assert.equal(eps.length, 7);
  const clean = eps.slice(0, 5);
  assert.ok(clean.every((e) => e.success === true && e.outcome === undefined && /completed in/.test(String(e.notes))), "a clean capture is logged exactly as before");
  const [stale, moved] = eps.slice(5);
  assert.equal(stale.success, true, "ok:true stays a success at transport level");
  assert.equal(stale.outcome, "degraded");
  assert.match(String(stale.notes), /returned a degraded result in 150ms: The capture went ahead without a freshly painted frame/);
  assert.equal(moved.outcome, "degraded");
  assert.equal(isDegradedResult({ ok: true, data: { degraded: "yes" } }), false, "only a literal degraded: true counts");
  assert.equal(isDegradedResult({ ok: false, error: "x", data: { degraded: true } }), false, "a failure stays a failure");

  const [r] = cognitiveStore.reflect({ domain: d, force: true });
  const reliability = r.insights.find((i) => i.key === "intent_reliability:screenshot")!;
  assert.doesNotMatch(reliability.insight, /succeeded in all/);
  assert.match(reliability.insight, /clean result in 5 of 7 .*2 came back degraded/);
});

test("the tracker never logs the local machine or an unresolved domain", () => {
  const before = cognitiveStore.load().episodes.length;
  trackToolExecution("web_navigate", { url: "http://localhost:3000/" }, { ok: true }, 10, "tracker-local");
  trackToolExecution("web_click", { selector: "#x" }, { ok: true }, 10, "tracker-nothing-known");
  assert.equal(cognitiveStore.load().episodes.length, before);
});

test("a local or non-web navigation after a real site is filed under neither, nor are the clicks on that page", () => {
  const session = "tracker-local-after-site";
  trackToolExecution("web_navigate", { url: "https://inherit.example/", tabId: 1 }, { ok: true }, 10, session);
  const onSite = episodesFor(cognitiveStore, "inherit.example").length;
  trackToolExecution("web_navigate", { url: "http://localhost:3000/admin", tabId: 1 }, { ok: false, error: "net::ERR_CONNECTION_REFUSED" }, 10, session);
  trackToolExecution("web_navigate", { url: "file:///C:/tmp/a.html" }, { ok: true }, 10, session);
  trackToolExecution("web_click", { tabId: 1, selector: "#local" }, { ok: true }, 10, session);
  trackToolExecution("web_click", { selector: "#local" }, { ok: true }, 10, session);
  assert.equal(episodesFor(cognitiveStore, "inherit.example").length, onSite, "nothing on the local pages lands on inherit.example");
  // Back on a real site, attribution resumes.
  trackToolExecution("web_navigate", { url: "https://inherit.example/next", tabId: 1 }, { ok: true }, 10, session);
  trackToolExecution("web_click", { tabId: 1, selector: "#a" }, { ok: true }, 10, session);
  assert.equal(episodesFor(cognitiveStore, "inherit.example").length, onSite + 2);
});

test("M9: tracker episodes are saved once, coalesced, and flushed by stopCognitivePersistence", () => {
  const session = "tracker-defer";
  cognitiveStore.flush();
  const onDiskBefore = episodesFor(new CognitiveMemoryStore(cognitiveStore.file), "deferred.example").length;

  trackToolExecution("web_navigate", { url: "https://deferred.example/", tabId: 3 }, { ok: true }, 50, session);
  trackToolExecution("web_click", { tabId: 3, selector: "#a" }, { ok: true }, 50, session);
  assert.equal(cognitiveStore.hasPendingSave(), true, "the write is deferred");
  assert.equal(episodesFor(new CognitiveMemoryStore(cognitiveStore.file), "deferred.example").length, onDiskBefore, "nothing written yet");

  stopCognitivePersistence();
  assert.equal(cognitiveStore.hasPendingSave(), false);
  assert.equal(episodesFor(new CognitiveMemoryStore(cognitiveStore.file), "deferred.example").length, onDiskBefore + 2, "the shutdown flush persisted both");
});
