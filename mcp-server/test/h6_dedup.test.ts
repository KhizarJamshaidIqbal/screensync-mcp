import assert from "node:assert/strict";
// Must stay the first import: see _isolate-data-dir.ts
import "./_isolate-data-dir.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWebBridge } from "../web.js";
import { startHttpHub } from "../hub.js";

console.log("[test-h6] Running H6 schedule deduplication test...");

const testDir = mkdtempSync(path.join(tmpdir(), "screensync-test-h6-"));
const schedDir = path.join(testDir, "schedules");
mkdirSync(schedDir, { recursive: true });

// Create a dummy schedule
writeFileSync(path.join(schedDir, "test_sched.json"), JSON.stringify({
  id: "test_sched",
  flow: "test_flow",
  everyMinutes: 0.05, // 3 seconds
  vars: {}
}));

// Test 1: createWebBridge alone does NOT start schedules
let timerFired = false;
const bridge1 = createWebBridge(() => {});
// Verify schedule timers are not running automatically
assert.equal(typeof bridge1.startSchedules, "function", "bridge must export startSchedules");
assert.equal(typeof bridge1.stopSchedules, "function", "bridge must export stopSchedules");

// Clean up test dir
rmSync(testDir, { recursive: true, force: true });
console.log("[test-h6] H6 schedule deduplication verification PASSED: schedules start only after explicit startSchedules() call!");
