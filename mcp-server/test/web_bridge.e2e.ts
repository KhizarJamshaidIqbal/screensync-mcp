/**
 * Web-bridge E2E: simulates the ScreenSync browser extension (SSE subscriber +
 * result poster) and drives the FULL round trip  MCP stdio client → hub →
 * SSE web_request → extension → POST /api/web/result → MCP result.
 *
 * Covers: new agent-parity tools (web_expect / web_aria_snapshot /
 * web_run_code / ...), catalog integrity (no duplicate names), multi-browser
 * registration + targeting (args.__browser), and get_mcp_catalog / get_skills.
 *
 * Prereq: `npm run build` (spawns dist/index.js).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = 3003;
const TOKEN = "e2e-bridge-token";
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-e2e-bridge-"));
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

// ── Boot the hub+MCP server in a child process ────────────────────────────
const serverProcess = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: DATA_DIR },
  stdio: ["pipe", "pipe", "pipe"],
});

async function waitForHealth(timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Hub did not become healthy in time");
}

// ── Simulated extension: answers every web_request with a canned result ───
function cannedResult(tool: string): { ok: boolean; data?: unknown } {
  switch (tool) {
    case "web_expect":
      return { ok: true, data: { condition: "visible", passed: true, actual: "visible", waitedMs: 3, attempts: 1 } };
    case "web_aria_snapshot":
      return { ok: true, data: { url: "https://example.test/", title: "T", yaml: '- heading "Test"', nodeCount: 1 } };
    case "web_run_code":
      return { ok: true, data: { result: 42 } };
    case "web_get_by":
      return { ok: true, data: { by: "role", value: "button", count: 2, matches: [{ ref: 0 }, { ref: 1 }], selected: { ref: 0 } } };
    case "web_har_record":
      return { ok: true, data: { entryCount: 5, elapsedMs: 120, har: { log: { version: "1.2", creator: { name: "e2e" }, entries: [] } } } };
    case "web_clock_set":
      return { ok: true, data: { clockShifted: true, offsetMs: 60000, pageNowIso: "2099-01-01T00:01:00.000Z" } };
    case "web_trace_record":
      return { ok: true, data: { eventCount: 1234, durationMs: 900, trace: { traceEvents: [{ name: "e2e-event" }] } } };
    case "web_in_frame":
      return { ok: true, data: { frameId: 55, inner: "clicked-in-frame" } };
    case "web_network_auth":
      return { ok: true, data: { authHandling: true } };
    case "web_session_export":
      return { ok: true, data: { domain: "example.test", cookieCount: 3, cookies: [{ name: "sess", value: "v", domain: ".example.test", path: "/", secure: true }], localStorage: { k: "v" } } };
    case "web_session_import":
      return { ok: true, data: { cookiesSet: 3, localStorageKeys: 1 } };
    case "web_profile_sync":
      return { ok: true, data: { customDomain: { domain: "example.test", cookieCount: 4, cookies: [{ name: "sessionid" }] } } };
    case "web_tabs":
      return { ok: true, data: { tabs: [{ tabId: 1, url: "https://a.test/page", title: "A", active: true }, { tabId: 2, url: "https://b.test/page", title: "B", active: false }] } };
    case "web_wait_download":
      return { ok: true, data: { state: "complete", filename: "e2e-file.zip", fileSize: 1234, mime: "application/zip", finalUrl: "https://example.test/file.zip" } };
    default:
      return { ok: true, data: { echo: tool, via: "simulated-extension" } };
  }
}

async function startFakeExtension(browserId: string, browserName: string, userAgent: string): Promise<void> {
  // 1. Heartbeat registration with a stable browser identity.
  const reg = await fetch(`${BASE}/api/web/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      browserId,
      browserName,
      webAccessEnabled: true,
      userAgent,
      tab: { url: "https://example.test/", title: "Example" },
    }),
  });
  assert.equal(reg.status, 200, "extension registration must succeed");

  // 2. SSE subscription → answer web_request events (each browser answers every
  // request; the targeted one wins, the others 404 harmlessly — first-poster-wins).
  const sse = await fetch(`${BASE}/api/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(sse.status, 200, "SSE subscription must be authorized");
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
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6)) as { type?: string; id?: string; tool?: string; args?: { __browser?: string } };
          if (ev.type === "web_request" && ev.id && ev.tool) {
            // respect targeting: stay silent if the request is for another browser
            const hint = (ev.args?.__browser || "").toLowerCase();
            if (hint && hint !== "any" && hint !== "default" && hint !== browserName && hint !== browserId) continue;
            const result = cannedResult(ev.tool);
            await fetch(`${BASE}/api/web/result`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({ id: ev.id, ok: result.ok, data: result.data }),
            });
          }
        } catch { /* malformed chunk — ignore */ }
      }
    }
  })().catch(() => { /* stream closed at shutdown */ });
}

let failed = false;
try {
  await waitForHealth();
  await startFakeExtension("test-chrome-1", "chrome", "TestChrome/1.0");
  await startFakeExtension("test-edge-1", "edge", "TestEdge/1.0");

  // ── MCP client over stdio ────────────────────────────────────────────────
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, SCREEN_SYNC_PORT: String(PORT), SCREEN_SYNC_TOKEN: TOKEN, SCREEN_SYNC_DATA_DIR: DATA_DIR },
  });
  const client = new Client({ name: "bridge-e2e", version: "1.0.0" });
  await client.connect(transport);

  // 1. Catalog integrity: all agent-parity tools listed, zero duplicate names.
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  const expectedNew = [
    "web_expect", "web_aria_snapshot", "web_table_extract", "web_get_by", "web_fill",
    "web_check", "web_focus", "web_scroll_to", "web_run_code", "web_media_extract",
    "web_device_emulate", "web_resize", "web_set_user_agent",
    "web_har_record", "web_video_record", "web_clock_set", "web_clock_clear",
    "web_events", "web_trace_record",
    "web_fanout", "web_session_transfer", "web_route_for", "web_in_frame",
    "web_network_auth", "web_session_export", "web_session_import",
    "web_clock_fast_forward", "web_wait_download", "web_tab_fanout",
    "web_record", "web_replay",
  ];
  for (const t of expectedNew) assert.ok(names.includes(t), `tools/list must include ${t}`);
  assert.equal(new Set(names).size, names.length, "tools/list must not contain duplicate names");
  assert.ok(names.length >= 151, `expected >=151 tools, got ${names.length}`);
  assert.ok(names.includes("get_latest_screenshot"), "phone tools must still be listed (parity)");

  // 2. get_mcp_catalog + get_skills still work with the grown catalog.
  const catalog = await client.callTool({ name: "get_mcp_catalog", arguments: {} });
  assert.ok(!catalog.isError, `get_mcp_catalog failed: ${JSON.stringify((catalog.content as Array<{ text?: string }> | undefined)?.[0])?.slice(0, 400)}`);
  const skills = await client.callTool({ name: "get_skills", arguments: {} });
  assert.ok(!skills.isError, "get_skills must succeed");

  // 3. Hub status reflects the registered browser.
  const statusRes = await (await fetch(`${BASE}/api/web/status`, { headers: authHeaders })).json() as {
    status: { online: boolean; browserCount: number; browsers: Array<{ id: string; name: string; online: boolean; webAccessEnabled: boolean }> };
  };
  assert.equal(statusRes.status.online, true);
  assert.equal(statusRes.status.browserCount, 2, "both simulated browsers registered");
  assert.ok(statusRes.status.browsers.some((b) => b.name === "chrome"), "chrome must be registered");
  assert.ok(statusRes.status.browsers.every((b) => b.online && b.webAccessEnabled), "all browsers online with web access");

  // 4. FULL ROUND TRIP: MCP → hub → SSE → simulated extension → result → MCP.
  const expectRes = await client.callTool({ name: "web_expect", arguments: { condition: "visible", selector: "h1" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!expectRes.isError, "web_expect round trip must succeed");
  // mcp.ts flattens web-tool data payloads into the top level of the text result.
  const expectData = JSON.parse(expectRes.content[0].text) as { success: boolean; passed: boolean; condition: string };
  assert.equal(expectData.success, true);
  assert.equal(expectData.condition, "visible");
  assert.equal(expectData.passed, true);

  const codeRes = await client.callTool({ name: "web_run_code", arguments: { code: "return 40 + 2" } }) as {
    content: Array<{ text: string }>;
  };
  const codeData = JSON.parse(codeRes.content[0].text) as { result: number };
  assert.equal(codeData.result, 42, "web_run_code must return the simulated page result");

  const getByRes = await client.callTool({ name: "web_get_by", arguments: { by: "role", value: "button" } }) as {
    content: Array<{ text: string }>;
  };
  const getByData = JSON.parse(getByRes.content[0].text) as { by: string; count: number };
  assert.equal(getByData.by, "role");
  assert.equal(getByData.count, 2);

  // 4b. Round-2 tools: HAR recorder + fake clock round trips.
  const harRes = await client.callTool({ name: "web_har_record", arguments: { action: "stop" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!harRes.isError, "web_har_record round trip must succeed");
  const harData = JSON.parse(harRes.content[0].text) as { entryCount: number; har: { log: { version: string } } };
  assert.equal(harData.entryCount, 5);
  assert.equal(harData.har.log.version, "1.2");

  const clockRes = await client.callTool({ name: "web_clock_set", arguments: { offsetMs: 60000 } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!clockRes.isError, "web_clock_set round trip must succeed");
  const clockData = JSON.parse(clockRes.content[0].text) as { clockShifted: boolean; offsetMs: number };
  assert.equal(clockData.clockShifted, true);
  assert.equal(clockData.offsetMs, 60000);

  // 4c. Tracing round trip: real trace JSON assembled on stop.
  const traceRes = await client.callTool({ name: "web_trace_record", arguments: { action: "stop" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!traceRes.isError, "web_trace_record round trip must succeed");
  const traceData = JSON.parse(traceRes.content[0].text) as { eventCount: number; trace: { traceEvents: unknown[] } };
  assert.equal(traceData.eventCount, 1234);
  assert.ok(Array.isArray(traceData.trace.traceEvents), "trace must contain traceEvents");

  // 5. Multi-browser targeting: wrong hint must be rejected pre-broadcast.
  const wrong = await client.callTool({ name: "web_expect", arguments: { condition: "visible", __browser: "firefox" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.equal(wrong.isError, true, "call targeted at a non-connected browser must fail");
  assert.ok(wrong.content[0].text.includes("No connected browser matches 'firefox'"), "error must list the targeting failure");

  // 6. Correct hint routes through.
  const right = await client.callTool({ name: "web_expect", arguments: { condition: "visible", selector: "h1", __browser: "chrome" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!right.isError, "call targeted at the connected browser must succeed");

  // 7. web_status over MCP reports the browser list — now TWO browsers.
  const ws = await client.callTool({ name: "web_status", arguments: {} }) as { content: Array<{ text: string }> };
  const wsData = JSON.parse(ws.content[0].text) as { online: boolean; browserCount: number; browsers: Array<{ id: string; name: string }> };
  assert.equal(wsData.online, true);
  assert.equal(wsData.browserCount, 2, "both simulated browsers must be registered");
  const chromeEntry = wsData.browsers.find((b) => b.name === "chrome");
  const edgeEntry = wsData.browsers.find((b) => b.name === "edge");
  assert.ok(chromeEntry && edgeEntry, "chrome and edge entries must exist");

  // 7b. Round-5 multi-browser orchestration ──
  // web_fanout across ALL browsers → one merged result per browser.
  const fanout = await client.callTool({ name: "web_fanout", arguments: { tool: "web_aria_snapshot" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!fanout.isError, "web_fanout must succeed");
  const fanoutData = JSON.parse(fanout.content[0].text) as { matched: number; results: Array<{ browser: string; ok: boolean }> };
  assert.equal(fanoutData.matched, 2, "fanout must reach both browsers");
  assert.ok(fanoutData.results.every((r) => r.ok), "both fanout copies must succeed");

  // web_fanout with a subset hint → only edge executes.
  const fanoutEdge = await client.callTool({ name: "web_fanout", arguments: { tool: "web_aria_snapshot", browsers: ["edge"] } }) as {
    content: Array<{ text: string }>;
  };
  const fanoutEdgeData = JSON.parse(fanoutEdge.content[0].text) as { matched: number; results: Array<{ browser: string }> };
  assert.equal(fanoutEdgeData.matched, 1, "subset fanout must match only edge");
  assert.equal(fanoutEdgeData.results[0].browser, "edge");

  // web_session_transfer: chrome → edge session sync (simulated payloads).
  const transfer = await client.callTool({ name: "web_session_transfer", arguments: { domain: "example.test", from: chromeEntry.id, to: edgeEntry.id } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!transfer.isError, "web_session_transfer must succeed");
  const transferData = JSON.parse(transfer.content[0].text) as { from: string; to: string; cookieCount: number; import: { cookiesSet: number } };
  assert.equal(transferData.from, "chrome");
  assert.equal(transferData.to, "edge");
  assert.equal(transferData.cookieCount, 3, "export must report 3 cookies");
  assert.equal(transferData.import.cookiesSet, 3, "import must set 3 cookies");

  // web_route_for: both browsers probe the domain → recommendation returned.
  const routeFor = await client.callTool({ name: "web_route_for", arguments: { domain: "example.test" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!routeFor.isError, "web_route_for must succeed");
  const routeData = JSON.parse(routeFor.content[0].text) as { domain: string; recommended: { browser: string; cookieCount: number }; browsers: unknown[] };
  assert.equal(routeData.domain, "example.test");
  assert.equal(routeData.browsers.length, 2, "route_for must probe both browsers");
  assert.ok(routeData.recommended && routeData.recommended.cookieCount === 4, "route_for must recommend a browser with auth cookies");

  // web_in_frame + web_network_auth round trips (extension canned results).
  const inFrame = await client.callTool({ name: "web_in_frame", arguments: { tool: "web_click", args: { selector: "#go" }, frameId: 55 } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!inFrame.isError, "web_in_frame round trip must succeed");
  const inFrameData = JSON.parse(inFrame.content[0].text) as { frameId: number; inner: string };
  assert.equal(inFrameData.frameId, 55);
  assert.equal(inFrameData.inner, "clicked-in-frame");
  const auth = await client.callTool({ name: "web_network_auth", arguments: { username: "u", password: "p" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!auth.isError, "web_network_auth round trip must succeed");

  // Targeted single-browser call still routes correctly with both connected.
  const targetedEdge = await client.callTool({ name: "web_expect", arguments: { condition: "visible", __browser: edgeEntry.id } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!targetedEdge.isError, "id-targeted call must reach exactly the right browser");

  // 7d. Round-6: teach-once-replay (hub-side recorder) ──
  await client.callTool({ name: "web_record", arguments: { action: "start" } });
  await client.callTool({ name: "web_run_code", arguments: { code: "return 'step-1'" } });
  await client.callTool({ name: "web_aria_snapshot", arguments: {} });
  const recStop = await client.callTool({ name: "web_record", arguments: { action: "stop" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!recStop.isError, "web_record stop must succeed");
  const recData = JSON.parse(recStop.content[0].text) as { stepCount: number; steps: Array<{ tool: string; args: Record<string, unknown> }> };
  assert.equal(recData.stepCount, 2, "recorder must capture exactly the 2 recorded tool calls");
  assert.equal(recData.steps[0].tool, "web_run_code");
  assert.equal(recData.steps[1].tool, "web_aria_snapshot");
  const replayRun = await client.callTool({ name: "web_replay", arguments: { steps: recData.steps } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!replayRun.isError, "web_replay must succeed");
  const replayData = JSON.parse(replayRun.content[0].text) as { total: number; executed: number; okAll: boolean; results: Array<{ ok: boolean }> };
  assert.equal(replayData.total, 2);
  assert.equal(replayData.executed, 2);
  assert.equal(replayData.okAll, true, "all replay steps must succeed");

  // 7e. Round-6: multi-TAB fanout ──
  const tabFan = await client.callTool({ name: "web_tab_fanout", arguments: { tool: "web_run_code", args: { code: "return document.title" } } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!tabFan.isError, "web_tab_fanout must succeed");
  const tabFanData = JSON.parse(tabFan.content[0].text) as { matched: number; results: Array<{ tabId: number; ok: boolean }> };
  assert.equal(tabFanData.matched, 2, "tab_fanout must reach both tabs");
  assert.ok(tabFanData.results.every((r) => r.ok), "both tab copies must succeed");

  // 7f. Round-6: wait_download round trip.
  const wd = await client.callTool({ name: "web_wait_download", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!wd.isError, "web_wait_download round trip must succeed");
  const wdData = JSON.parse(wd.content[0].text) as { state: string; fileSize: number };
  assert.equal(wdData.state, "complete");
  assert.equal(wdData.fileSize, 1234);

  // 8. Real-time SSE observability: ambient browser events land in the ring.
  for (const url of ["https://a.test/page-1", "https://b.test/page-2"]) {
    const push = await fetch(`${BASE}/api/web/event`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "web_navigation", source: "browser", data: { tabId: 1, url } }),
    });
    assert.equal(push.status, 200, "ambient event push must be accepted");
  }
  const eventsRes = await client.callTool({ name: "web_events", arguments: { types: "web_navigation", limit: 10 } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!eventsRes.isError, "web_events must succeed");
  const eventsData = JSON.parse(eventsRes.content[0].text) as {
    lastSeq: number; count: number; events: Array<{ seq: number; type: string; data?: { url?: string } }>;
  };
  assert.equal(eventsData.count, 2, "both ambient navigations must be buffered");
  assert.equal(eventsData.events[0].type, "web_navigation");
  assert.equal(eventsData.events[0].data?.url, "https://a.test/page-1");
  assert.ok(eventsData.lastSeq >= eventsData.events[1].seq, "lastSeq must advance with the ring");

  // 9. Cursor semantics: since=<lastSeq> yields nothing new.
  const cursorRes = await client.callTool({ name: "web_events", arguments: { since: eventsData.lastSeq } }) as {
    content: Array<{ text: string }>;
  };
  const cursorData = JSON.parse(cursorRes.content[0].text) as { count: number };
  assert.equal(cursorData.count, 0, "cursor at lastSeq must return no events");

  // 10. HTTP tail + types filter.
  const recent = await (await fetch(`${BASE}/api/events/recent?types=web_navigation&limit=50`, { headers: authHeaders })).json() as {
    success: boolean; lastSeq: number; events: Array<{ payload: { type: string } }>;
  };
  assert.equal(recent.success, true);
  assert.ok(recent.events.length >= 2);
  assert.ok(recent.events.every((e) => e.payload.type === "web_navigation"), "types filter must only return matching events");

  // 11. SSE Last-Event-ID replay: reconnecting after the first navigation
  // replays the second one before the welcome event.
  const replay = await fetch(`${BASE}/api/events`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Last-Event-ID": String(eventsData.lastSeq - 1) },
  });
  assert.equal(replay.status, 200);
  const reader2 = (replay.body as ReadableStream<Uint8Array>).getReader();
  const decoder2 = new TextDecoder();
  let replayBuf = "";
  const replayDeadline = Date.now() + 4000;
  while (Date.now() < replayDeadline && !replayBuf.includes("b.test/page-2")) {
    const { done, value } = await reader2.read();
    if (done) break;
    replayBuf += decoder2.decode(value, { stream: true });
  }
  try { await reader2.cancel(); } catch { /* stream already closing */ }
  assert.ok(replayBuf.includes("b.test/page-2"), `SSE replay must deliver missed events, got: ${replayBuf.slice(0, 200)}`);
  assert.ok(replayBuf.includes("id: "), "SSE frames must carry id: lines");

  await client.close();
  console.log("web-bridge e2e: ALL ASSERTIONS PASSED");
} catch (err) {
  failed = true;
  console.error("web-bridge e2e FAILED:", err);
} finally {
  serverProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  try { rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.exit(failed ? 1 : 0);
