/**
 * Strip HTML tags from a string and collapse whitespace.
 * Use for preview/summary text where rich-text fields are shown as plain text.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  // Use the DOM parser so script/style bodies and entities are handled
  // correctly. `textContent` decodes entities (&amp; → &) for us and cannot be
  // bypassed the way a tag-stripping regex can (CodeQL
  // js/incomplete-multi-character-sanitization / js/bad-tag-filter). Fall back
  // to a best-effort regex only when no DOM is available (non-browser SSR);
  // the result is shown as plain text, never used as an HTML sink.
  let text: string;
  if (typeof DOMParser !== "undefined") {
    text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  } else {
    text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]+>/g, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}
