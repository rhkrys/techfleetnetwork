// Pure, testable core of guide-ingest (no I/O — index.ts does the fetch/DB work).
// Kept separate so the SSRF guard + the llms.txt parser are unit-tested in CI's
// deno-check job with no network. Replaces the retired Firecrawl scrape path (PRD
// D-02/D-04): the guide is Tech Fleet's own site, discovered via its published
// llms.txt index and fetched as Markdown (append .md to any page URL).

export const GUIDE_HOST = "guide.techfleet.org";
export const GUIDE_ORIGIN = `https://${GUIDE_HOST}`;
export const GUIDE_LLMS_TXT = `${GUIDE_ORIGIN}/llms.txt`;

/** A page discovered in llms.txt. */
export type GuidePage = { title: string; url: string };

/**
 * SSRF guard (mirrors spf-sync): allow ONLY https to the pinned guide host.
 * Throws otherwise; the caller must also disable redirect-following
 * (redirect: "error") so a 30x can't bounce us off-host.
 */
export function assertGuideUrlAllowed(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`SSRF: invalid guide URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new Error(`SSRF: guide fetch must be https (${u.protocol})`);
  if (u.hostname !== GUIDE_HOST) throw new Error(`SSRF: guide host not allowed: ${u.hostname}`);
}

/** Absolute-ize a possibly-relative link from llms.txt against the guide origin. */
function toAbsolute(href: string): string | null {
  try {
    // Relative ("/foo") resolves against the origin; absolute stays as-is.
    const u = new URL(href, GUIDE_ORIGIN);
    if (u.protocol !== "https:") return null;
    if (u.hostname !== GUIDE_HOST) return null; // drop off-host links (youtube, figma, etc.)
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** The Markdown URL for a guide page: strip trailing slash, append .md if absent. */
export function markdownUrlFor(pageUrl: string): string {
  const u = new URL(pageUrl);
  let p = u.pathname.replace(/\/+$/, "");
  if (p === "") p = "/"; // root
  if (!p.endsWith(".md")) p = `${p}.md`;
  u.pathname = p;
  return u.toString();
}

/**
 * Parse an llms.txt into a deduped list of on-host guide pages.
 * Handles the standard `[Title](URL): description` line form (and bare
 * `[Title](URL)`). Off-host links, the llms.txt itself, and non-http links are
 * dropped. Order is preserved (first occurrence wins for a given URL).
 */
export function parseLlmsTxt(text: string): GuidePage[] {
  const seen = new Set<string>();
  const out: GuidePage[] = [];
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const line of text.split("\n")) {
    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      const title = m[1].trim();
      const abs = toAbsolute(m[2].trim());
      if (!abs) continue;
      // Skip the index file itself and asset/file links.
      if (abs === GUIDE_LLMS_TXT) continue;
      if (/\/files\//.test(new URL(abs).pathname)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ title: title || abs, url: abs });
    }
  }
  return out;
}
