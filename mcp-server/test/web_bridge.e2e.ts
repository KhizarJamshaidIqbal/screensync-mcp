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
function cannedResult(tool: string, args: Record<string, unknown> = {}): { ok: boolean; data?: unknown } {
  switch (tool) {
    case "web_expect":
      return { ok: true, data: { condition: "visible", passed: true, actual: "visible", waitedMs: 3, attempts: 1 } };
    case "web_aria_snapshot":
      return { ok: true, data: { url: "https://example.test/", title: "T", yaml: '- heading "Test"', nodeCount: 1 } };
    case "web_run_code":
      return { ok: true, data: { result: typeof args.code === "string" ? args.code : 42 } };
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
    case "web_profile_sync":
      return { ok: true, data: { customDomain: { domain: "example.test", cookieCount: 4, cookies: [{ name: "sessionid" }] } } };
    case "web_tabs":
      return { ok: true, data: { tabs: [{ tabId: 1, url: "https://a.test/page", title: "A", active: true }, { tabId: 2, url: "https://b.test/page", title: "B", active: false }] } };
    case "web_api_fetch":
      return { ok: true, data: { status: 200, json: { sessionId: "live-session" }, cookiesAttached: true, url: "https://example.test/api" } };
    case "web_history":
      return { ok: true, data: { count: 2, items: [{ url: "https://a.test/x" }, { url: "https://b.test/y" }] } };
    case "web_bookmarks":
      return { ok: true, data: { count: 1, items: [{ title: "Docs", url: "https://docs.test" }] } };
    case "web_social_matrix":
      return { ok: true, data: { platforms: [{ platform: "x", authenticated: true, user: "@e2e" }] } };
    case "web_screenshot":
      // 1x1 white PNG — enough for the hub-side web_visual_baseline handler to parse
      return { ok: true, data: { imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualzQAAAABJRU5ErkJggg==", url: "https://example.test/", title: "Example" } };
    case "web_pixel_diff":
      return { ok: true, data: { identical: true, diffPercent: 0, diffImageDataUrl: "" } };
    case "web_emulate_media":
      return { ok: true, data: { media: "print", features: [] } };
    case "web_mhtml":
      return { ok: true, data: { bytes: 5000, mhtml: "MIME-Version: 1.0" } };
    case "web_cache_control":
      return { ok: true, data: { cleared: true } };
    case "web_visual_baseline":
      return { ok: true, data: { compared: true, name: "e2e-page", passed: true, diffPercent: 0, identical: true } };
    case "web_wait_download":
      return { ok: true, data: { state: "complete", filename: "e2e-file.zip", fileSize: 1234, mime: "application/zip", finalUrl: "https://example.test/file.zip" } };
    case "web_content":
      return { ok: true, data: { url: "https://example.test/", title: "T", length: 120, html: "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>" } };
    case "web_bounding_box":
      return { ok: true, data: { x: 10, y: 20, width: 100, height: 40, inViewport: true, tagName: "h1" } };
    case "web_computed_style":
      return { ok: true, data: { tagName: "h1", styles: { display: "block", color: "rgb(0, 0, 0)" } } };
    case "web_reader_mode":
      return { ok: true, data: { title: "Article", wordCount: 150, readingTimeMinutes: 1, markdown: "# Article\n\nContent" } };
    case "web_tab_group":
      return { ok: true, data: { groupId: 101, title: args.title || "ScreenSync Harvest", color: args.color || "purple", tabIds: [1, 2] } };
    case "web_indexeddb":
      return { ok: true, data: { database: args.database || "e2e-db", version: 1, storeCount: 0, stores: [] } };
    case "web_cache_storage":
      return { ok: true, data: { origin: "https://example.test", count: 1, caches: ["v1"] } };
    case "web_add_script_tag":
      return { ok: true, data: { injected: true, type: "script", loaded: true } };
    case "web_add_style_tag":
      return { ok: true, data: { injected: true, type: "style", contentLength: 25 } };
    case "web_page_digest":
      return { ok: true, data: { url: "https://example.test/", title: "Example", headings: [{ level: 1, text: "Hello" }], landmarks: [{ role: "main", tag: "main" }], interactives: [{ ref: 0, role: "button", name: "Submit" }], forms: [], interactiveCount: 1, truncated: false } };
    case "web_actionable":
      return { ok: true, data: { actionable: true, checks: { attached: true, visible: true, stable: true, enabled: true, receivesEvents: true }, target: { tag: "button", role: "button" } } };
    case "web_audit_log":
      return { ok: true, data: { count: 1, entries: [{ tool: "web_click", ok: true, durationMs: 45 }] } };
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
            const result = cannedResult(ev.tool, ev.args ?? {});
            await fetch(`${BASE}/api/web/result`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({ id: ev.id, ok: result.ok, data: result.data, browserId, browserName }),
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
    "web_fanout", "web_route_for", "web_in_frame",
    "web_network_auth",
    "web_clock_fast_forward", "web_wait_download", "web_tab_fanout",
    "web_record", "web_replay",
    "web_api_fetch", "web_history", "web_bookmarks",
    "web_flow_save", "web_flow_list", "web_flow_run", "web_flow_delete", "web_account_report",
    "web_flow_schedule", "web_flow_schedules", "web_flow_unschedule",
    "web_emulate_media", "web_mhtml", "web_cache_control", "web_visual_baseline",
    "web_content", "web_bounding_box", "web_computed_style", "web_add_script_tag",
    "web_add_style_tag", "web_tab_group", "web_indexeddb", "web_cache_storage",
    "web_reader_mode", "web_page_digest", "web_actionable", "web_audit_log",
  ];
  for (const t of expectedNew) assert.ok(names.includes(t), `tools/list must include ${t}`);
  assert.equal(new Set(names).size, names.length, "tools/list must not contain duplicate names");
  assert.ok(names.length >= 140, `expected >=140 tools, got ${names.length}`);
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
  const codeData = JSON.parse(codeRes.content[0].text) as { result: string };
  // canned extension echoes the code arg — proves args reach the browser round trip
  assert.equal(codeData.result, "return 40 + 2", "web_run_code must carry args through the round trip");

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

  // 7g. Round-7: flows library + api_fetch + account_report ──
  const flowSave = await client.callTool({ name: "web_flow_save", arguments: { name: "e2e-flow", steps: [{ tool: "web_run_code", args: { code: "return '{{who}}'" } }, { tool: "web_aria_snapshot", args: {} }] } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!flowSave.isError, "web_flow_save must succeed");
  const flowList = await client.callTool({ name: "web_flow_list", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  const flowListData = JSON.parse(flowList.content[0].text) as { flows: Array<{ name: string; stepCount: number }> };
  assert.ok(flowListData.flows.some((f) => f.name === "e2e-flow" && f.stepCount === 2), "saved flow must be listed");
  const flowRun = await client.callTool({ name: "web_flow_run", arguments: { name: "e2e-flow", vars: { who: "operator" } } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!flowRun.isError, "web_flow_run must succeed");
  const flowRunData = JSON.parse(flowRun.content[0].text) as { okAll: boolean; executed: number; results: Array<{ data?: { result?: string } }> };
  assert.equal(flowRunData.okAll, true);
  assert.equal(flowRunData.executed, 2);
  assert.equal(flowRunData.results[0].data?.result, "return 'operator'", "{{var}} substitution must land in the executed args");
  const flowDel = await client.callTool({ name: "web_flow_delete", arguments: { name: "e2e-flow" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!flowDel.isError, "web_flow_delete must succeed");
  const api = await client.callTool({ name: "web_api_fetch", arguments: { url: "https://example.test/api" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!api.isError, "web_api_fetch round trip must succeed");
  const apiData = JSON.parse(api.content[0].text) as { status: number; cookiesAttached: boolean; json: { sessionId: string } };
  assert.equal(apiData.status, 200);
  assert.equal(apiData.cookiesAttached, true);
  assert.equal(apiData.json.sessionId, "live-session");
  const report = await client.callTool({ name: "web_account_report", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!report.isError, "web_account_report must succeed");
  const reportData = JSON.parse(report.content[0].text) as { browsersProbed: number; liveAccounts: number; accounts: unknown[] };
  assert.equal(reportData.browsersProbed, 2, "account_report must probe both browsers");
  assert.equal(reportData.liveAccounts, 2, "both simulated browsers report a live x account");
  const hist = await client.callTool({ name: "web_history", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!hist.isError, "web_history round trip must succeed");

  // 7h. Round-8: flow schedules — hub runs the flow automatically ──
  await client.callTool({ name: "web_flow_save", arguments: { name: "e2e-sched-flow", steps: [{ tool: "web_run_code", args: { code: "return 'tick'" } }] } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  const sched = await client.callTool({ name: "web_flow_schedule", arguments: { flow: "e2e-sched-flow", everyMinutes: 0.05 } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!sched.isError, "web_flow_schedule must succeed");
  const schedData = JSON.parse(sched.content[0].text) as { id: string; everyMinutes: number };
  assert.equal(schedData.everyMinutes, 0.05);
  // wait for at least one automatic run (interval 3s)
  await new Promise((r) => setTimeout(r, 8000));
  const schedList = await client.callTool({ name: "web_flow_schedules", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  const schedListData = JSON.parse(schedList.content[0].text) as { schedules: Array<{ id: string; lastRunOk: boolean; lastRunExecuted: number }> };
  const mine = schedListData.schedules.find((s) => s.id === schedData.id);
  assert.ok(mine, "scheduled flow must be listed");
  assert.equal(mine.lastRunOk, true, "the hub must have auto-run the flow (lastRunOk)");
  assert.equal(mine.lastRunExecuted, 1, "auto-run executed 1 step");
  const unsched = await client.callTool({ name: "web_flow_unschedule", arguments: { id: schedData.id } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!unsched.isError, "web_flow_unschedule must succeed");
  const mf = await client.callTool({ name: "web_api_fetch", arguments: { url: "https://example.test/upload", method: "POST", formData: { file: { filename: "e2e.png", base64: "aGVsbG8=", contentType: "image/png" }, note: "hi" } } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!mf.isError, "web_api_fetch multipart round trip must succeed");

  // 7i. Round-9: emulate_media / mhtml / cache / visual baseline round trips ──
  const em = await client.callTool({ name: "web_emulate_media", arguments: { media: "print" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!em.isError, "web_emulate_media round trip must succeed");
  const mh = await client.callTool({ name: "web_mhtml", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!mh.isError, "web_mhtml round trip must succeed");
  const cc = await client.callTool({ name: "web_cache_control", arguments: { action: "clear" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!cc.isError, "web_cache_control round trip must succeed");
  const vbSave = await client.callTool({ name: "web_visual_baseline", arguments: { action: "save", name: "e2e-page" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!vbSave.isError, "web_visual_baseline save must succeed");
  const vbList = await client.callTool({ name: "web_visual_baseline", arguments: { action: "list" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  const vbListData = JSON.parse(vbList.content[0].text) as { baselines: Array<{ name: string }> };
  assert.ok(vbListData.baselines.some((b) => b.name === "e2e-page"), "saved baseline must be listed");
  const vbCmp = await client.callTool({ name: "web_visual_baseline", arguments: { action: "compare", name: "e2e-page" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!vbCmp.isError, "web_visual_baseline compare must succeed");
  const vbCmpData = JSON.parse(vbCmp.content[0].text) as { compared: boolean; passed: boolean; diffPercent: number };
  assert.equal(vbCmpData.compared, true);
  assert.equal(vbCmpData.passed, true);
  assert.equal(vbCmpData.diffPercent, 0);

  // 7j. Round-9: flow step-output chaining ──
  // step1 extracts a value; step2's args reference {{step.1.data.result}}
  const chainSave = await client.callTool({ name: "web_flow_save", arguments: { name: "e2e-chain", steps: [
    { tool: "web_run_code", args: { code: "chain-proof-42" } },
    { tool: "web_run_code", args: { code: "echo:{{step.1.data.result}}" } },
  ] } }) as { isError?: boolean; content: Array<{ text: string }> };
  assert.ok(!chainSave.isError, "chain flow save must succeed");
  const chainRun = await client.callTool({ name: "web_flow_run", arguments: { name: "e2e-chain" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!chainRun.isError, "web_flow_run with chaining must succeed");
  const chainData = JSON.parse(chainRun.content[0].text) as { okAll: boolean; results: Array<{ data?: { result?: string } }> };
  assert.equal(chainData.okAll, true);
  assert.equal(chainData.results[1].data?.result, "echo:chain-proof-42", "{{step.1.data.result}} must resolve to step1's output");
  await client.callTool({ name: "web_flow_delete", arguments: { name: "e2e-chain" } });

  // 7k. Round-10: Playwright parity + Authenticated Harvester + Session Vault ──
  const contentRes = await client.callTool({ name: "web_content", arguments: { clean: true } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!contentRes.isError, "web_content round trip must succeed");
  const contentData = JSON.parse(contentRes.content[0].text) as { length: number; html: string };
  assert.equal(contentData.length, 120);

  const boxRes = await client.callTool({ name: "web_bounding_box", arguments: { selector: "h1" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!boxRes.isError, "web_bounding_box round trip must succeed");
  const boxData = JSON.parse(boxRes.content[0].text) as { width: number; height: number; inViewport: boolean };
  assert.equal(boxData.width, 100);
  assert.equal(boxData.height, 40);
  assert.equal(boxData.inViewport, true);

  const styleRes = await client.callTool({ name: "web_computed_style", arguments: { selector: "h1" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!styleRes.isError, "web_computed_style round trip must succeed");

  const readerRes = await client.callTool({ name: "web_reader_mode", arguments: {} }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!readerRes.isError, "web_reader_mode round trip must succeed");

  const tabGrpRes = await client.callTool({ name: "web_tab_group", arguments: { action: "create", title: "Harvest", color: "purple" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!tabGrpRes.isError, "web_tab_group round trip must succeed");
  const tabGrpData = JSON.parse(tabGrpRes.content[0].text) as { groupId: number };
  assert.equal(tabGrpData.groupId, 101);

  const idbRes = await client.callTool({ name: "web_indexeddb", arguments: { action: "schema", database: "e2e-db" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!idbRes.isError, "web_indexeddb round trip must succeed");
  const idbData = JSON.parse(idbRes.content[0].text) as { storeCount: number };
  assert.equal(idbData.storeCount, 0, "empty IDB database schema must succeed");

  const cacheRes = await client.callTool({ name: "web_cache_storage", arguments: { action: "list" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!cacheRes.isError, "web_cache_storage round trip must succeed");

  const scriptRes = await client.callTool({ name: "web_add_script_tag", arguments: { content: "window.__injected = true;" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!scriptRes.isError, "web_add_script_tag round trip must succeed");

  const styleResTag = await client.callTool({ name: "web_add_style_tag", arguments: { content: "body { margin: 0; }" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!styleResTag.isError, "web_add_style_tag round trip must succeed");

  const digestRes = await client.callTool({ name: "web_page_digest", arguments: { maxNodes: 50 } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!digestRes.isError, "web_page_digest round trip must succeed");
  const digestData = JSON.parse(digestRes.content[0].text) as { interactiveCount: number; headings: Array<unknown> };
  assert.equal(digestData.interactiveCount, 1);
  assert.equal(digestData.headings.length, 1);

  const actionableRes = await client.callTool({ name: "web_actionable", arguments: { selector: "button" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!actionableRes.isError, "web_actionable round trip must succeed");
  const actData = JSON.parse(actionableRes.content[0].text) as { actionable: boolean };
  assert.equal(actData.actionable, true);

  const auditRes = await client.callTool({ name: "web_audit_log", arguments: { action: "get" } }) as {
    isError?: boolean; content: Array<{ text: string }>;
  };
  assert.ok(!auditRes.isError, "web_audit_log round trip must succeed");
  const auditData = JSON.parse(auditRes.content[0].text) as { count: number };
  assert.equal(auditData.count, 1);

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
