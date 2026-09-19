// ScreenSync Cognitive State - snapshot/restore helpers shared by the engines.
//
// Each engine keeps its state in Maps, Sets and arrays. To persist them they are turned into plain
// JSON (a Map becomes an array of [key, value] entries) and turned back on load. Restoring is
// STRICT: a malformed snapshot throws, so the registry can set the file aside and keep the engine's
// current state, instead of an engine limping on with half-restored garbage.

export type Rec = Record<string, unknown>;

export function asRecord(raw: unknown, what: string): Rec {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${what}: expected an object`);
  }
  return raw as Rec;
}

export function toArray<T>(raw: unknown, what: string): T[] {
  if (!Array.isArray(raw)) throw new Error(`${what}: expected an array`);
  return raw as T[];
}

/** Rebuilds a Map from [key, value] entries. Values must be objects/arrays, never null or scalars. */
export function toMap<V>(raw: unknown, what: string): Map<string, V> {
  const out = new Map<string, V>();
  for (const e of toArray<unknown>(raw, what)) {
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== "string") {
      throw new Error(`${what}: malformed entry`);
    }
    if (typeof e[1] !== "object" || e[1] === null) {
      throw new Error(`${what}: entry "${e[0]}" has no object value`);
    }
    out.set(e[0], e[1] as V);
  }
  return out;
}

export function toStringSet(raw: unknown, what: string): Set<string> {
  const out = new Set<string>();
  for (const v of toArray<unknown>(raw, what)) {
    if (typeof v !== "string") throw new Error(`${what}: expected strings`);
    out.add(v);
  }
  return out;
}

/** Keeps the newest `max` items of an append-ordered list. */
export function capTail<T>(list: T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : list;
}
