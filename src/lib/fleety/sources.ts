// Shared formatting for Fleety's answer "Sources" (the X-Fleety-Sources links). One place so all
// three surfaces label + dedupe citations identically.
//
// Why this exists: the old per-surface `prettyUrl` showed only `host + pathname`, which STRIPS the
// query + hash. Every SPF deep-link (…/explore/?e=<type>#item/<slug>) therefore collapsed to the
// same string ".../explore" — so a 5-source answer rendered as five identical-looking links, which
// members read as "Fleety just sent links and can't actually help." These helpers make each source
// distinguishable (by its entity slug/type) and drop exact duplicates.

/** Human-readable label for a citation URL. SPF explore deep-links show the entity name (+ type);
 *  other links show host + path. Never throws. */
export function formatSourceLabel(url: string): string {
  try {
    const u = new URL(url);
    // SPF explore deep-link: the meaningful part lives in the hash (#item/<slug>) and query (?e=<type>).
    const slug = u.hash.match(/#item\/([^/?&#]+)/)?.[1];
    if (slug) {
      const name = decodeURIComponent(slug).replace(/[-_]/g, " ").trim();
      const type = (u.searchParams.get("e") || "").replace(/[-_]/g, " ").trim();
      const nice = name.replace(/\b\w/g, (c) => c.toUpperCase());
      return type ? `${nice} · ${type}` : nice;
    }
    // guide.techfleet.org / handbook / other: host + last non-empty path segment.
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1]?.replace(/[-_]/g, " ").replace(/\.md$/, "");
    return last ? `${u.hostname} · ${last}` : u.hostname + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Drop exact-duplicate URLs, preserving order. */
export function dedupeSources(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u === "string" && u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
