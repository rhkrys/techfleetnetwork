// Deterministic backbone of hand-off generation (Phase B2). PURE — no I/O, no LLM.
// Given the SPF handoff-deliverables-map components (each carrying the 5-part story arc + the
// four audience flags) it decides, per audience, WHICH components appear and in WHAT order.
// The LLM writer agents then fill prose per included component from that project's submissions;
// this module owns the structure (one shared layout, filtered + ordered per audience), so the
// section-selection is testable and never left to the model.

export const HANDOFF_AUDIENCES = [
  "client",
  "teammate",
  "teammate_case_study",
  "org_case_study",
] as const;
export type HandoffAudience = (typeof HANDOFF_AUDIENCES)[number];

/** Audience -> the SPF map flag field that governs inclusion. */
const FLAG_FIELD: Record<HandoffAudience, string> = {
  client: "Is this in the Client Hand-Off?",
  teammate: "Is this in the Teammate Hand-off?",
  teammate_case_study: "Is this in the Teammate Case Study?",
  org_case_study: "Is this in the Tech Fleet Org Case Study?",
};

/** The fixed 5-part story arc, in render order. */
export const STORY_ARC_ORDER = [
  "Pre-amble",
  "Part 1: Empathy Building",
  "Part 2: The Journey",
  "Part 3: The outcomes",
  "Part 4: The Sequel",
] as const;

export const AUDIENCE_TITLE: Record<HandoffAudience, string> = {
  client: "Client Hand-Off",
  teammate: "Teammate Hand-Off",
  teammate_case_study: "Teammate Case Study",
  org_case_study: "Tech Fleet Org Case Study",
};

/** One SPF handoff-deliverables-map component (the fields this module reads). */
export type HandoffComponent = Record<string, unknown> & {
  slug: string;
  "Hand-Off Story Arc": string;
  Component: string;
};

export type OutlineComponent = {
  slug: string;
  component: string;
  storyArc: string;
  /** No linked deliverable in the map => a direct team-input component (typed text, not upload). */
  directInput: boolean;
  /** Framework deliverables this component's information comes from (map links). */
  deliverables: { slug: string; label: string }[];
};

function extractRefs(v: unknown): { slug: string; label: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (r) => r && typeof r === "object" && typeof (r as { label?: unknown }).label === "string"
    )
    .map((r) => ({
      slug: String((r as { slug?: unknown }).slug ?? ""),
      label: String((r as { label: string }).label),
    }));
}

export type ArcSection = { arc: string; components: OutlineComponent[] };
export type VersionOutline = {
  audience: HandoffAudience;
  title: string;
  sections: ArcSection[];
  includedCount: number;
};

function isYes(v: unknown): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "yes";
}

function isDirectInput(rec: HandoffComponent): boolean {
  const d = rec["From Which Deliverable Does This Information Come?"];
  return !(Array.isArray(d) && d.length > 0);
}

/** Included in `audience` iff its flag is "Yes". */
export function isIncluded(rec: HandoffComponent, audience: HandoffAudience): boolean {
  return isYes(rec[FLAG_FIELD[audience]]);
}

/** Build one audience version's outline: included components grouped into the 5 arcs, in order. */
export function buildVersionOutline(
  audience: HandoffAudience,
  components: HandoffComponent[]
): VersionOutline {
  const included = components
    .filter((c) => isIncluded(c, audience))
    .map<OutlineComponent>((c) => ({
      slug: c.slug,
      component: String(c.Component ?? c.slug),
      storyArc: String(c["Hand-Off Story Arc"] ?? ""),
      directInput: isDirectInput(c),
      deliverables: extractRefs(c["From Which Deliverable Does This Information Come?"]),
    }));

  const sections: ArcSection[] = STORY_ARC_ORDER.map((arc) => ({
    arc,
    components: included.filter((c) => c.storyArc === arc),
  })).filter((s) => s.components.length > 0);

  return {
    audience,
    title: AUDIENCE_TITLE[audience],
    sections,
    includedCount: included.length,
  };
}

/** Build all four audience outlines from the shared component set. */
export function buildAllVersionOutlines(components: HandoffComponent[]): VersionOutline[] {
  return HANDOFF_AUDIENCES.map((a) => buildVersionOutline(a, components));
}

/** Writer output for ONE mapping component (keyed by slug). The renderer places it under its
 *  arc + component subheading, per the deliverables-mapping layout. */
export type WrittenComponent = { slug: string; markdown: string };

/** A link to the actual submitted deliverable (e.g., the exact node in the uploaded Figma/FigJam
 *  file the teammate pasted). Keyed by component slug in the renderers' `links` map. */
export type DeliverableLink = { label: string; url: string };

function dedupeLinks(links: DeliverableLink[]): DeliverableLink[] {
  const seen = new Set<string>();
  const out: DeliverableLink[] = [];
  for (const l of links)
    if (l.url && !seen.has(l.url)) {
      seen.add(l.url);
      out.push(l);
    }
  return out;
}

/** Writer agents sometimes repeat the component/arc name as a leading `## heading`; the renderer
 *  emits the heading itself, so strip a single leading markdown heading line to avoid duplicates. */
export function stripLeadingHeading(markdown: string): string {
  return markdown.replace(/^\s*#{1,6}[ \t]+[^\n]*\r?\n+/, "");
}

/** Brand voice hard rule: NO em dashes or en dashes (U+2014 / U+2013). Replace with a comma so
 *  the copy reads like a person wrote it. Only touches those two characters (not the hyphen-minus
 *  used in URLs/node ids), so it is safe to apply to the whole rendered output. Idempotent. */
export function noEmDash(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ", ");
}

/** Brand voice hard rule (superset of noEmDash): make the copy read as plain, human-typed text.
 *  Strips the AI-typography tells that leak from some models, curly quotes/apostrophes and the
 *  non-breaking hyphen, down to ASCII, on top of the em/en-dash rule. Leaves the hyphen-minus in
 *  URLs/node ids untouched. Idempotent, so it is safe to apply to the whole rendered document. */
export function normalizeTypography(s: string): string {
  return noEmDash(s)
    .replace(/[‘’‚‛]/g, "'") // ' ' ‚ ‛ -> '
    .replace(/[“”„‟]/g, '"') // " " „ ‟ -> "
    .replace(/‑/g, "-"); // non-breaking hyphen -> hyphen-minus
}

/**
 * PURE: render the final Markdown document for one version from its outline + the writer's
 * per-arc prose, in the fixed story-arc order. Missing arcs are skipped; an arc the outline
 * expects but the writer didn't return gets an honest placeholder (never fabricated).
 */
export type RenderMeta = {
  projectName?: string;
  phase?: string;
  generatedLabel?: string;
  milestones?: string[];
};

/** Union of deliverable labels, order-preserving + de-duped. */
export function uniqueLabels(refs: { slug: string; label: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs)
    if (r.label && !seen.has(r.label)) {
      seen.add(r.label);
      out.push(r.label);
    }
  return out;
}

/**
 * Render the shared hand-off layout (deliverables-mapping format): title, the top-matter
 * (Milestones worked, Deliverables we iterated on), then each story arc with ITS COMPONENTS as
 * subheadings and a "Links to deliverables" list. Missing component prose gets an honest
 * "Awaiting content." placeholder — never fabricated.
 */
export function renderVersionMarkdown(
  outline: VersionOutline,
  written: WrittenComponent[],
  meta: RenderMeta = {},
  links?: Map<string, DeliverableLink[]>
): string {
  const bySlug = new Map(
    written.map((w) => [
      w.slug,
      normalizeTypography(stripLeadingHeading((w.markdown ?? "").trim()).trim()),
    ])
  );
  const lines: string[] = [];

  lines.push(`# ${outline.title}`);
  const sub = [meta.projectName, meta.phase ? `phase ${meta.phase}` : null]
    .filter(Boolean)
    .join(" — ");
  if (sub) lines.push(`_${sub}_`);
  if (meta.generatedLabel) lines.push(`_${meta.generatedLabel}_`);
  lines.push("");

  // ── Top matter ──
  lines.push("## Milestones worked");
  lines.push(
    meta.milestones?.length
      ? meta.milestones.map((m) => `- ${m}`).join("\n")
      : "_From the project phase definition._"
  );
  lines.push("");
  lines.push("## Deliverables we iterated on");
  // ONLY what the team actually provided (submitted links/files), never the framework catalog.
  const allProvided = dedupeLinks([...(links?.values() ?? [])].flat());
  lines.push(
    allProvided.length
      ? allProvided.map((l) => `- [${l.label}](${l.url})`).join("\n")
      : "_The deliverables the team uploaded for this hand-off._"
  );
  lines.push("");

  // ── Arcs → component subheadings → links ──
  for (const sec of outline.sections) {
    lines.push(`## ${sec.arc}`);
    for (const comp of sec.components) {
      lines.push(`### ${comp.component}`);
      const body = bySlug.get(comp.slug) ?? "";
      lines.push(body.length ? body : "_Awaiting content._");
      lines.push("");
    }
    // ONLY the deep-links to the work the team actually provided for this arc. The framework's
    // catalog of *possible* deliverables is intentionally NOT listed (it implied work never done).
    const provided = dedupeLinks(sec.components.flatMap((c) => links?.get(c.slug) ?? []));
    if (provided.length) {
      lines.push("**Links to deliverables:**");
      lines.push(provided.map((l) => `- [${l.label}](${l.url})`).join("\n"));
      lines.push("");
    }
  }
  return normalizeTypography(lines.join("\n").trimEnd()) + "\n";
}
