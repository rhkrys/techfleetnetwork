/**
 * linkifyHtml — auto-hyperlink bare URLs, www domains, and email addresses
 * inside an HTML string, while preserving existing <a> anchors and never
 * touching text inside tag attributes.
 *
 * Safe-by-design:
 *  - Operates only on text nodes (skips content between < and >).
 *  - Skips entire <a>...</a> blocks so already-linked text is untouched.
 *  - Generates anchors with href, target="_blank", rel="noopener noreferrer nofollow"
 *    for http(s)/www, and mailto: for emails.
 *  - HTML-escapes the visible text and the href value to prevent injection;
 *    output is intended to be passed through DOMPurify (sanitizeHtml) before
 *    rendering.
 */

// URL: http(s)://... OR www....   (stops at whitespace and common HTML chars)
const URL_RE =
  /\b((?:https?:\/\/|www\.)[^\s<>"'()]+[^\s<>"'(),.;:!?])/gi;
// Email
const EMAIL_RE = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;

function escapeHtml(s: string): string {
  return s
    // Don't re-encode existing named/numeric entities (e.g. &amp;, &#39;, &#x27;)
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function linkifyTextNode(text: string): string {
  // First emails, then URLs — replace each match with a placeholder-free anchor.
  // Build the result by walking matches in order across both regexes.
  type Match = { start: number; end: number; html: string };
  const matches: Match[] = [];

  const collect = (re: RegExp, build: (m: string) => string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, html: build(m[0]) });
    }
  };

  collect(URL_RE, (raw) => {
    const href = raw.startsWith("www.") ? `https://${raw}` : raw;
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(raw)}</a>`;
  });
  collect(EMAIL_RE, (raw) =>
    `<a href="mailto:${escapeAttr(raw)}">${escapeHtml(raw)}</a>`,
  );

  if (matches.length === 0) return escapeHtml(text);

  // Sort and drop overlaps (URL wins over email if they overlap).
  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  const filtered: Match[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  let out = "";
  let cursor = 0;
  for (const m of filtered) {
    out += escapeHtml(text.slice(cursor, m.start));
    out += m.html;
    cursor = m.end;
  }
  out += escapeHtml(text.slice(cursor));
  return out;
}

export function linkifyHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";
  // Walk the string; segments alternate between text and tags. Inside an open
  // <a ...> ... </a> block, do not linkify text content.
  let i = 0;
  let out = "";
  let inAnchor = 0; // depth counter for nested-safety
  const len = html.length;

  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      const rest = html.slice(i);
      out += inAnchor > 0 ? rest : linkifyTextNode(rest);
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      out += inAnchor > 0 ? text : linkifyTextNode(text);
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      // malformed — emit the rest verbatim
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    out += tag;
    // Track <a> depth (case-insensitive). Self-closing <a/> is unusual; ignore.
    if (/^<a\b/i.test(tag)) inAnchor++;
    else if (/^<\/a\s*>/i.test(tag) && inAnchor > 0) inAnchor--;
    i = gt + 1;
  }

  return out;
}
