/**
 * Safely strip HTML tags and return plain text.
 * Uses a shared DOMParser to avoid creating throwaway DOM elements.
 */
const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;

export function stripHtml(html: string): string {
  if (!html) return "";
  const normalized = normalizeRichTextHtml(html);
  // No-DOM fallback (non-browser SSR): drop script/style bodies first, then
  // remaining tags. The DOM path below is preferred and used in browsers/tests.
  if (!parser) {
    // codeql[js/incomplete-multi-character-sanitization] - SSR fallback only;
    // result is plain text (textContent), never used as an HTML sink.
    return normalized
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<[^>]*>/g, "");
  }
  const doc = parser.parseFromString(normalized, "text/html");
  return doc.body.textContent || "";
}

/**
 * Normalize rich-text HTML coming out of editors / pasted from Word/Google Docs.
 *
 * Two real-world failures this fixes:
 *  1. **Double-escaped entities** — `&amp;nbsp;` was rendering literal
 *     "&nbsp;" text in announcements. Decoded back to a real space.
 *  2. **&nbsp; word-glue** — every word separated by non-breaking spaces
 *     prevents normal line wrap and looks jumbled. Replaced with regular
 *     spaces so the browser can break lines.
 *
 * Idempotent and safe to apply on save and on render.
 */
export function normalizeRichTextHtml(html: string | null | undefined): string {
  if (!html) return "";
  return (
    html
      // Step 1: undo double-escaping for the entities we care about.
      .replace(/&amp;nbsp;/gi, " ")
      .replace(/&amp;#39;/gi, "'")
      .replace(/&amp;quot;/gi, '"')
      .replace(/&amp;amp;/gi, "&amp;")
      // Step 2: collapse non-breaking spaces (entity + literal U+00A0) to
      // regular spaces so wrapping works.
      .replace(/&nbsp;/gi, " ")
      .replace(/\u00a0/g, " ")
      // Step 3: collapse runs of plain spaces/tabs (but preserve newlines).
      .replace(/[ \t]{2,}/g, " ")
  );
}
