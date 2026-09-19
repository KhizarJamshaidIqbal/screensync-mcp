// ScreenSync Cognitive State - the persistence registry (Phase 1 of the cognitive spine).
//
// Until now only cognitiveStore survived a restart. Every other engine (maturation, lifespan,
// breakers, prospective intentions, ...) kept its state in Maps that reset to hardcoded seeds when
// the hub restarted, so a "memory system" forgot everything it had just learned.
//
// An engine opts in by exposing snapshotState() / restoreState(). The registry then:
//   - hydrates each namespace from DATA_DIR/cognitive/<ns>.json at boot,
//   - notices changes by comparing a content snapshot (no engine has to remember to "mark dirty"),
//   - writes only the namespaces that changed, atomically,
//   - and flushes once more on shutdown.
//
// A file it cannot trust (corrupt, wrong shape, from a newer build, or one the engine refuses to
// restore) is moved aside as <file>.corrupt-<ts> and the engine keeps whatever it already had.
// Nothing here ever deletes or overwrites bytes it could not read.
//
// Only the process that owns the HTTP port starts the flush timer (see hub.ts). A second process that
// lost the port race hydrates nothing it will write and never flushes, so two processes cannot fight
// over the same files.

import path from "node:path";
import { DATA_DIR, log } from "./config.js";
import { atomicWriteJson, quarantine, readJsonSafe } from "./cognitive-state.js";

export interface PersistableEngine {
  /** Plain-JSON state. Must be deterministic for unchanged state (the diff decides what to write). */
  snapshotState(): unknown;
  /**
   * Load saved state into a freshly constructed engine, which already holds its built-in seeds. Must
   * validate everything first and throw WITHOUT mutating if the snapshot is bad. An engine whose seed
   * ships with the build should merge over it (see federation) rather than replace it.
   */
  restoreState(raw: unknown): void;
}

export interface Registration {
  ns: string;
  /** Bump when the snapshot shape changes; a file with a HIGHER version is never touched. */
  version: number;
  engine: PersistableEngine;
}

export type HydrateStatus = "restored" | "fresh" | "quarantined";
export interface HydrateReport {
  ns: string;
  status: HydrateStatus;
  reason?: string;
  quarantinedTo?: string | null;
}

const NS_RE = /^[a-z][a-z0-9-]{0,40}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class CognitiveStateRegistry {
  private readonly regs = new Map<string, Registration>();
  private readonly lastWritten = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(private readonly dir: string) {}

  public register(reg: Registration): void {
    if (!NS_RE.test(reg.ns)) throw new Error(`invalid cognitive state namespace: ${reg.ns}`);
    if (this.regs.has(reg.ns)) throw new Error(`cognitive state namespace registered twice: ${reg.ns}`);
    this.regs.set(reg.ns, reg);
  }

  public namespaces(): string[] {
    return [...this.regs.keys()];
  }

  private fileFor(ns: string): string {
    return path.join(this.dir, `${ns}.json`);
  }

  /** Restores every registered namespace from disk. Safe to call once, before serving traffic. */
  public hydrateAll(): HydrateReport[] {
    return [...this.regs.values()].map((reg) => this.hydrateOne(reg));
  }

  private hydrateOne(reg: Registration): HydrateReport {
    const file = this.fileFor(reg.ns);
    // Whatever the engine holds after this call is the baseline: only a later DIVERGENCE is written.
    // That keeps first-run seed data from being persisted as if it had been learned.
    const setBaseline = () => this.lastWritten.set(reg.ns, JSON.stringify(reg.engine.snapshotState()));
    const reject = (reason: string): HydrateReport => {
      const quarantinedTo = quarantine(file, reason);
      setBaseline();
      return { ns: reg.ns, status: "quarantined", reason, quarantinedTo };
    };

    const read = readJsonSafe(file);
    if (read.status === "missing") {
      setBaseline();
      return { ns: reg.ns, status: "fresh" };
    }
    if (read.status === "corrupt") return reject(read.error);

    const env = read.value;
    if (!isRecord(env) || env.ns !== reg.ns || typeof env.version !== "number" || !("state" in env)) {
      return reject("malformed cognitive state envelope");
    }
    if (env.version > reg.version) return reject(`written by a newer build (state v${env.version}, this build v${reg.version})`);

    try {
      reg.engine.restoreState(env.state);
    } catch (e) {
      return reject(`engine refused the snapshot: ${String((e as Error).message ?? e)}`);
    }
    setBaseline();
    return { ns: reg.ns, status: "restored" };
  }

  /** Writes every namespace whose content changed since it was last read or written. Returns those. */
  public flush(): string[] {
    const written: string[] = [];
    for (const reg of this.regs.values()) {
      let state: unknown;
      let json: string;
      try {
        state = reg.engine.snapshotState();
        json = JSON.stringify(state);
      } catch (e) {
        log("ERROR", "Could not snapshot cognitive state", { ns: reg.ns, error: String(e) });
        continue;
      }
      if (json === this.lastWritten.get(reg.ns)) continue;
      try {
        atomicWriteJson(this.fileFor(reg.ns), { ns: reg.ns, version: reg.version, savedAt: new Date().toISOString(), state });
        this.lastWritten.set(reg.ns, json);
        written.push(reg.ns);
      } catch (e) {
        // Leave lastWritten alone so the next tick retries.
        log("ERROR", "Failed to persist cognitive state", { ns: reg.ns, error: String(e) });
      }
    }
    return written;
  }

  /** Starts the periodic flush. Call ONLY from the process that owns the HTTP port. */
  public start(intervalMs = 1000): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => {
      try { this.flush(); } catch (e) { log("ERROR", "Cognitive state flush failed", { error: String(e) }); }
    }, intervalMs);
    this.timer.unref?.();
  }

  /** Stops the timer and does a final flush, but only if this registry was ever started. */
  public stop(): string[] {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const written = this.started ? this.flush() : [];
    this.started = false;
    return written;
  }

  public isStarted(): boolean {
    return this.started;
  }
}

/** The process-wide registry. Engines are attached in cognitive-engines.ts. */
export const cognitiveRegistry = new CognitiveStateRegistry(path.join(DATA_DIR, "cognitive"));
