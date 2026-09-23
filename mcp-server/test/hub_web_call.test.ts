// What the MCP side says when a web_* round trip to the hub fails. Only a refused connection means the hub is
// down; a timeout on a hub that is up means the browser has not answered (often: an approval nobody has seen).
// See approval_timeout.e2e.ts for the incident end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { APPROVAL_MAX_MS, APPROVAL_RUN_HEADROOM_MS } from "../web-ext-routes.js";
import { callHubWebTool, callTimeoutOf, HUB_MAX_HOLD_MS, transportTimeoutMs } from "../hub-web-call.js";

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
    assert.equal(seen.body.timeoutMs, 2_000);
  } finally {
    await stop(server);
  }
});
