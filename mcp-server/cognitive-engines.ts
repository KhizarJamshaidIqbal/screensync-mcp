// ScreenSync Cognitive State - which engines are durable, and how the hub switches persistence on.
//
// Importing an engine never touches the disk. Persistence starts only when hub.ts calls
// startCognitivePersistence() after it has WON the HTTP port, so the stdio relay process (which
// forwards to the hub over HTTP and holds no engine state of its own) can never read, quarantine
// or overwrite the owner's files.
//
// An engine belongs here only if something at runtime WRITES to it. Persisting a constant is dead
// code, and persisting a seed pins an old copy of it over every future build's seed. Left out, and
// why (re-check when a writer is wired, then add the engine here with a round-trip test):
//   graph          static seeded topology; nothing ever calls addNode/addEdge on it.
//   replay         holds no state of its own: web_episodic_query reads, and logEpisode writes, the real
//                  episodes in cognitiveStore, which is already durable.
//   lineage        recordMutation has no caller, so the history is always empty.
//   metacognition  recordLatency has no caller; reads fall back to a built-in default series.
//   warming        recordFailure/recordSuccess have no caller, so this breaker never leaves CLOSED.
//                  The live breaker is the transcendental engine's, which IS durable below.
//   contracts      ephemeral recovery snapshots of unsaved page text (web_contract_check). They hold
//                  whatever the user had typed into a form, so writing them to disk would turn a
//                  safety net into a privacy leak. Losing them on restart is the correct behaviour.
//   cognitiveStore already durable on its own (cognitive-memory.json), with its own migrations. Its only
//                  deferred write (tracker episodes, saveSoon) is flushed by stopCognitivePersistence().
//   development    a pure VIEW of the spine (its stage, scaffolding and counters are recomputed on every
//                  read), so there is nothing of its own to save. maturation and lifespan save only the
//                  state tools really write (the epistemic graph; motor calibration and metaphors); their
//                  per-domain profiles are views too.

import { log } from "./config.js";
import { cognitiveRegistry, type HydrateReport, type PersistableEngine } from "./cognitive-persistence.js";
import { globalAdolescentEngine } from "./cognitive-adolescent.js";
import { cognitiveStore } from "./cognitive-memory.js";
import { globalDynamicsEngine } from "./cognitive-dynamics.js";
import { globalFederatedCatalog } from "./cognitive-federation.js";
import { globalLifespanEngine } from "./cognitive-lifespan.js";
import { globalMaturationEngine } from "./cognitive-maturation.js";
import { globalRpdEngine } from "./cognitive-rpd.js";
import { globalSpine } from "./cognitive-spine.js";
import { globalTranscendentalEngine } from "./cognitive-transcendental.js";

/** Namespace -> engine. The namespace is the file name (cognitive/<ns>.json); never rename one. */
export const DURABLE_ENGINES: ReadonlyArray<readonly [string, PersistableEngine]> = [
  ["spine", globalSpine],
  ["maturation", globalMaturationEngine],
  ["lifespan", globalLifespanEngine],
  ["adolescent", globalAdolescentEngine],
  ["dynamics", globalDynamicsEngine],
  ["transcendental", globalTranscendentalEngine],
  ["rpd", globalRpdEngine],
  ["federation", globalFederatedCatalog],
];

let registered = false;

function registerAll(): void {
  if (registered) return;
  registered = true;
  for (const [ns, engine] of DURABLE_ENGINES) cognitiveRegistry.register({ ns, version: 1, engine });
}

/**
 * Restores every engine from disk, then starts the periodic flush. Call once, from the process that
 * owns the HTTP port. Never throws: a persistence problem must not stop the hub from serving.
 */
export function startCognitivePersistence(): HydrateReport[] {
  try {
    registerAll();
    const reports = cognitiveRegistry.hydrateAll();
    const quarantined = reports.filter((r) => r.status === "quarantined");
    for (const r of quarantined) {
      log("WARN", "Cognitive state file set aside; that engine starts from its defaults", {
        ns: r.ns, reason: r.reason, movedTo: r.quarantinedTo,
      });
    }
    log("INFO", "Cognitive state hydrated", {
      restored: reports.filter((r) => r.status === "restored").map((r) => r.ns),
      fresh: reports.filter((r) => r.status === "fresh").length,
      quarantined: quarantined.length,
    });
    cognitiveRegistry.start();
    return reports;
  } catch (error) {
    log("ERROR", "Cognitive persistence could not start; state will not survive a restart", { error: String(error) });
    return [];
  }
}

/**
 * Writes what is waiting to be written, without stopping anything: called when the MCP host closes our stdin
 * (index.ts), which on Windows is often followed by TerminateProcess, where no signal or exit handler runs.
 * The registry is flushed only in the process that started it (the port owner): a relay never writes it.
 */
export function flushCognitiveState(): void {
  try {
    cognitiveStore.flush();
    if (cognitiveRegistry.isStarted()) cognitiveRegistry.flush();
  } catch (error) {
    log("ERROR", "Cognitive flush on host hang-up failed", { error: String(error) });
  }
}

/** Final flush + stop. Safe to call when persistence never started. */
export function stopCognitivePersistence(): string[] {
  try {
    cognitiveStore.flush(); // tracker episodes still waiting on their coalesced save
  } catch (error) {
    log("ERROR", "Final cognitive memory flush failed", { error: String(error) });
  }
  try {
    return cognitiveRegistry.stop();
  } catch (error) {
    log("ERROR", "Final cognitive state flush failed", { error: String(error) });
    return [];
  }
}
