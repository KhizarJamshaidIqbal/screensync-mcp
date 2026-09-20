// ScreenSync Cognitive Memory - where a playbook is stored, and under what id.
//
// Storage keys are OPAQUE and hub-owned. Nothing may parse meaning out of one, and a caller may not
// choose one. That rule is the whole point of this file: an earlier version encoded relationships in the
// key and the name ("<name>~candidate" meant "an edit of <name>"), so naming a playbook "flow~candidate"
// was enough to evict an unrelated verified "flow" on someone else's domain. A relationship between
// records belongs in a field (ProceduralPlaybook.supersedes), never in a string a caller writes.

import { log } from "./config.js";
import type { ProceduralPlaybook } from "./cognitive-memory.js";
import { statusOf } from "./cognitive-skills.js";

export type PlaybookMap = Record<string, ProceduralPlaybook>;

/** Most pending edits kept for one verified playbook before the oldest unproven one is reused. */
export const MAX_PENDING_EDITS = 5;

/** The key an entry currently lives under, by identity. */
export function keyOf(playbooks: PlaybookMap, pb: ProceduralPlaybook): string | null {
  return Object.keys(playbooks).find((k) => playbooks[k] === pb) ?? null;
}

/** A free key for a (domain, name). Keys only have to be unique; they carry no meaning. */
export function storageKey(playbooks: PlaybookMap, domain: string, name: string): string {
  const base = `${domain}::${name}`;
  if (playbooks[base] === undefined) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}#${i}`;
    if (playbooks[candidate] === undefined) return candidate;
  }
}

/** An id that collides with no other playbook's id anywhere in the store. */
export function uniqueId(playbooks: PlaybookMap, domain: string, name: string): string {
  const base = `pb_${domain.replace(/\./g, "_")}_${name}`;
  const taken = new Set(Object.values(playbooks).map((p) => p.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    if (!taken.has(`${base}#${i}`)) return `${base}#${i}`;
  }
}

/**
 * Where a new edit of `targetKey` goes. An edit that has banked no verification yet is simply revised in
 * place - that is what "I edited my draft again" means. One that HAS banked a hub-confirmed run is never
 * thrown away, so a later edit gets its own slot beside it; a single shared slot used to destroy an edit
 * that was one session away from replacing the original. Unproven edits are capped so they cannot pile up.
 */
export function freeEditKey(playbooks: PlaybookMap, targetKey: string, domain: string, name: string): string {
  const pending = Object.entries(playbooks)
    .filter(([, p]) => p.supersedes === targetKey && statusOf(p) !== "deprecated")
    .sort((a, b) => String(a[1].createdAt ?? "").localeCompare(String(b[1].createdAt ?? "")));

  const unproven = pending.find(([, p]) => (p.verifications ?? []).length === 0);
  if (unproven) return unproven[0];
  if (pending.length >= MAX_PENDING_EDITS) {
    log("WARN", "Reusing the oldest pending edit slot of a verified playbook", { playbook: name, domain, pending: pending.length });
    return pending[0][0];
  }
  return storageKey(playbooks, domain, name);
}
