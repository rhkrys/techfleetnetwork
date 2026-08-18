// Turn internal knowledge_base URLs into user-facing links for the Discord /fleety bot.
//
// SPF-derived KB rows are keyed by an INTERNAL identifier — framework://entity/<table>/<id> — where
// <id> is the framework entity's UUID (used by fleety-embed for resync, never meant for humans). If
// that string reaches Discord the user gets an un-clickable "framework://entity/skills/ff0ec515-…".
// These helpers resolve that id → the public GitHub Pages explore page, matching the exact URL scheme
// the web Fleety 2.0 handler uses (techfleet-chat spfPageUrl). Pure + deterministic → unit-testable.

export const SPF_EXPLORE_BASE =
  "https://techfleetworks.github.io/skills-and-practices-framework/explore";

/** Public entity page on the SPF explore SPA. Same scheme as techfleet-chat's spfPageUrl. */
export const spfPageUrl = (type?: string, slug?: string): string | null =>
  type && slug ? `${SPF_EXPLORE_BASE}/?e=${encodeURIComponent(type)}#item/${slug}` : null;

/** Pull the entity UUID out of an internal framework://entity/<table>/<id> KB url; else null. */
export function frameworkEntityId(url: string): string | null {
  const m = /^framework:\/\/entity\/[^/]+\/([0-9a-fA-F-]{36})$/.exec(url ?? "");
  return m ? m[1] : null;
}

/**
 * Resolve a KB url for user display:
 *   framework://entity/<t>/<id>  → public explore page via the id→{entity_type,slug} map (from
 *                                  framework_entity_v, which follows the active source), or null if
 *                                  the id isn't resolvable (better no link than an internal one).
 *   csv:// / other framework://   → null (internal reference data; never a link).
 *   https / guide / Notion        → passthrough (already public).
 */
export function publicKbUrl(
  url: string | null | undefined,
  entityMap: Map<string, { entity_type: string; slug: string }>
): string | null {
  if (!url) return null;
  const id = frameworkEntityId(url);
  if (id) {
    const e = entityMap.get(id);
    return e ? spfPageUrl(e.entity_type, e.slug) : null;
  }
  if (url.startsWith("csv://") || url.startsWith("framework://")) return null;
  return url;
}

/** Belt-and-suspenders: strip any residual internal-scheme links the model may still have emitted. */
export function stripInternalLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:framework|csv):\/\/[^)]*\)/gi, "$1") // [label](internal) → label
    .replace(/\((?:framework|csv):\/\/[^)]*\)/gi, "") // (internal) trailing paren form
    .replace(/\b(?:framework|csv):\/\/\S+/gi, ""); // bare internal urls
}
