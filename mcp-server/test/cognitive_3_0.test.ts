// ScreenSync Cognitive Memory 3.0 (SC-WA) Integration Test Suite
// Verifies:
// 1. Cognitive Associative Knowledge Graph (CAG) & Cross-Domain Skill Transfer
// 2. Cognitive Data Safety Contracts (Dirty Form Auditing & Ephemeral Snapshots)
// 3. Playbook DAG Lineage & Cryptographic Provenance Tracking

import test from "node:test";
import assert from "node:assert/strict";
import { CognitiveMemoryStore } from "../cognitive-memory.js";
import { globalAssociativeGraph } from "../cognitive-graph.js";
import { CognitiveContractEngine } from "../cognitive-contracts.js";
import { PlaybookLineageEngine } from "../cognitive-lineage.js";

test("AP-CE Tier 3: Cognitive Associative Graph & Cross-Domain Skill Transfer", () => {
  const store = new CognitiveMemoryStore();

  // Test transferring post skill from x.com to threads.net (shares Lexical framework)
  const transferRes = globalAssociativeGraph.transferSkill("threads.net", "post", store);

  assert.equal(transferRes.transferred, true);
  assert.equal(transferRes.targetDomain, "threads.net");
  assert.equal(transferRes.sourceDomain, "x.com");
  assert.ok(transferRes.sharedFramework?.includes("Lexical"), "Must identify Lexical framework link");
  assert.ok(transferRes.adaptedPlaybook, "Adapted playbook must be generated");
  assert.equal(transferRes.adaptedPlaybook?.domain, "threads.net");
  assert.equal(transferRes.adaptedPlaybook?.intent, "post");
  assert.ok(transferRes.confidence >= 0.8, "Confidence must be >= 0.8 for direct framework match");
});

test("AP-CE Tier 1: Cognitive Data Safety Contracts & Accidental Loss Prevention", () => {
  const contractEngine = new CognitiveContractEngine();
  const domain = "blog.epsoldev.com";
  const url = "https://blog.epsoldev.com/wp-admin/post-new.php";

  // Case 1: Clean page (no unsaved form input)
  const cleanCheck = contractEngine.evaluateFormContract({ domain, url, detectedDirtyFields: [] });
  assert.equal(cleanCheck.safe, true);
  assert.equal(cleanCheck.dirtyCount, 0);
  assert.equal(cleanCheck.actionRecommended, "allow");

  // Case 2: Dirty page with uncommitted blog post content
  const dirtyFields = [
    { selector: "#title", tag: "input", charCount: 45, previewText: "Introducing ScreenSync Cognitive 3.0" },
    { selector: "#content", tag: "textarea", charCount: 350, previewText: "Deep-dive into associative..." }
  ];

  const riskyCheck = contractEngine.evaluateFormContract({
    domain,
    url,
    detectedDirtyFields: dirtyFields,
    allowDirtyNavigation: false
  });

  assert.equal(riskyCheck.safe, false);
  assert.equal(riskyCheck.dirtyCount, 2);
  assert.equal(riskyCheck.actionRecommended, "block_and_confirm");
  assert.ok(riskyCheck.snapshotId, "Must create ephemeral recovery snapshot");

  // Case 3: Verify ephemeral snapshot retrieval
  const snapshot = contractEngine.getSnapshot(riskyCheck.snapshotId!);
  assert.ok(snapshot, "Snapshot must exist in ephemeral vault");
  assert.equal(snapshot?.fields.length, 2);
  assert.equal(snapshot?.fields[0].selector, "#title");

  // Case 4: Allow navigation with auto-snapshot
  const allowedCheck = contractEngine.evaluateFormContract({
    domain,
    url,
    detectedDirtyFields: dirtyFields,
    allowDirtyNavigation: true
  });
  assert.equal(allowedCheck.safe, true);
  assert.equal(allowedCheck.actionRecommended, "snapshot_and_proceed");
});

test("AP-CE Tier 2: Playbook DAG Lineage & Provenance Tracking", () => {
  const lineage = new PlaybookLineageEngine();
  const playbookId = "x_publish_post";

  // Initial lineage seed should exist
  const historyBefore = lineage.getHistory(playbookId);
  assert.ok(historyBefore.length >= 1, "Initial seed commit must exist");

  // Record a self-healing selector mutation
  const mutationCommit = lineage.recordMutation({
    playbookId,
    author: "self_healing_engine",
    mutationReason: "DOM drift detected: updated compose selector",
    diffSummary: {
      modifiedStepIndex: 2,
      oldSelector: "div[data-testid='tweetTextarea_0']",
      newSelector: "div[role='textbox'][contenteditable='true']"
    }
  });

  assert.ok(mutationCommit.commitId);
  assert.equal(mutationCommit.parentCommitId, historyBefore[historyBefore.length - 1].commitId);
  assert.equal(mutationCommit.author, "self_healing_engine");

  // Record a second mutation (LTP consolidation optimization)
  const ltpCommit = lineage.recordMutation({
    playbookId,
    author: "consolidation_job",
    mutationReason: "LTP confidence elevated to 0.95 after 10 successful executions",
    diffSummary: { deltaMs: -450 }
  });

  assert.equal(ltpCommit.parentCommitId, mutationCommit.commitId);

  // Check full DAG history for playbook
  const fullHistory = lineage.getHistory(playbookId);
  assert.equal(fullHistory.length, historyBefore.length + 2);
});
