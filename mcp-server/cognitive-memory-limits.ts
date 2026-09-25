// ScreenSync Cognitive Memory - size limits, so the store cannot grow without bound (M9).
//
// Before this, episodes were one global FIFO of 200 (one chatty domain evicted every other domain's
// history) while pitfalls and facts were unbounded, and every tracked tool call fsync-rewrote the whole
// file. The rules here:
//   episodes  at most EPISODES_PER_DOMAIN per domain and EPISODES_TOTAL overall. Episodes are telemetry:
//             the oldest of the domain (or, over the total, of the largest domain) are evicted.
//   pitfalls  knowledge a person or agent wrote, so NEVER silently evicted. Oversized fields are clamped;
//             at PITFALLS_PER_DOMAIN exact duplicates are merged first, and if the domain is still full the
//             new pitfall is refused with a hint - the caller hears about it, nothing disappears.
//   facts     a domain's fact record is capped in size and in keySelectors; an oversized write is refused.
//
// Pure functions over the store's data. Loading and saving stay in cognitive-memory.ts.

import type { CognitiveMemoryData, DomainPitfall, DomainSemanticMemory } from "./cognitive-memory-types.js";

export const EPISODES_PER_DOMAIN = 100;
export const EPISODES_TOTAL = 2000;
export const PITFALLS_PER_DOMAIN = 200;
export const PITFALL_TEXT_MAX = 2000;
export const PITFALL_CODE_MAX = 8000;
export const FACT_MAX_BYTES = 16 * 1024;
export const FACT_MAX_KEY_SELECTORS = 200;

const TEXT_FIELDS = ["symptom", "rootCause", "conditionTrigger", "antiPattern", "provenSolution"] as const;
const IDENTITY_FIELDS = [...TEXT_FIELDS, "codeSnippet"] as const;

/**
 * Evicts the oldest episodes of `domain` beyond EPISODES_PER_DOMAIN, then, while the store holds more than
 * EPISODES_TOTAL, the oldest episode of whichever domain holds the most. Episodes are stored oldest first.
 * Returns how many were evicted.
 */
export function capEpisodes(mem: CognitiveMemoryData, domain: string): number {
  const counts = new Map<string, number>();
  for (const e of mem.episodes) counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
  const drop = new Set<number>();

  let over = (counts.get(domain) ?? 0) - EPISODES_PER_DOMAIN;
  for (let i = 0; over > 0 && i < mem.episodes.length; i += 1) {
    if (mem.episodes[i].domain === domain) { drop.add(i); over -= 1; }
  }
  if (drop.size > 0) counts.set(domain, EPISODES_PER_DOMAIN);

  let total = mem.episodes.length - drop.size;
  while (total > EPISODES_TOTAL) {
    let largest = "";
    for (const [d, n] of counts) if (n > (counts.get(largest) ?? 0)) largest = d;
    const i = mem.episodes.findIndex((e, idx) => !drop.has(idx) && e.domain === largest);
    if (i < 0) break;
    drop.add(i);
    counts.set(largest, (counts.get(largest) ?? 1) - 1);
    total -= 1;
  }
  if (drop.size > 0) mem.episodes = mem.episodes.filter((_, i) => !drop.has(i));
  return drop.size;
}

const clampText = (v: string | undefined, max: number): { value: string | undefined; clamped: boolean } =>
  v !== undefined && v.length > max ? { value: `${v.slice(0, max - 1)}…`, clamped: true } : { value: v, clamped: false };

/** Clamps a pitfall's free-text fields in place. Returns the names of the fields that were shortened. */
export function clampPitfall(pf: DomainPitfall): string[] {
  const clamped: string[] = [];
  for (const f of TEXT_FIELDS) {
    const r = clampText(pf[f], PITFALL_TEXT_MAX);
    if (r.clamped) { (pf as unknown as Record<string, string | undefined>)[f] = r.value; clamped.push(f); }
  }
  const code = clampText(pf.codeSnippet, PITFALL_CODE_MAX);
  if (code.clamped) { pf.codeSnippet = code.value; clamped.push("codeSnippet"); }
  return clamped;
}

const identityOf = (pf: DomainPitfall): string =>
  IDENTITY_FIELDS.map((f) => String(pf[f] ?? "").trim().replace(/\s+/g, " ").toLowerCase()).join("\u0000");

/**
 * Folds exact duplicates (same text in every content field) into their first copy, keeping every dropped
 * id under mergedFrom so episodes that cite one still resolve. Returns how many copies were merged.
 */
export function mergeExactDuplicates(list: DomainPitfall[]): { kept: DomainPitfall[]; merged: number } {
  const byIdentity = new Map<string, DomainPitfall>();
  const kept: DomainPitfall[] = [];
  let merged = 0;
  for (const pf of list) {
    const key = identityOf(pf);
    const home = byIdentity.get(key);
    if (!home) { byIdentity.set(key, pf); kept.push(pf); continue; }
    home.mergedFrom = [...new Set([...(home.mergedFrom ?? []), ...(pf.mergedFrom ?? []), pf.id])].filter((id) => id !== home.id);
    if (String(pf.discoveredAt) < String(home.discoveredAt)) home.discoveredAt = pf.discoveredAt;
    merged += 1;
  }
  return { kept, merged };
}

/**
 * Decides where a new pitfall goes when its domain may be full. Below the cap it is simply added. At the cap,
 * exact duplicates already stored are merged first; a new pitfall that duplicates a stored one folds into it;
 * if the domain is still full the pitfall is refused with an error that says what to do. Never evicts.
 */
export function admitPitfall(mem: CognitiveMemoryData, domain: string, pf: DomainPitfall): { id: string; note?: string } {
  const list = mem.pitfalls[domain] ?? (mem.pitfalls[domain] = []);
  if (list.length < PITFALLS_PER_DOMAIN) { list.push(pf); return { id: pf.id }; }

  const { kept, merged } = mergeExactDuplicates(list);
  mem.pitfalls[domain] = kept;
  const same = kept.find((p) => identityOf(p) === identityOf(pf));
  if (same) return { id: same.id, note: `This domain holds ${PITFALLS_PER_DOMAIN} pitfalls and this one duplicates "${same.id}", so it was merged into it.` };
  if (kept.length < PITFALLS_PER_DOMAIN) {
    kept.push(pf);
    return { id: pf.id, note: `This domain was full; ${merged} exact duplicate pitfall(s) were merged to make room.` };
  }
  throw new Error(
    `${domain} already holds ${PITFALLS_PER_DOMAIN} distinct pitfalls, so this one was NOT stored (nothing is ever evicted). ` +
    `Run web_cognitive_hygiene {action:'autoclean', domain:'${domain}'} to merge near-duplicates, then learn it again.`,
  );
}

/**
 * The fact record a `fact` learn would produce, checked against the caps. Spread semantics are unchanged
 * (a field in `data` replaces the stored one); a result over the caps is refused, never silently trimmed.
 */
export function mergeFact(existing: DomainSemanticMemory | undefined, domain: string, data: Record<string, unknown>, now: string): DomainSemanticMemory {
  const next = { ...(existing ?? { domain }), ...data, domain, lastVerifiedAt: now } as DomainSemanticMemory;
  const selectors = next.keySelectors;
  if (selectors !== undefined && (typeof selectors !== "object" || selectors === null || Array.isArray(selectors))) {
    throw new Error("data.keySelectors must be an object of name -> selector.");
  }
  const selectorCount = selectors ? Object.keys(selectors).length : 0;
  if (selectorCount > FACT_MAX_KEY_SELECTORS) {
    throw new Error(`a domain keeps at most ${FACT_MAX_KEY_SELECTORS} keySelectors (this write has ${selectorCount}). Nothing was stored.`);
  }
  const bytes = Buffer.byteLength(JSON.stringify(next), "utf8");
  if (bytes > FACT_MAX_BYTES) {
    throw new Error(`the facts for ${domain} would take ${bytes} bytes (limit ${FACT_MAX_BYTES}). Nothing was stored; keep facts short and put long procedures in a playbook.`);
  }
  return next;
}
