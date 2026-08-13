// Per-arc writer orchestration (Phase B2 resilience). PURE — no I/O, no LLM; the actual model call
// is injected as `writeArc` so this is unit-testable.
//
// WHY THIS EXISTS: the writer used to render a whole audience version (all included components) in
// ONE structured model response. That is the single point of failure we hit in testing: a large
// forced-tool / json-schema response (a) truncates when a reasoning model spends its output budget
// before finishing the tool call (whole version comes back empty), and (b) makes some providers
// return no structured output at all on the oversized schema. Both fail the ENTIRE version at once.
//
// THE FIX: write ONE story arc per call (~5 components, a small bounded response). Each arc is
// independent, so a failure is isolated to that arc — its components fall back to the renderer's
// honest "Awaiting content." placeholder instead of blanking the whole hand-off. Nothing is
// fabricated and no failure is silent: failed arcs are returned so the caller can log them.
import type { ComponentFactBase } from "./prompts.ts";
import type { HandoffAudience, VersionOutline, WrittenComponent } from "./assemble.ts";

/** Writes ONE arc's components. Injected so the orchestration is testable without a live model.
 *  `arcOutline` is the full version outline narrowed to a single section. */
export type ArcWriter = (
  audience: HandoffAudience,
  arcOutline: VersionOutline,
  arcFacts: ComponentFactBase[]
) => Promise<WrittenComponent[]>;

export type WriteVersionResult = { written: WrittenComponent[]; failedArcs: string[] };

/**
 * Write an audience version arc-by-arc. Each story arc is a separate `writeArc` call over a
 * single-section outline and only that arc's facts, so the response stays small and one arc's
 * failure never blanks the others. Returns every component any arc produced (foreign slugs a model
 * might echo are dropped) plus the names of arcs that threw, so the caller logs the degradation.
 */
export async function writeVersionPerArc(
  audience: HandoffAudience,
  outline: VersionOutline,
  factBase: ComponentFactBase[],
  writeArc: ArcWriter,
  onArcError?: (arc: string, err: unknown) => void
): Promise<WriteVersionResult> {
  const written: WrittenComponent[] = [];
  const failedArcs: string[] = [];

  for (const section of outline.sections) {
    const arcSlugs = new Set(section.components.map((c) => c.slug));
    const arcOutline: VersionOutline = { ...outline, sections: [section] };
    const arcFacts = factBase.filter((f) => arcSlugs.has(f.slug));
    try {
      const produced = await writeArc(audience, arcOutline, arcFacts);
      // Keep only components that belong to THIS arc — a model may echo a slug from another arc.
      for (const w of produced) {
        if (arcSlugs.has(w.slug)) written.push({ slug: w.slug, markdown: w.markdown });
      }
    } catch (err) {
      failedArcs.push(section.arc);
      onArcError?.(section.arc, err);
    }
  }

  return { written, failedArcs };
}
