// Shared fixtures for the Phase 4b suites (reflection, curriculum, hygiene).
//
// A test file must import "./_isolate-data-dir.js" BEFORE this module: the stores read the data dir at
// import time, and the isolation is what keeps a test from writing into the real cognitive memory.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Response } from "express";
import { CognitiveMemoryStore, cognitiveStore, type ExecutionEpisode } from "../cognitive-memory.js";
import { handleCognitiveTool } from "../web-cognitive-handlers.js";

export const T0 = Date.UTC(2026, 5, 1, 12);
export const DAY = 86_400_000;
export const iso = (ms: number) => new Date(ms).toISOString();
export const NOW = iso(T0);
export const STEPS = [{ step: 1, name: "go", tool: "web_navigate" }];

export function ep(over: Partial<ExecutionEpisode> = {}): ExecutionEpisode {
  return { id: `ep_${Math.random().toString(36).slice(2, 8)}`, timestamp: NOW, domain: "site.example", intent: "click", success: true, durationMs: 500, ...over };
}

/** A store on its own scratch file, for tests that must not share state. */
export function scratchStore(): { store: CognitiveMemoryStore; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "cognitive-4b-"));
  return { store: new CognitiveMemoryStore(path.join(dir, "memory.json")), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A SECOND store on the process-wide store's file. Asserting through the instance that did the write only
 * proves it mutated its own in-memory cache, which passes even with save() removed.
 */
export const reopen = (): CognitiveMemoryStore => new CognitiveMemoryStore(cognitiveStore.file);

/** Drives a cognitive tool through the same dispatcher the hub uses. */
export function call(tool: string, args: Record<string, unknown>): any {
  let body: unknown;
  const res = { json: (b: unknown) => { body = b; }, status: () => res } as unknown as Response;
  assert.equal(handleCognitiveTool(tool, args, res, { session: "phase4b-test" }), true, `${tool} must be handled`);
  return body;
}

/** Makes a stored playbook verified the way the hub does: confirmed runs in two distinct sessions. */
export function verify(store: CognitiveMemoryStore, domain: string, playbook: string): void {
  store.recordOutcome({ domain, playbook, success: true, session: "verify-a", hubConfirmed: true });
  store.recordOutcome({ domain, playbook, success: true, session: "verify-b", hubConfirmed: true });
}
