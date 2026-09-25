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
  } catch {
    return "";
  }
  return host.replace(/\.+$/, "").replace(/^(?:www\.)+/, "");
}
