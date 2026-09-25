// What the MCP side says when a web_* round trip to the hub fails. Only a refused connection means the hub is
// down; a timeout on a hub that is up means the browser has not answered (often: an approval nobody has seen).
// See approval_timeout.e2e.ts for the incident end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { APPROVAL_MAX_MS, APPROVAL_RUN_HEADROOM_MS } from "../web-ext-routes.js";
import { callHubWebTool, callTimeoutOf, HUB_MAX_HOLD_MS, IN_PAGE_MARGIN_MS, transportTimeoutMs } from "../hub-web-call.js";
import { hubSelfCheck } from "../config.js";

async function serve(onRequest: Parameters<typeof createServer>[1]): Promise<{ base: string; server: Server }> {
  const server = createServer(onRequest);
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
const stop = (server: Server) => new Promise((r) => { server.closeAllConnections(); server.close(r); });

test("the transport outlives the longest the hub may hold a call for a person", () => {
  assert.equal(HUB_MAX_HOLD_MS, APPROVAL_MAX_MS + APPROVAL_RUN_HEADROOM_MS);
  const def = callTimeoutOf({});
  assert.equal(def, 45_000);
  assert.ok(def + 5_000 < HUB_MAX_HOLD_MS, "the old abort (call timeout + 5s) was shorter than an approval wait: that was the bug");
  assert.ok(transportTimeoutMs(def) > HUB_MAX_HOLD_MS, "now the hub always answers first");
  assert.ok(transportTimeoutMs(1_000) > HUB_MAX_HOLD_MS, "however short the call timeout");
  assert.ok(transportTimeoutMs(120_000) > 120_000, "and a longer call timeout still wins");
});

test("an in-page budget (web_expect timeoutMs) gets a margin so the browser's own verdict arrives", () => {
  assert.equal(callTimeoutOf({ timeoutMs: 25_000 }), 30_000, "the hub waits the budget plus 5 s");
  assert.equal(callTimeoutOf({ timeoutMs: 100 }), 6_000, "a tiny budget is floored at 1 s, then the margin");
  assert.equal(callTimeoutOf({ timeoutMs: 119_000 }), 120_000, "still capped");
  assert.equal(callTimeoutOf({}), 45_000, "no budget: the old default, unchanged");
  assert.ok(callTimeoutOf({ timeoutMs: 60_000 }) > 60_000, "a 60 s budget is not cut at 60 s any more");
});

test("a refused connection says the hub is not reachable", async () => {
  const { base, server } = await serve(() => undefined);
  await stop(server); // the port is now closed: nothing listens there
  const r = await callHubWebTool("web_status", {}, { baseUrl: base });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HUB_UNREACHABLE");
  assert.match(String(r.error), /not reachable/);
  assert.match(String(r.error), /ECONNREFUSED/);
});

test("a hub that is up but has not answered is a timeout, not an outage", async () => {
  const { base, server } = await serve(() => undefined); // takes the request, never answers
  try {
    const r = await callHubWebTool("web_eval", { code: "1" }, { baseUrl: base, transportTimeoutMs: 400 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "TIMEOUT");
    assert.doesNotMatch(String(r.error), /not reachable|start the hub/i);
    assert.match(String(r.error), /didn't answer within \d+s/);
    assert.match(String(r.error), /waiting for your approval/);
  } finally {
    await stop(server);
  }
});

test("a connection the hub drops mid-call is reported as that", async () => {
  const { base, server } = await serve((req) => { req.socket.destroy(); });
  try {
    const r = await callHubWebTool("web_click", {}, { baseUrl: base });
    assert.equal(r.ok, false);
    assert.equal(r.code, "HUB_CONNECTION_LOST", String(r.error));
    assert.doesNotMatch(String(r.error), /not reachable/);
  } finally {
    await stop(server);
  }
});

test("the extension's outcome and code reach the caller; the call carries the session and token", async () => {
  let seen: { auth?: string; session?: string; body?: any } = {};
  const { base, server } = await serve((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      seen = { auth: req.headers.authorization, session: String(req.headers["x-session-id"]), body: JSON.parse(raw) };
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false, ok: false, code: "APPROVAL_TIMEOUT", retryable: true, error: "No answer to the approval request for web_eval on https://x.example within 60s." }));
    });
  });
  try {
    const r = await callHubWebTool("web_eval", { code: "1", timeoutMs: 2_000 }, { baseUrl: base, token: "t0k" });
    assert.deepEqual({ ok: r.ok, code: r.code, retryable: r.retryable }, { ok: false, code: "APPROVAL_TIMEOUT", retryable: true });
    assert.match(String(r.error), /No answer to the approval request/);
    assert.equal(seen.auth, "Bearer t0k");
    assert.match(String(seen.session), /^mcp-/);
    assert.equal(seen.body.tool, "web_eval");
    // 2026-09-23: the hub waits the browser-side budget plus IN_PAGE_MARGIN_MS, so the extension answers first.
    assert.equal(seen.body.timeoutMs, 2_000 + IN_PAGE_MARGIN_MS);
  } finally {
    await stop(server);
  }
});

// 2026-09-25: web_status and web_navigate both failed with the exact same opaque "Hub replied 404" for 20+
// minutes of retries, live. Every code path in web.ts and profile-registry.ts was audited: this Express app has
// no route that can answer web_status (or any dispatch refusal) with a bare 404, so the request never reached
// it at all — this process's own startHttpHub() had lost the port to an unrelated service (index.ts already
// detects this, but used to just log it and continue). These tests cover the fix: fail fast with a diagnosis
// instead of round-tripping to the wrong service, and self-heal the moment a real hub is reachable again.
test("hubSelfCheck marks this process's hub as down: the call fails fast with HUB_PORT_CONFLICT, never reaching the wrong service's /api/web/tool", async () => {
  let toolRouteHit = false;
  const { base, server } = await serve((req, res) => {
    if (req.url === "/health") {
      // A foreign service on the port: answers something, but not the ScreenSync hub's shape.
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "some-other-dev-server" }));
      return;
    }
    toolRouteHit = true; // must never happen: the whole point is not to round-trip to the wrong service
    res.statusCode = 404;
    res.end();
  });
  hubSelfCheck.ok = false;
  hubSelfCheck.detail = null;
  try {
    const startedAt = Date.now();
    const r = await callHubWebTool("web_status", {}, { baseUrl: base });
    assert.equal(r.ok, false);
    assert.equal(r.code, "HUB_PORT_CONFLICT");
    assert.match(String(r.error), /port conflict|not the ScreenSync hub/i);
    assert.equal(toolRouteHit, false, "the doomed round trip to the wrong service must be skipped entirely");
    assert.ok(Date.now() - startedAt < 5_000, "must fail fast (a bounded /health probe), not wait out the normal call timeout");
    assert.equal(hubSelfCheck.ok, false, "still down: /health did not confirm a real hub");
  } finally {
    hubSelfCheck.ok = true;
    hubSelfCheck.detail = null;
    await stop(server);
  }
});

test("hubSelfCheck marks this process's hub as down, but a real hub now answers /health: self-heals and the call proceeds normally", async () => {
  const { base, server } = await serve((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "screensync-hub" }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, ok: true, data: { online: true } }));
  });
  hubSelfCheck.ok = false;
  hubSelfCheck.detail = "stale: recorded before the hub came back up";
  try {
    const r = await callHubWebTool("web_status", {}, { baseUrl: base });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { online: true });
    assert.equal(hubSelfCheck.ok, true, "self-healed: no restart of the MCP client should be required");
    assert.equal(hubSelfCheck.detail, null);
  } finally {
    hubSelfCheck.ok = true;
    hubSelfCheck.detail = null;
    await stop(server);
  }
});

test("a non-hub error response (no ok/error/success field at all) is flagged as HUB_UNEXPECTED_RESPONSE, not a bare 'Hub replied 404'", async () => {
  // hubSelfCheck.ok stays true here: this covers the OTHER way a foreign service ends up on the configured
  // port — a sibling process whose own embedded hub is fine, but whose SCREEN_SYNC_PORT (or a hand-set
  // baseUrl) happens to point at something else entirely. Defense in depth beside the hubSelfCheck short-circuit.
  const { base, server } = await serve((_req, res) => {
    res.statusCode = 404; // e.g. a random local dev server's default 404 page — plain text, not JSON at all
    res.end("Cannot POST /api/web/tool");
  });
  try {
    const r = await callHubWebTool("web_status", {}, { baseUrl: base });
    assert.equal(r.ok, false);
    assert.equal(r.code, "HUB_UNEXPECTED_RESPONSE");
    assert.doesNotMatch(String(r.error), /^Hub replied 404$/, "the old bare, undiagnosable message must be gone");
    assert.match(String(r.error), /port conflict|outdated hub/i);
  } finally {
    await stop(server);
  }
});

test("a long-wait tool (web_takeover, web_request_help, web_wait_download) gets its own budget, not the 120s cap", () => {
  assert.equal(callTimeoutOf({}, "web_takeover"), 300_000 + IN_PAGE_MARGIN_MS, "web_takeover's default 5 min");
  assert.equal(callTimeoutOf({ timeoutMs: 600_000 }, "web_takeover"), 600_000 + IN_PAGE_MARGIN_MS);
  assert.equal(callTimeoutOf({ timeoutMs: 3_600_000 }, "web_takeover"), 600_000 + IN_PAGE_MARGIN_MS, "capped at the catalog max");
  assert.equal(callTimeoutOf({}, "web_request_help"), 120_000 + IN_PAGE_MARGIN_MS);
  assert.equal(callTimeoutOf({ timeoutMs: 90_000 }, "web_wait_download"), 90_000 + IN_PAGE_MARGIN_MS);
  assert.ok(transportTimeoutMs(callTimeoutOf({ timeoutMs: 600_000 }, "web_takeover")) > 600_000, "the transport outlives it");
  assert.equal(callTimeoutOf({ timeoutMs: 25_000 }, "web_expect"), 30_000, "any other tool: the ordinary rule");
  assert.equal(callTimeoutOf({ timeoutMs: 600_000 }), 120_000, "no tool named: the ordinary rule, unchanged");
});
