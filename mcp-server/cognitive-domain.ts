// ScreenSync Cognitive Memory - the ONE spelling of a domain.
//
// Every cognitive store is keyed by domain, and they used to disagree on what a domain is: the spine only
// lowercased and dropped "www.", the memory store parsed a URL, the observer parsed a URL only when it had a
// scheme. So "https://x.com", "x.com:443" and "WWW.x.com" were three different domains to one store and the
// same domain to another, and a verified success credited under one spelling could never be claimed under
// another. Everything that keys by domain goes through canonicalDomain() now.
//
// No imports on purpose: this is a leaf that every cognitive module can use without a cycle.

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//;

/**
 * The canonical host of a domain, host or URL: lowercased, without scheme, port, path, trailing dot or
 * leading "www.". Returns "" for anything empty or unparseable. Idempotent: canonicalDomain(canonicalDomain(x))
 * === canonicalDomain(x).
 */
export function canonicalDomain(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const input = raw.trim().toLowerCase();
  if (!input) return "";
  let host: string;
  try {
    host = new URL(HAS_SCHEME.test(input) ? input : `https://${input}`).hostname;
    // A scheme the URL standard does not know (foo://, chrome-extension://) keeps an opaque, percent-encoded host
    // ("m%C3%BCnchen.de"). Parsing it again as a web host gives the punycode spelling an https:// input gets, so
    // the result is the same on the next call (idempotent) instead of moving to another key on the next load.
    if (host) host = new URL(`https://${host}`).hostname;
  } catch {
    return "";
  }
  return host.replace(/\.+$/, "").replace(/^(?:www\.)+/, "");
}

/**
 * A persisted map re-keyed by canonicalDomain(). Stores written before every writer used the canonical form
 * hold keys such as "https://x.com", "x.com:443" or "münchen.de" that no lookup can reach any more. Entries
 * that land on the same canonical key are combined with `merge(kept, other)`; `fix` can rewrite a value's own
 * domain field. A key that does not parse as a domain is kept as it is (never silently dropped) unless
 * `dropInvalid` is set.
 */
export function rekeyByDomain<T>(
  entries: Iterable<[string, T]>,
  merge: (kept: T, other: T) => T,
  opts: { fix?: (value: T, key: string) => T; dropInvalid?: boolean } = {},
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [raw, value] of entries) {
    const canon = canonicalDomain(raw);
    if (!canon && opts.dropInvalid) continue;
    const key = canon || raw;
    const v = opts.fix ? opts.fix(value, key) : value;
    const prev = out.get(key);
    out.set(key, prev === undefined ? v : merge(prev, v));
  }
  return out;
}
