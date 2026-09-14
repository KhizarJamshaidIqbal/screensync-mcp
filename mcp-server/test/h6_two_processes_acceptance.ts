import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function runH6Acceptance() {
  console.log("[acceptance-h6] Starting H6 dual-process schedule deduplication test...");

  const testDir = mkdtempSync(path.join(tmpdir(), "screensync-h6-two-proc-"));
  const flowsDir = path.join(testDir, "flows");
  const schedDir = path.join(testDir, "schedules");
  mkdirSync(flowsDir, { recursive: true });
  mkdirSync(schedDir, { recursive: true });

  // Create test flow
  const testFlow = {
    name: "test_h6_flow",
    savedAt: new Date().toISOString(),
    stepCount: 1,
    steps: [{ tool: "web_title", args: {} }],
  };
  writeFileSync(path.join(flowsDir, "test_h6_flow.json"), JSON.stringify(testFlow, null, 2));

  // Create test schedule (every 0.05 min = 3s interval)
  const testSchedule = {
    id: "sched_h6",
    flow: "test_h6_flow",
    everyMinutes: 0.05,
    stopOnError: true,
  };
  writeFileSync(path.join(schedDir, "sched_h6.json"), JSON.stringify(testSchedule, null, 2));

  const PORT = "3399";
  const TOKEN = "h6-acceptance-token";
  const BASE = `http://127.0.0.1:${PORT}`;
  const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

  let proc1Runs = 0;
  let proc2Runs = 0;

  console.log("[acceptance-h6] Spawning Process 1 (listening hub on port 3399)...");
  const proc1 = spawn(
    process.execPath,
    ["dist/index.js"],
    {
      env: {
        ...process.env,
        SCREEN_SYNC_PORT: PORT,
        SCREEN_SYNC_TOKEN: TOKEN,
        SCREEN_SYNC_DATA_DIR: testDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  proc1.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("Scheduled flow run")) {
      proc1Runs++;
      console.log(`[acceptance-h6] Process 1 executed scheduled flow (run count: ${proc1Runs})`);
    }
  });

  // Wait for Process 1 to become healthy on port 3399
  const deadline = Date.now() + 8000;
  let p1Up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) { p1Up = true; break; }
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(p1Up, "Process 1 must become healthy on port 3399");
  console.log("[acceptance-h6] Process 1 is healthy and running HTTP hub.");

  // Connect simulated browser to Process 1 so flow steps can be answered in milliseconds
  await fetch(`${BASE}/api/web/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      browserId: "proc1-browser",
      browserName: "chrome",
      webAccessEnabled: true,
      userAgent: "TestBrowser/1.0",
      tab: { url: "https://test.local/", title: "Test Title" },
    }),
  });

  const sse = await fetch(`${BASE}/api/events`, { headers: { Authorization: `Bearer ${TOKEN}` } });
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
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "web_request" && ev.id) {
            await fetch(`${BASE}/api/web/result`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                id: ev.id,
                ok: true,
                data: { title: "Test Title" },
                browserId: "proc1-browser",
                browserName: "chrome",
              }),
            });
          }
        } catch { /* ignore */ }
      }
    }
  })().catch(() => {});

  console.log("[acceptance-h6] Spawning Process 2 on the same port 3399 (should enter MCP-only mode)...");
  let proc2BusyLogged = false;
  const proc2 = spawn(
    process.execPath,
    ["dist/index.js"],
    {
      env: {
        ...process.env,
        SCREEN_SYNC_PORT: PORT,
        SCREEN_SYNC_TOKEN: TOKEN,
        SCREEN_SYNC_DATA_DIR: testDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  proc2.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("HTTP port busy — continuing in MCP-only mode")) {
      proc2BusyLogged = true;
      console.log("[acceptance-h6] Process 2 detected port in use: entered MCP-only mode.");
    }
    if (text.includes("Scheduled flow run")) {
      proc2Runs++;
      console.error(`[acceptance-h6] ERROR: Process 2 unexpectedly ran scheduled flow (count: ${proc2Runs})!`);
    }
  });

  // Observe execution for 7.5 seconds (schedules fire every 3s)
  console.log("[acceptance-h6] Observing both processes for 7.5 seconds...");
  await new Promise((r) => setTimeout(r, 7500));

  console.log(`[acceptance-h6] Observation summary: Process 1 runs = ${proc1Runs}, Process 2 runs = ${proc2Runs}`);

  // Terminate both processes
  proc1.kill("SIGTERM");
  proc2.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));

  // Clean temp directory
  rmSync(testDir, { recursive: true, force: true });

  // Verification assertions
  assert.ok(proc1Runs >= 1, "Process 1 (listening) must run scheduled flows at least once");
  assert.equal(proc2Runs, 0, "Process 2 (EADDRINUSE / MCP-only) must run ZERO scheduled flows");
  assert.ok(proc2BusyLogged, "Process 2 must log HTTP port busy message");

  console.log("[acceptance-h6] H6 ACCEPTANCE PASSED: Exactly one hub process ran scheduled flows, second process ran 0!");
}

runH6Acceptance().catch((err) => {
  console.error("[acceptance-h6] FAILED:", err);
  process.exit(1);
});
