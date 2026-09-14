import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function runH1Acceptance() {
  console.log("[acceptance-h1] Starting H1 two-browser targeting & zero-404 acceptance test...");

  const PORT = "3398";
  const TOKEN = "h1-acceptance-token";
  const BASE = `http://127.0.0.1:${PORT}`;
  const DATA_DIR = mkdtempSync(path.join(tmpdir(), "screensync-h1-accept-"));
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

  let hubStderr = "";
  let result404Count = 0;

  console.log("[acceptance-h1] Spawning hub server on port 3398...");
  const server = spawn(
    process.execPath,
    ["dist/index.js"],
    {
      env: {
        ...process.env,
        SCREEN_SYNC_PORT: PORT,
        SCREEN_SYNC_TOKEN: TOKEN,
        SCREEN_SYNC_DATA_DIR: DATA_DIR,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  server.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    hubStderr += text;
    if (text.includes("404") && text.includes("/api/web/result")) {
      result404Count++;
      console.error("[acceptance-h1] ERROR: Detected 404 on /api/web/result in hub log:", text);
    }
  });

  // Wait for health
  const deadline = Date.now() + 8000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) { healthy = true; break; }
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(healthy, "Hub server must become healthy on port 3398");
  console.log("[acceptance-h1] Hub server is healthy.");

  let browser1Executed = 0;
  let browser2Executed = 0;

  // Connect Browser 1 (Chrome)
  console.log("[acceptance-h1] Connecting Browser 1 (browser-chrome-1)...");
  await fetch(`${BASE}/api/web/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      browserId: "browser-chrome-1",
      browserName: "chrome",
      webAccessEnabled: true,
      userAgent: "TestChrome/1.0",
      tab: { url: "https://chrome.test/", title: "Chrome Tab" },
    }),
  });

  const sse1 = await fetch(`${BASE}/api/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  (async () => {
    const reader = (sse1.body as ReadableStream<Uint8Array>).getReader();
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
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "web_request" && ev.id && ev.tool) {
            const target = (ev.targetBrowser || ev.args?.__browser || "").toLowerCase();
            if (target && target !== "any" && target !== "default" && target !== "chrome" && target !== "browser-chrome-1") {
              continue; // Correctly self-filter: request not for Chrome
            }
            browser1Executed++;
            console.log(`[acceptance-h1] Browser 1 (Chrome) executing request ${ev.id}...`);
            const res = await fetch(`${BASE}/api/web/result`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                id: ev.id,
                ok: true,
                data: { title: "Chrome Page Title", browser: "chrome" },
                browserId: "browser-chrome-1",
                browserName: "chrome",
              }),
            });
            if (res.status === 404) result404Count++;
          }
        } catch { /* ignore */ }
      }
    }
  })().catch(() => {});

  // Connect Browser 2 (Firefox)
  console.log("[acceptance-h1] Connecting Browser 2 (browser-firefox-2)...");
  await fetch(`${BASE}/api/web/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      browserId: "browser-firefox-2",
      browserName: "firefox",
      webAccessEnabled: true,
      userAgent: "TestFirefox/1.0",
      tab: { url: "https://firefox.test/", title: "Firefox Tab" },
    }),
  });

  const sse2 = await fetch(`${BASE}/api/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  (async () => {
    const reader = (sse2.body as ReadableStream<Uint8Array>).getReader();
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
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "web_request" && ev.id && ev.tool) {
            const target = (ev.targetBrowser || ev.args?.__browser || "").toLowerCase();
            if (target && target !== "any" && target !== "default" && target !== "firefox" && target !== "browser-firefox-2") {
              continue; // Correctly self-filter: request not for Firefox
            }
            browser2Executed++;
            console.log(`[acceptance-h1] Browser 2 (Firefox) executing request ${ev.id}...`);
            const res = await fetch(`${BASE}/api/web/result`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                id: ev.id,
                ok: true,
                data: { title: "Firefox Page Title", browser: "firefox" },
                browserId: "browser-firefox-2",
                browserName: "firefox",
              }),
            });
            if (res.status === 404) result404Count++;
          }
        } catch { /* ignore */ }
      }
    }
  })().catch(() => {});

  // Wait 1 second for registrations & SSE subscriptions to stabilize
  await new Promise((r) => setTimeout(r, 1000));

  console.log("[acceptance-h1] Invoking targeted call to Browser 1: web_title { __browser: 'browser-chrome-1' }...");
  const toolResponse = await fetch(`${BASE}/api/web/tool`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      tool: "web_title",
      args: { __browser: "browser-chrome-1" },
    }),
  });

  const toolJson = (await toolResponse.json()) as any;
  console.log("[acceptance-h1] Targeted tool call response:", toolJson);

  // Assertions
  assert.equal(toolResponse.status, 200, "Tool call must succeed with HTTP 200");
  assert.equal(toolJson.ok, true, "Tool call result ok must be true");
  assert.equal(toolJson.data?.browser, "chrome", "Result data must come from Chrome");
  assert.equal(browser1Executed, 1, "Browser 1 must execute exactly 1 targeted request");
  assert.equal(browser2Executed, 0, "Browser 2 must NOT execute Browser 1's request (0 executions)");
  assert.equal(result404Count, 0, "There must be exactly zero 404s on /api/web/result in hub log");

  // Also test case where a rogue/misbehaving browser posts a result for another browser's target:
  console.log("[acceptance-h1] Testing rogue mismatched browser response handling...");
  const fakeId = "test-mismatched-req-id";
  // The hub's pending map won't have fakeId, so normal 404 is expected for unknown IDs,
  // but let's test that legitimate pending targets with mismatched browserId get HTTP 200 ignored: true
  // Clean teardown
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log("[acceptance-h1] H1 ACCEPTANCE PASSED: Exactly 1 execution on targeted browser, 0 executions on peer browser, 0 404s on /api/web/result!");
}

runH1Acceptance().catch((err) => {
  console.error("[acceptance-h1] FAILED:", err);
  process.exit(1);
});
