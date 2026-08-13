// PURE, framework-neutral renderer: a produced hand-off version -> a self-contained, on-brand,
// print-optimized HTML document. This is the "PDF" path (browser print -> Save as PDF: a real
// layout engine, Tech Fleet styling, no headless browser, no new dependency). Usable from the
// edge function OR the browser download button.
//
// SECURITY: the section prose is LLM output (untrusted) -> everything dynamic is HTML-escaped
// before insertion. Only a tiny, safe subset of markdown (paragraphs, bullet lists, **bold**)
// is turned into markup, applied AFTER escaping, so no raw HTML/script from the model survives.
import {
  type DeliverableLink,
  normalizeTypography,
  stripLeadingHeading,
  type RenderMeta,
  type VersionOutline,
  type WrittenComponent,
} from "./assemble.ts";

/** Only allow http(s) hrefs (submission URLs are user-provided); returns "" otherwise. */
function safeHref(raw: string): string {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? escapeHtml(u.toString()) : "";
  } catch {
    return "";
  }
}

// Tech Fleet brand tokens (decision 20). Futura PT / Poppins are brand fonts; we fall back to a
// safe system stack (print-to-PDF can't fetch external fonts reliably, and CSP forbids it).
const BRAND_CSS = `
:root{--tf-blue:#0056A7;--tf-green:#56A045;--tf-orange:#EB4F26;--ink:#1a2230;--muted:#5b6b7f;}
*{box-sizing:border-box;}
body{font-family:'Poppins',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);line-height:1.6;max-width:8.5in;margin:0 auto;padding:0.75in;}
h1{font-family:'Futura PT','Poppins',sans-serif;color:var(--tf-blue);font-size:28px;margin:0 0 4px;}
h2{font-family:'Futura PT','Poppins',sans-serif;color:var(--tf-blue);font-size:20px;margin:28px 0 8px;border-bottom:2px solid var(--tf-green);padding-bottom:4px;}
h3{font-family:'Futura PT','Poppins',sans-serif;color:var(--ink);font-size:15px;margin:16px 0 4px;}
.subtitle{color:var(--muted);font-size:13px;margin:0 0 24px;}
.links{margin-top:12px;}
.placeholder{color:var(--muted);font-style:italic;}
ul,ol{margin:8px 0 8px 20px;}
a{color:var(--tf-blue);}
@page{margin:0.75in;}
@media print{body{padding:0;}h2{break-after:avoid;}}
`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Minimal, SAFE markdown-ish -> HTML: run AFTER escaping. Handles blank-line paragraphs,
 *  `- `/`* ` bullet lists, `1.` ordered lists, and **bold**. Anything else stays as escaped text. */
function proseToHtml(markdown: string): string {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());
    const isBullet = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l));
    const isNumbered = lines.length > 0 && lines.every((l) => /^\d+\.\s+/.test(l));
    if (isBullet) {
      const items = lines
        .map((l) => `<li>${inline(escapeHtml(l.replace(/^[-*]\s+/, "")))}</li>`)
        .join("");
      out.push(`<ul>${items}</ul>`);
    } else if (isNumbered) {
      const items = lines
        .map((l) => `<li>${inline(escapeHtml(l.replace(/^\d+\.\s+/, "")))}</li>`)
        .join("");
      out.push(`<ol>${items}</ol>`);
    } else {
      out.push(`<p>${inline(escapeHtml(block)).replace(/\n/g, "<br>")}</p>`);
    }
  }
  return out.join("\n");
}

// **bold** only, on already-escaped text (no raw HTML can appear here).
function inline(escaped: string): string {
  return escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function renderVersionHtml(
  outline: VersionOutline,
  written: WrittenComponent[],
  meta: RenderMeta = {},
  linkMap?: Map<string, DeliverableLink[]>
): string {
  const bySlug = new Map(
    written.map((w) => [
      w.slug,
      normalizeTypography(stripLeadingHeading((w.markdown ?? "").trim()).trim()),
    ])
  );
  const subtitleParts = [meta.projectName, meta.phase ? `phase ${escapeHtml(meta.phase)}` : null]
    .filter(Boolean)
    .map((p) => escapeHtml(String(p)));

  const ul = (items: string[]) =>
    `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
  const linkList = (ls: DeliverableLink[]) =>
    `<ul>${ls
      .map((l) => {
        const href = safeHref(l.url);
        return `<li>${href ? `<a href="${href}">${escapeHtml(l.label)}</a>` : escapeHtml(l.label)}</li>`;
      })
      .join("")}</ul>`;
  const dedupe = (ls: DeliverableLink[]) => {
    const seen = new Set<string>();
    return ls.filter((l) => l.url && !seen.has(l.url) && (seen.add(l.url), true));
  };

  const milestonesHtml = meta.milestones?.length
    ? ul(meta.milestones)
    : `<p class="placeholder">From the project phase definition.</p>`;
  // ONLY what the team actually provided (real submitted links), never the framework catalog.
  const allProvided = dedupe([...(linkMap?.values() ?? [])].flat());
  const iteratedHtml = allProvided.length
    ? linkList(allProvided)
    : `<p class="placeholder">The deliverables the team uploaded for this hand-off.</p>`;

  const sectionsHtml = outline.sections
    .map((sec) => {
      const comps = sec.components
        .map((comp) => {
          const body = bySlug.get(comp.slug) ?? "";
          const inner = body.length
            ? proseToHtml(body)
            : `<p class="placeholder">Awaiting content.</p>`;
          return `<h3>${escapeHtml(comp.component)}</h3>\n${inner}`;
        })
        .join("\n");
      // ONLY the links the team actually provided for this arc (no framework catalog).
      const deduped = dedupe(sec.components.flatMap((c) => linkMap?.get(c.slug) ?? []));
      const linksHtml = deduped.length
        ? `<p class="links"><strong>Links to deliverables:</strong></p>${linkList(deduped)}`
        : "";
      return `<h2>${escapeHtml(sec.arc)}</h2>\n${comps}\n${linksHtml}`;
    })
    .join("\n");

  // The document is fully self-contained: inline styles, no scripts, no remote resources. A strict
  // CSP is defense-in-depth on top of escapeHtml/safeHref — it forbids any script execution and any
  // network fetch, so even if an escaping gap ever slipped through, injected markup could not run or
  // exfiltrate. `style-src 'unsafe-inline'` is required only for the single inline <style> block.
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  const doc = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(outline.title)}</title>
<style>${BRAND_CSS}</style>
</head><body>
<h1>${escapeHtml(outline.title)}</h1>
${subtitleParts.length ? `<p class="subtitle">${subtitleParts.join(" &middot; ")}</p>` : ""}
${meta.generatedLabel ? `<p class="subtitle">${escapeHtml(meta.generatedLabel)}</p>` : ""}
<h2>Milestones worked</h2>
${milestonesHtml}
<h2>Deliverables we iterated on</h2>
${iteratedHtml}
${sectionsHtml}
</body></html>
`;
  return normalizeTypography(doc); // hard voice rule: no em/en dashes or AI-typography tells reach the reader
}
