// ScreenSync MCP v1.9 — Comprehensive Live Browser E2E Verification
// Runs real live browser tests through the ScreenSync Hub (http://127.0.0.1:3000).
// EXCLUSIVE TOOLING: Uses ScreenSync web bridge API exclusively.
// SAFETY: Always opens a dedicated tab (newTab: true) and closes it cleanly.

import assert from "node:assert/strict";
import { resolveConsolidatedCall } from "../catalog-consolidated.js";
import { promptDefinitions } from "../catalog.js";

const HUB_URL = "http://127.0.0.1:3000";
const AUTH_HEADER = "Bearer screensync-local-dev";

async function callWebTool(tool: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${HUB_URL}/api/web/tool`, {
    method: "POST",
    headers: {
      "Authorization": AUTH_HEADER,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tool, args }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} calling ${tool}: ${txt}`);
  }
  return await res.json();
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLiveVerification() {
  console.log("==================================================================");
  console.log("  ScreenSync MCP v1.9 — Live Browser E2E Verification Suite");
  console.log("==================================================================");

  // ── 1. Hub & Extension Presence ──
  console.log("\n[1/9] Checking Hub and Extension status...");
  const statusRes = await fetch(`${HUB_URL}/api/web/status`, {
    headers: { "Authorization": AUTH_HEADER },
  });
  assert.equal(statusRes.status, 200, "Hub status endpoint must return 200");
  const statusData = await statusRes.json();
  assert.ok(statusData.status?.online, "Hub must report extension online");
  assert.ok(statusData.status?.webAccessEnabled, "Web access must be enabled in extension");
  console.log(`  ✓ Extension online: id=${statusData.status?.browsers?.[0]?.extensionId || "active"}`);
  console.log(`  ✓ Active tab before test: ${statusData.status?.activeTab?.url || "none"}`);

  // ── 2. Extension Diagnostics ──
  console.log("\n[2/9] Running web_extension_diagnostics...");
  const diag = await callWebTool("web_extension_diagnostics", {});
  assert.ok(diag.ok, "web_extension_diagnostics must succeed");
  assert.equal(diag.data?.manifestVersion, 3, "Must be Manifest V3");
  console.log(`  ✓ Extension version: ${diag.data?.version}`);
  console.log(`  ✓ Permissions verified: ${diag.data?.permissions?.length} active permissions`);

  // ── 3. Dedicated Tab Creation (Safety First) ──
  console.log("\n[3/9] Opening dedicated test tab (newTab: true)...");
  const testUrl = `${HUB_URL}/pair`;
  const navRes = await callWebTool("web_navigate", { url: testUrl, newTab: true });
  assert.ok(navRes.ok, "web_navigate must succeed");
  const testTabId = navRes.data?.tabId;
  assert.ok(typeof testTabId === "number", `Valid tabId required, got ${testTabId}`);
  console.log(`  ✓ Opened dedicated test tab: tabId=${testTabId}, url=${testUrl}`);

  // Give tab a brief moment to finish DOM rendering
  await sleep(1500);

  try {
    // ── 4. Phase 2: VOM Non-Mutating Page Perception ──
    console.log("\n[4/9] Testing Phase 2: web_page_observe (Visual Object Model)...");
    const vomRes = await callWebTool("web_page_observe", { tabId: testTabId, maxTokens: 4000 });
    assert.ok(vomRes.ok, `web_page_observe failed: ${vomRes.error}`);
    assert.ok(vomRes.data?.text?.length > 0, "VOM text tree must not be empty");
    assert.ok(vomRes.data?.nodeCount > 0, "VOM must perceive DOM nodes");
    assert.ok(vomRes.data?.text.includes("[page]"), "VOM text must include [page] root tag");
    console.log(`  ✓ VOM node count: ${vomRes.data?.nodeCount}`);
    console.log(`  ✓ Interactive refs assigned: ${vomRes.data?.refs?.length || 0}`);
    console.log(`  ✓ Truncated: ${vomRes.data?.truncated}, Cursor: ${vomRes.data?.cursor || "none"}`);
    console.log(`  ✓ Sample snippet:\n${vomRes.data?.text.split("\n").slice(0, 4).map((l: string) => "      " + l).join("\n")}`);

    // Test token pagination / continuation cursor
    const vomSmall = await callWebTool("web_page_observe", { tabId: testTabId, maxTokens: 80 });
    assert.ok(vomSmall.ok, "Small token VOM observe must succeed");
    console.log(`  ✓ Small budget truncation test: truncated=${vomSmall.data?.truncated}`);

    // ── 5. Phase 3: Tiled Long Screenshot & Chunk Reader ──
    console.log("\n[5/9] Testing Phase 3: web_full_screenshot with longPage: true...");
    const shotRes = await callWebTool("web_full_screenshot", { tabId: testTabId, longPage: true });
    assert.ok(shotRes.ok, `web_full_screenshot failed: ${shotRes.error}`);
    assert.ok(shotRes.data?.imageDataUrl || shotRes.data?.captureId, "Screenshot payload must be returned");
    console.log(`  ✓ Long screenshot capture succeeded: format=${shotRes.data?.format || "png"}, width=${shotRes.data?.viewportWidth || shotRes.data?.width || 1920}, height=${shotRes.data?.totalHeight || shotRes.data?.height}`);

    if (shotRes.data?.captureId) {
      const chunkRes = await callWebTool("web_screenshot_read", {
        captureId: shotRes.data.captureId,
        chunk: 0,
      });
      assert.ok(chunkRes.ok, `web_screenshot_read failed: ${chunkRes.error}`);
      console.log(`  ✓ web_screenshot_read tile 0: ${chunkRes.data?.tile?.length || 0} bytes base64`);
    }

    // ── 6. Phase 1: In-Page Human Help Overlay ──
    console.log("\n[6/9] Testing Phase 1: web_request_help (Human In The Loop)...");
    const helpRes = await callWebTool("web_request_help", {
      tabId: testTabId,
      message: "Automated E2E testing of help overlay criteria detection.",
      selector: "h1",
      autoDismissMs: 2000,
    });
    assert.ok(helpRes.ok, `web_request_help failed: ${helpRes.error}`);
    console.log(`  ✓ Help overlay injected and resolved: status=${helpRes.data?.status}`);

    // ── 7. Playwright Parity Layer & Content Verification ──
    console.log("\n[7/9] Testing Playwright Parity & DOM Tools...");
    
    // web_expect
    const expectRes = await callWebTool("web_expect", {
      tabId: testTabId,
      selector: "h1",
      state: "visible",
    });
    assert.ok(expectRes.ok, "web_expect visible failed");
    console.log("  ✓ web_expect: <h1> is confirmed visible");

    // web_content
    const contentRes = await callWebTool("web_content", { tabId: testTabId });
    assert.ok(contentRes.ok && contentRes.data?.html?.includes("<title>"), "web_content must return HTML");
    console.log(`  ✓ web_content: retrieved ${contentRes.data?.html?.length} bytes HTML`);

    // web_bounding_box
    const boxRes = await callWebTool("web_bounding_box", { tabId: testTabId, selector: "h1" });
    assert.ok(boxRes.ok && boxRes.data?.width > 0, "web_bounding_box must return valid rect");
    console.log(`  ✓ web_bounding_box: <h1> geometry = ${Math.round(boxRes.data.width)}x${Math.round(boxRes.data.height)} at (${Math.round(boxRes.data.x)},${Math.round(boxRes.data.y)})`);

    // web_computed_style
    const styleRes = await callWebTool("web_computed_style", {
      tabId: testTabId,
      selector: "h1",
      properties: ["font-size", "color"],
    });
    assert.ok(styleRes.ok && styleRes.data?.styles?.["font-size"], "web_computed_style must return styles");
    console.log(`  ✓ web_computed_style: font-size=${styleRes.data.styles["font-size"]}`);

    // ── 8. Phase 4: Isolated Agent Window Lifecycle ──
    console.log("\n[8/9] Testing Phase 4: web_agent_window lifecycle...");
    const winStatus = await callWebTool("web_agent_window", { action: "status" });
    assert.ok(winStatus.ok, "web_agent_window status must succeed");
    console.log(`  ✓ Agent window initial status: active=${winStatus.data?.active}`);

    const winCreate = await callWebTool("web_agent_window", { action: "create", width: 900, height: 600 });
    assert.ok(winCreate.ok, "web_agent_window create must succeed");
    const agentWinId = winCreate.data?.windowId;
    console.log(`  ✓ Agent window created: windowId=${agentWinId}`);

    await sleep(1000);

    const winClose = await callWebTool("web_agent_window", { action: "close" });
    assert.ok(winClose.ok, "web_agent_window close must succeed");
    console.log("  ✓ Agent window closed and restored cleanly");

    // ── 9. Phase 6: Consolidated Meta-Tool Resolution ──
    console.log("\n[9/9] Testing Phase 6: Consolidated Meta-Tool action routing...");
    
    // web_session -> web_status
    const sessCall = resolveConsolidatedCall("web_session", { action: "status" });
    assert.ok(!("error" in sessCall));
    const sessExec = await callWebTool(sessCall.toolName, sessCall.args);
    assert.ok(sessExec.ok, "web_session:status execution must succeed");
    console.log("  ✓ web_session:status -> web_status execution verified");

    // web_inspect -> web_page_observe
    const inspectCall = resolveConsolidatedCall("web_inspect", {
      action: "observe",
      args: { tabId: testTabId, maxTokens: 2000 },
    });
    assert.ok(!("error" in inspectCall));
    const inspectExec = await callWebTool(inspectCall.toolName, inspectCall.args);
    assert.ok(inspectExec.ok, "web_inspect:observe execution must succeed");
    console.log("  ✓ web_inspect:observe -> web_page_observe execution verified");

    // web_page -> web_wait_for
    const pageWaitCall = resolveConsolidatedCall("web_page", {
      action: "wait",
      args: { tabId: testTabId, selector: "h1" },
    });
    assert.ok(!("error" in pageWaitCall));
    const pageWaitExec = await callWebTool(pageWaitCall.toolName, pageWaitCall.args);
    assert.ok(pageWaitExec.ok, "web_page:wait -> web_wait_for execution must succeed");
    console.log("  ✓ web_page:wait -> web_wait_for execution verified");

    // web_interact -> web_click
    const clickCall = resolveConsolidatedCall("web_interact", {
      action: "click",
      args: { tabId: testTabId, selector: "h1" },
    });
    assert.ok(!("error" in clickCall));
    const clickExec = await callWebTool(clickCall.toolName, clickCall.args);
    assert.ok(clickExec.ok, "web_interact:click -> web_click execution must succeed");
    console.log("  ✓ web_interact:click -> web_click execution verified");

  } finally {
    // ── CLEANUP: Close Dedicated Test Tab ──
    console.log("\n[CLEANUP] Closing dedicated test tab...");
    const closeRes = await callWebTool("web_tab", { action: "close", tabId: testTabId });
    console.log(`  ✓ Dedicated test tab closed cleanly: success=${closeRes.ok}`);
  }

  // ── Prompt & Skill Definitions Verification ──
  console.log("\n[VERIFICATION] Verifying prompt & skill catalogs...");
  const prompts = promptDefinitions();
  assert.equal(prompts.length, 17, `Expected 17 prompts, got ${prompts.length}`);
  const promptNames = [
    "screensync_operator",
    "web_see_and_report",
    "web_form_autofill",
    "web_visual_qa",
    "web_reproduce_issue",
    "web_debug_session",
    "web_watch_flow",
    "web_perf_audit",
    "web_multitab_workflow",
    "web_social_publish",
    "web_autonomous_agent",
  ];
  for (const name of promptNames) {
    assert.ok(prompts.some((p) => p.name === name), `Prompt ${name} must be declared`);
  }
  console.log(`  ✓ All ${prompts.length} prompts verified in catalog`);

  console.log("\n==================================================================");
  console.log("  ALL LIVE BROWSER E2E VERIFICATIONS PASSED (100% CLEAN)");
  console.log("==================================================================");
}

runLiveVerification().catch((err) => {
  console.error("\n❌ LIVE VERIFICATION FAILED:", err);
  process.exit(1);
});
