/**
 * An approval-gated call reports what really happened, not "hub is not reachable".
 *
 * The live incident: web_eval was gated, the extension asked a person (and told the hub to keep waiting),
 * nobody answered, and the MCP caller was told "ScreenSync hub is not reachable ... Start the hub" while
 * web_status answered fine. The MCP stdio server aborted its own HTTP request to the hub (timeoutMs + 5s)
 * long before the hub stopped waiting for the person (the approval window + 20s), and reported the abort as
 * an unreachable hub. The extension's real answer - APPROVAL_TIMEOUT, or USER_DECLINED - never arrived, and
 * its code was dropped by the hub even when it did.
 *
 * Here, scaled down: a real hub + MCP stdio server, and a fake extension that asks for more time and answers
 * after 7s, when the old transport (1s call timeout + 5s) had long given up.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = 3012;
const TOKEN = "e2e-approval-timeout-token";
const BASE = `http://127.0.0.1:${PORT}`;
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
const GATED = { url: "https://gated.example/account", code: "document.querySelector('#row').remove()", timeoutMs: 1000 };

type Relayed = { id: string; tool: string; args: Record<string, any> };
type Answer = { ok: boolean; data?: unknown; error?: string; code?: string; retryable?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function healthy(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error(`hub on :${PORT} did not become healthy`);
}

/** Registers like the extension, listens on SSE, and answers every web_request with `handler`. */
async function fakeExtension(handler: (req: Relayed) => Promise<Answer>) {
  const stop = new AbortController();
  const reg = await fetch(`${BASE}/api/web/register`, {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ browserId: "ext-a", instanceId: "ext-a", browserName: "chrome", webAccessEnabled: true, approvals: true, userAgent: "FakeExt/1.0", tab: { url: "https://gated.example/", title: "t" } }),
  });
  assert.equal(reg.status, 200);
  const sse = await fetch(`${BASE}/api/events`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: stop.signal });
  (async () => {
    const reader = (sse.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, idx).split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(idx + 2);
        if (!line) continue;
        const ev = JSON.parse(line.slice(6)) as Relayed & { type?: string };
        if (ev.type !== "web_request") continue;
        void handler(ev).then((out) => fetch(`${BASE}/api/web/result`, {
          method: "POST", headers: authHeaders, body: JSON.stringify({ id: ev.id, ...out, browserId: "ext-a", instanceId: "ext-a", browserName: "chrome" }),
        }));
      }
    }
  })().catch(() => { /* stream closed at shutdown */ });
  return { close: () => stop.abort() };
}

/** What the extension does for a gated call: tell the hub a person is being asked, wait for them, answer. */
const asksAPerson = (waitMs: number, answer: Answer) => async (req: Relayed): Promise<Answer> => {
  if (!req.args.__gate) return { ok: true, data: { ran: true } };
  await fetch(`${BASE}/api/web/awaiting`, { method: "POST", headers: authHeaders, body: JSON.stringify({ id: req.id, ms: 9_000 }) });
  await sleep(waitMs);
  return answer;
};

const dataDir = mkdtempSync(path.join(tmpdir(), "screensync-e2e-approval-timeout-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: dataDir } as Record<string, string>,
  stderr: "ignore",
});
const client = new Client({ name: "approval-timeout-e2e", version: "1.0.0" });
const callTool = async (name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
  const text = String((res.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}");
  return { isError: res.isError === true, body: JSON.parse(text) as { success?: boolean; error?: string; code?: string } };
};

let ext: { close: () => void } | null = null;
try {
  await client.connect(transport);
  await healthy();

  // 1. Nobody answers the approval: the caller hears APPROVAL_TIMEOUT from the extension, after the old abort point.
  ext = await fakeExtension(asksAPerson(7_000, {
    ok: false, code: "APPROVAL_TIMEOUT", retryable: true,
    error: "No answer to the approval request for web_eval on https://gated.example within 7s, so it was declined by default. Ask the user to approve it, then try again.",
  }));
  const startedAt = Date.now();
  const timedOut = await callTool("web_eval", GATED);
  const took = Date.now() - startedAt;
  assert.equal(timedOut.isError, true);
  assert.doesNotMatch(String(timedOut.body.error), /not reachable/i, `a hub that is up must not be reported as down: ${timedOut.body.error}`);
  assert.equal(timedOut.body.code, "APPROVAL_TIMEOUT", `the extension's own outcome reaches the caller: ${JSON.stringify(timedOut.body)}`);
  assert.match(String(timedOut.body.error), /No answer to the approval request/);
  assert.ok(took >= 6_500, `the caller waited for the person's (non-)answer, not the old ${1000 + 5000}ms transport abort (took ${took}ms)`);
  ext.close();

  // 2. The person says no: USER_DECLINED, with its code.
  ext = await fakeExtension(asksAPerson(500, {
    ok: false, code: "USER_DECLINED", retryable: false,
    error: "The user declined the approval request for web_eval on https://gated.example. Do not retry it; ask the user what they want instead.",
  }));
  const declined = await callTool("web_eval", GATED);
  assert.equal(declined.isError, true);
  assert.equal(declined.body.code, "USER_DECLINED", JSON.stringify(declined.body));
  assert.match(String(declined.body.error), /declined/);

  console.log("[approval_timeout.e2e] PASS: a gated call's timeout or decline reaches the caller with its code, never as 'hub is not reachable'");
} finally {
  ext?.close();
  await client.close().catch(() => undefined);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp dir */ }
}
