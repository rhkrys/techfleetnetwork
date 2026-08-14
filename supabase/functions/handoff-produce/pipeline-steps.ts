// Resumable step machine for the hand-off pipeline (Phase B2, durable async).
//
// WHY: a full run is extraction (per component) + writing (per audience x story arc) + finalize
// (render + store per audience) — far more work than one edge invocation can safely hold. If the
// invocation is recycled mid-run, the work must RESUME, not restart. So the pipeline is modelled as
// an ordered list of small UNITS with a persisted cursor + accumulated state (fact base, written
// prose). A worker advances the cursor one unit at a time, CHECKPOINTS after each, and can stop at
// any point (budget hit, lease lost); the next worker tick reloads the state and continues from the
// cursor. This module is PURE: the side effects (LLM calls, storage writes) are injected, so the
// resume/stop/ordering logic is unit-tested with fakes — no DB, no network.
import type { ComponentFactBase } from "./prompts.ts";
import {
  buildVersionOutline,
  HANDOFF_AUDIENCES,
  type HandoffAudience,
  type HandoffComponent,
  type VersionOutline,
  type WrittenComponent,
} from "./assemble.ts";

/** One ingest unit: fetch ONE external source (a Figma file's nodes) and add its text as material.
 *  Ingest runs BEFORE extract as checkpointed units so no single tick does the whole external load —
 *  fetching many boards inline (pre-checkpoint) is what killed the worker on a ~30-board run. */
export type FigmaFile = { fileKey: string; nodeIds: string[] };
/** One writer unit: a single story arc of a single audience version (a small, bounded LLM call). */
export type WriteUnit = { audience: HandoffAudience; outline: VersionOutline; arcIndex: number };
/** One finalize unit: render + store the documents for a single audience version. */
export type FinalizeUnit = { audience: HandoffAudience; outline: VersionOutline };

/** The ordered plan of every unit in a run, derived PURELY from the SPF components. */
export type RunPlan = {
  ingest: FigmaFile[]; // one unit per external Figma file (checkpointed source acquisition)
  extract: HandoffComponent[]; // one unit per component
  write: WriteUnit[]; // one unit per (audience, arc)
  finalize: FinalizeUnit[]; // one unit per audience
};

export type Cursor =
  | { stage: "ingest"; i: number }
  | { stage: "extract"; i: number }
  | { stage: "write"; i: number }
  | { stage: "finalize"; i: number }
  | { stage: "done" };

/** The full resumable state of a run — persisted between worker ticks. Ingested MATERIAL is NOT
 *  held here: it is written durably to handoff_deliverable_submissions.extracted_text (ADR-0006) and
 *  rebuilt into the extractor's in-memory view by loadRunContext each tick, so this state stays small. */
export type PipelineState = {
  cursor: Cursor;
  factBase: ComponentFactBase[]; // accumulates during the extract stage
  written: Record<string, WrittenComponent[]>; // accumulates during the write stage, keyed by audience
};

/** Injected side effects. Each returns quickly for one unit; the machine owns ordering + resume. */
export type StepEffects = {
  // Fetch ONE Figma file's node text and persist it (extracted_text on each of its submissions) +
  // make it visible to this run's extractor. Side-effecting; returns nothing (material is durable).
  ingestFigma: (file: FigmaFile) => Promise<void>;
  extractFacts: (component: HandoffComponent) => Promise<ComponentFactBase>;
  writeArc: (unit: WriteUnit, arcFacts: ComponentFactBase[]) => Promise<WrittenComponent[]>;
  finalize: (unit: FinalizeUnit, written: WrittenComponent[]) => Promise<void>;
};

/**
 * PURE: the ordered unit plan for a run. Audiences with no included components are skipped.
 * `only` scopes a targeted re-create to a subset of the four versions (writer-only retry); when
 * omitted the plan covers all audiences (a full production). The extract stage is unaffected —
 * extraction is per-component, shared across audiences.
 */
export function buildRunPlan(
  components: HandoffComponent[],
  ingest: FigmaFile[],
  only?: readonly HandoffAudience[]
): RunPlan {
  const wanted = only && only.length ? new Set(only) : null;
  const write: WriteUnit[] = [];
  const finalize: FinalizeUnit[] = [];
  for (const audience of HANDOFF_AUDIENCES as readonly HandoffAudience[]) {
    if (wanted && !wanted.has(audience)) continue;
    const outline = buildVersionOutline(audience, components);
    if (!outline.sections.length) continue;
    finalize.push({ audience, outline });
    outline.sections.forEach((_, arcIndex) => write.push({ audience, outline, arcIndex }));
  }
  // A writer-only re-create passes no ingest (it reuses the persisted fact base + extracted_text).
  return { ingest: wanted ? [] : ingest, extract: components, write, finalize };
}

/** PURE: the cursor a writer-only run starts at — straight to writing, skipping ingest + extraction. */
export function firstWriteCursor(plan: RunPlan): Cursor {
  if (plan.write.length) return { stage: "write", i: 0 };
  if (plan.finalize.length) return { stage: "finalize", i: 0 };
  return { stage: "done" };
}

/** PURE: the cursor a fresh FULL run starts at — the first non-empty stage (ingest, then extract). */
export function firstCursor(plan: RunPlan): Cursor {
  if (plan.ingest.length) return { stage: "ingest", i: 0 };
  if (plan.extract.length) return { stage: "extract", i: 0 };
  return firstWriteCursor(plan);
}

export function initialState(): PipelineState {
  return { cursor: { stage: "extract", i: 0 }, factBase: [], written: {} };
}

/** The slugs a write unit is responsible for (its arc's components). */
export function arcSlugs(unit: WriteUnit): Set<string> {
  return new Set(unit.outline.sections[unit.arcIndex].components.map((c) => c.slug));
}

// Cursor advance helpers: move to the next unit, or to the next non-empty stage, or done.
function afterIngest(plan: RunPlan, i: number): Cursor {
  if (i + 1 < plan.ingest.length) return { stage: "ingest", i: i + 1 };
  if (plan.extract.length) return { stage: "extract", i: 0 };
  if (plan.write.length) return { stage: "write", i: 0 };
  if (plan.finalize.length) return { stage: "finalize", i: 0 };
  return { stage: "done" };
}
function afterExtract(plan: RunPlan, i: number): Cursor {
  if (i + 1 < plan.extract.length) return { stage: "extract", i: i + 1 };
  if (plan.write.length) return { stage: "write", i: 0 };
  if (plan.finalize.length) return { stage: "finalize", i: 0 };
  return { stage: "done" };
}
function afterWrite(plan: RunPlan, i: number): Cursor {
  if (i + 1 < plan.write.length) return { stage: "write", i: i + 1 };
  if (plan.finalize.length) return { stage: "finalize", i: 0 };
  return { stage: "done" };
}
function afterFinalize(plan: RunPlan, i: number): Cursor {
  if (i + 1 < plan.finalize.length) return { stage: "finalize", i: i + 1 };
  return { stage: "done" };
}

/** Perform exactly ONE unit and return the new state. Never mutates its input. */
export async function stepOnce(
  state: PipelineState,
  plan: RunPlan,
  eff: StepEffects
): Promise<PipelineState> {
  const c = state.cursor;
  if (c.stage === "ingest") {
    await eff.ingestFigma(plan.ingest[c.i]); // persists extracted_text durably + feeds this extractor
    return { ...state, cursor: afterIngest(plan, c.i) };
  }
  if (c.stage === "extract") {
    const facts = await eff.extractFacts(plan.extract[c.i]);
    return { ...state, factBase: [...state.factBase, facts], cursor: afterExtract(plan, c.i) };
  }
  if (c.stage === "write") {
    const unit = plan.write[c.i];
    const slugs = arcSlugs(unit);
    const arcFacts = state.factBase.filter((f) => slugs.has(f.slug));
    const produced = await eff.writeArc(unit, arcFacts);
    const prev = state.written[unit.audience] ?? [];
    // Keep only components that belong to this arc (a model may echo a foreign slug).
    const merged = [
      ...prev,
      ...produced
        .filter((w) => slugs.has(w.slug))
        .map((w) => ({ slug: w.slug, markdown: w.markdown })),
    ];
    return {
      ...state,
      written: { ...state.written, [unit.audience]: merged },
      cursor: afterWrite(plan, c.i),
    };
  }
  if (c.stage === "finalize") {
    const unit = plan.finalize[c.i];
    await eff.finalize(unit, state.written[unit.audience] ?? []);
    return { ...state, cursor: afterFinalize(plan, c.i) };
  }
  return state; // done
}

/**
 * PURE: the story-arc components that shipped (or would ship) as "_Awaiting content._" — i.e. an
 * outline component with no non-empty written prose. Mirrors the renderer's placeholder condition
 * EXACTLY (assemble.ts renders a component with empty/absent markdown as the placeholder), so a
 * finalized run's gap count equals the number of visible "Awaiting content" sections a reader sees.
 * A run with total > 0 completed WITH gaps (a writer arc degraded) — it is not a clean hand-off.
 */
export function runGaps(
  plan: RunPlan,
  state: PipelineState
): { total: number; byAudience: Record<string, number> } {
  const byAudience: Record<string, number> = {};
  let total = 0;
  for (const unit of plan.finalize) {
    const filled = new Set(
      (state.written[unit.audience] ?? [])
        .filter((w) => (w.markdown ?? "").trim().length > 0)
        .map((w) => w.slug)
    );
    let missing = 0;
    for (const sec of unit.outline.sections)
      for (const comp of sec.components) if (!filled.has(comp.slug)) missing++;
    if (missing > 0) {
      byAudience[unit.audience] = missing;
      total += missing;
    }
  }
  return { total, byAudience };
}

export type DriveStop = "done" | "budget" | "lost-lease";

/**
 * Drive a run from `state` toward completion, one unit at a time. Between units:
 *  - `shouldContinue()` is checked BEFORE each unit — false => stop early (return "budget"); the
 *    worker uses this for its soft time budget so it returns before the invocation limit.
 *  - `checkpoint(state)` persists progress AFTER each unit and returns whether this worker still
 *    holds the lease — false => another worker took over (return "lost-lease"), stop immediately.
 * Resuming is just calling driveRun again with the persisted state: completed units are behind the
 * cursor and never re-run.
 */
export async function driveRun(
  state: PipelineState,
  plan: RunPlan,
  eff: StepEffects,
  hooks: { shouldContinue: () => boolean; checkpoint: (s: PipelineState) => Promise<boolean> }
): Promise<{ state: PipelineState; stopped: DriveStop }> {
  let s = state;
  while (s.cursor.stage !== "done") {
    if (!hooks.shouldContinue()) return { state: s, stopped: "budget" };
    s = await stepOnce(s, plan, eff);
    const stillOwned = await hooks.checkpoint(s);
    if (!stillOwned) return { state: s, stopped: "lost-lease" };
  }
  return { state: s, stopped: "done" };
}
