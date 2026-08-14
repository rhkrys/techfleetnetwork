// The hand-off generation pipeline (Phase B2). Orchestration over the model port + prompts +
// assembler + renderers, driven as a RESUMABLE step machine (pipeline-steps.ts) so a long run can
// be advanced incrementally by a durable worker and survive an edge-invocation recycle. All writes
// go through a service-role client. See handoff-produce/index.ts (enqueue front door) and
// handoff-worker/index.ts (the cron-driven worker that drives runs to completion).
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { scrub as dlpScrub } from "../_shared/dlp.ts";
import {
  generateStructured,
  resolveMechanicalModel,
  type UsageMeter,
} from "../_shared/llm/port.ts";
import { buildFactExtractionPrompt, buildWriterPrompt, type ComponentFactBase } from "./prompts.ts";
import { chunkText, dedupeFacts, mergeFacts, stripTemplateItems } from "./extract.ts";
import { formatSpfContext, loadSpfContext, toExtractionScope } from "./spf-context.ts";
import {
  buildVersionOutline,
  type DeliverableLink,
  type HandoffAudience,
  type HandoffComponent,
  renderVersionMarkdown,
  type WrittenComponent,
} from "./assemble.ts";
import { renderVersionHtml } from "./render-html.ts";
import { fetchNodesText, parseFigmaUrl } from "./figma.ts";
import {
  buildRunPlan,
  type DriveStop,
  driveRun,
  type FigmaFile,
  type FinalizeUnit,
  firstCursor,
  firstWriteCursor,
  type PipelineState,
  runGaps,
  type StepEffects,
  type WriteUnit,
} from "./pipeline-steps.ts";

const log = createEdgeLogger("handoff-produce");
const MAX_LLM_CALLS = 400; // per-invocation runaway guard (chunked extraction + per-arc writers)

// Soft cost meter: list $/token per model family (via OpenRouter). Used only to feed the shared
// fleety_cost_counters (SRE traffic/cost signal) under tier="handoff" — tune if a provider re-prices;
// never a correctness dependency. Unknown models price at 0 (metered as tokens, not dollars).
const LLM_PRICES: Array<{ match: RegExp; in: number; out: number }> = [
  { match: /opus/i, in: 5 / 1_000_000, out: 25 / 1_000_000 }, // Anthropic Claude Opus 4.8 (writer)
  { match: /deepseek/i, in: 0.08 / 1_000_000, out: 0.252 / 1_000_000 }, // DeepSeek v4 Flash (US-hosted)
];
function priceFor(model: string): { in: number; out: number } {
  return LLM_PRICES.find((p) => p.match.test(model)) ?? { in: 0, out: 0 };
}

/** Best-effort: fold one worker tick's accumulated LLM usage into the shared cost counters. Never
 *  throws — a cost-meter failure must not fail a hand-off run (matches techfleet-chat's posture). */
async function recordCost(
  svc: SvcClient,
  meter: Map<string, { tokensIn: number; tokensOut: number }>,
  requestId: string
): Promise<void> {
  for (const [model, { tokensIn, tokensOut }] of meter) {
    if (tokensIn === 0 && tokensOut === 0) continue;
    const p = priceFor(model);
    try {
      await svc.rpc("fleety_record_cost", {
        _model: model,
        _tier: "handoff",
        _tokens_in: tokensIn,
        _tokens_out: tokensOut,
        _est_usd: tokensIn * p.in + tokensOut * p.out,
        _cache_hit: false,
        _canned_hit: false,
      });
    } catch (e) {
      log.warn(
        "cost",
        `record_cost failed [${requestId}]: ${e instanceof Error ? e.message : String(e)}`,
        {
          requestId,
        }
      );
    }
  }
}
// A writer arc (esp. a reasoning model) can legitimately run ~100s; give it room, but the port's
// deadline still bounds a hang and terminal errors (4xx / truncation / refusal) fail fast.
const WRITER_TIMEOUT_MS = 150_000;
const WRITER_DEADLINE_MS = 210_000;

// External-material (Figma) load is BOUNDED: loadRunContext runs BEFORE the first checkpoint on
// every worker tick, so any unbounded pre-work here can exceed the invocation limit and kill the
// worker before it saves progress — the run then dies pre-checkpoint every tick until the recovery
// cap fails it ("exceeded max recovery attempts"). A run with ~30 Figma boards did exactly this by
// fetching them SEQUENTIALLY. We now fetch with a small concurrency pool under an overall wall-clock
// budget; boards not reached within the budget are skipped + logged (their deep-link still renders
// in the output). The durable fix (checkpointed material-ingest units) is tracked separately.
const FIGMA_LOAD_BUDGET_MS = 35_000;
const FIGMA_FETCH_CONCURRENCY = 6;
// Hard cap on the text stored per source (ADR-0006): a huge board/file can't become a huge
// extracted_text row or a huge extraction prompt. The extractor chunks within this anyway.
const MAX_EXTRACTED_CHARS = 200_000;

// Loose client type: edge functions have no generated Database types.
type SvcClient = SupabaseClient<any, "public", any>;

export type RunContext = {
  runId: string;
  projectId: string;
  phase: string;
  spfVersion: string;
  writerModel: string;
  requestId: string;
  /** Targeted re-create: only (re)write these versions. Undefined/empty = all four. */
  audiences?: string[];
  /** Writer-only re-create: reuse the persisted fact base and skip extraction (cost control). */
  writerOnly?: boolean;
};

/** Load the persisted fact base for a writer-only re-create (empty if none was stored). */
async function loadFactBase(
  svc: SvcClient,
  projectId: string,
  phase: string
): Promise<ComponentFactBase[]> {
  const { data } = await svc
    .from("handoff_fact_base")
    .select("facts")
    .eq("project_id", projectId)
    .eq("phase", phase)
    .maybeSingle();
  return Array.isArray(data?.facts) ? (data!.facts as ComponentFactBase[]) : [];
}

/** Persist the fact base after a full production so a later writer-only retry can reuse it. */
async function saveFactBase(
  svc: SvcClient,
  ctx: RunContext,
  facts: ComponentFactBase[]
): Promise<void> {
  const { error } = await svc.from("handoff_fact_base").upsert(
    {
      project_id: ctx.projectId,
      phase: ctx.phase,
      facts,
      spf_version: ctx.spfVersion,
      built_at: new Date().toISOString(),
    },
    { onConflict: "project_id,phase" }
  );
  if (error)
    log.warn("factbase", `persist failed [${ctx.requestId}]: ${error.message}`, {
      requestId: ctx.requestId,
    });
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type FigmaSub = { slug: string; fileKey: string; nodeId: string };

/** PURE: turn figma-link submissions into per-file node-id fetch batches (deduped) + a slug index.
 *  Non-figma or node-less URLs are skipped (parseFigmaUrl is host-locked, so this also drops junk). */
export function planFigmaFetch(
  subs: Array<{ component_slug: string; external_url: string | null }>
): { byFile: Map<string, string[]>; subs: FigmaSub[] } {
  const seen = new Map<string, Set<string>>(); // fileKey -> node ids
  const out: FigmaSub[] = [];
  for (const s of subs) {
    if (!s.external_url) continue;
    let parsed: { fileKey: string; nodeId?: string };
    try {
      parsed = parseFigmaUrl(s.external_url);
    } catch {
      continue; // not a figma URL (or unsafe host) -> not fetched here
    }
    if (!parsed.nodeId) continue; // whole-file links aren't node-scoped; skip on the hot path
    const set = seen.get(parsed.fileKey) ?? new Set<string>();
    set.add(parsed.nodeId);
    seen.set(parsed.fileKey, set);
    out.push({ slug: s.component_slug, fileKey: parsed.fileKey, nodeId: parsed.nodeId });
  }
  return { byFile: new Map([...seen].map(([k, v]) => [k, [...v]])), subs: out };
}

/** PURE: map each component slug to the fetched node text(s) for its figma submissions. */
export function figmaMaterialBySlug(
  subs: FigmaSub[],
  nodeTextByFile: Map<string, Record<string, string[]>>
): Map<string, string[]> {
  const bySlug = new Map<string, string[]>();
  for (const { slug, fileKey, nodeId } of subs) {
    const texts = nodeTextByFile.get(fileKey)?.[nodeId] ?? [];
    if (!texts.length) continue;
    const prev = bySlug.get(slug) ?? [];
    bySlug.set(slug, [...prev, ...texts]);
  }
  return bySlug;
}

/**
 * Fetch many Figma files with BOUNDED concurrency under an overall wall-clock budget. Runs in
 * loadRunContext BEFORE the first checkpoint, so it must never overrun the worker's invocation
 * limit — an overrun kills the worker pre-progress and the run then dies every tick until the
 * recovery cap fails it. At most `concurrency` fetches are in flight, and each is raced against the
 * remaining budget so one slow board can't blow the total; files not reached (or raced out) are
 * skipped and counted (their deep-link still renders). PURE over injected `fetchOne` + `now`, so the
 * ordering/skip logic is unit-tested without network or real clocks.
 */
export async function fetchFigmaBounded(
  byFile: Map<string, string[]>,
  fetchOne: (fileKey: string, ids: string[]) => Promise<Record<string, string[]>>,
  opts: {
    concurrency: number;
    budgetMs: number;
    now?: () => number;
    onError?: (fileKey: string, e: unknown) => void;
  }
): Promise<{ nodeTextByFile: Map<string, Record<string, string[]>>; skipped: number }> {
  const now = opts.now ?? (() => Date.now());
  const entries = [...byFile];
  const deadline = now() + opts.budgetMs;
  const nodeTextByFile = new Map<string, Record<string, string[]>>();
  let next = 0;
  let skipped = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= entries.length) return;
      if (deadline - now() <= 0) {
        skipped++; // budget already spent; don't start another board
        continue;
      }
      const [fileKey, ids] = entries[i];
      const remaining = deadline - now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const budgetGuard = new Promise<null>((r) => {
          timer = setTimeout(() => r(null), Math.max(0, remaining));
        });
        const raced = await Promise.race([fetchOne(fileKey, ids), budgetGuard]);
        if (raced === null) {
          skipped++; // raced out by the budget; the deep-link still renders in the output
          continue;
        }
        nodeTextByFile.set(fileKey, raced);
      } catch (e) {
        opts.onError?.(fileKey, e);
      } finally {
        if (timer !== undefined) clearTimeout(timer); // never leak the budget timer
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, entries.length) }, () => worker())
  );
  return { nodeTextByFile, skipped };
}

/** Load the per-run context that every worker tick needs (cheap + deterministic; safe to redo). */
async function loadRunContext(svc: SvcClient, projectId: string, phase: string) {
  const { data: compRows, error: compErr } = await svc
    .from("spf_entity")
    .select("slug,data")
    .eq("entity_type", "handoff_component")
    .eq("is_active", true);
  if (compErr) throw compErr;
  const components: HandoffComponent[] = (compRows ?? []).map((r) => ({
    slug: r.slug as string,
    ...(r.data as Record<string, unknown>),
  })) as HandoffComponent[];

  const { data: subs, error: subErr } = await svc
    .from("handoff_deliverable_submissions")
    .select("id,component_slug,submission_type,text_content,external_url,file_name,extracted_text")
    .eq("project_id", projectId)
    .eq("phase", phase);
  if (subErr) throw subErr;

  const nameBySlug = new Map(components.map((c) => [c.slug, String(c.Component ?? c.slug)]));
  const byComponent = new Map<string, Array<{ kind: string; content: string }>>();
  const linkMap = new Map<string, DeliverableLink[]>(); // deep-links to the actual submitted work
  for (const s of subs ?? []) {
    const slug = s.component_slug as string;
    const list = byComponent.get(slug) ?? [];
    // Real material: typed text, or the durably-ingested board/file text. A source not yet ingested
    // falls back to its URL (filtered out of material below, but still deep-linked in the output).
    const content =
      (s.text_content as string) ||
      (s.extracted_text as string) ||
      (s.external_url as string) ||
      `file: ${(s.file_name as string) ?? "uploaded"}`;
    list.push({ kind: s.submission_type as string, content });
    byComponent.set(slug, list);
    const url = s.external_url as string | null;
    if (url) {
      const links = linkMap.get(slug) ?? [];
      links.push({ label: nameBySlug.get(slug) ?? slug, url });
      linkMap.set(slug, links);
    }
  }

  // Figma/FigJam is fetched later as CHECKPOINTED ingest units (ADR-0006), NOT here: loadRunContext
  // runs before the first checkpoint every tick, so fetching boards inline could exceed the worker
  // invocation limit and kill it pre-progress (the "exceeded max recovery attempts" failure). Here we
  // only PLAN the fetch (host-locked parse, no network) for sources NOT yet ingested; the ingest
  // stage does the per-board fetch + persist to extracted_text. Already-ingested sources are skipped
  // (idempotent) and their text is read straight from extracted_text above.
  const figmaToken = Deno.env.get("FIGMA_TOKEN");
  const figmaSubsByFile = new Map<
    string,
    Array<{ submissionId: string; nodeId: string; slug: string }>
  >();
  if (figmaToken) {
    for (const s of subs ?? []) {
      if (s.extracted_text) continue; // already ingested -> never re-fetch
      const url = s.external_url as string | null;
      if (!url) continue;
      let parsed: { fileKey: string; nodeId?: string };
      try {
        parsed = parseFigmaUrl(url);
      } catch {
        continue; // not a figma/figjam URL (or unsafe host)
      }
      if (!parsed.nodeId) continue; // whole-file links aren't node-scoped (separate follow-up)
      const list = figmaSubsByFile.get(parsed.fileKey) ?? [];
      list.push({
        submissionId: s.id as string,
        nodeId: parsed.nodeId,
        slug: s.component_slug as string,
      });
      figmaSubsByFile.set(parsed.fileKey, list);
    }
  }
  const figmaFiles: FigmaFile[] = [...figmaSubsByFile].map(([fileKey, entries]) => ({
    fileKey,
    nodeIds: [...new Set(entries.map((e) => e.nodeId))],
  }));

  const { data: proj } = await svc
    .from("projects")
    .select("current_phase_milestones")
    .eq("id", projectId)
    .maybeSingle();
  const milestones = Array.isArray(proj?.current_phase_milestones)
    ? (proj!.current_phase_milestones as string[])
    : undefined;

  const spfCtx = await loadSpfContext(svc);
  const spfStrings = new Map([...spfCtx].map(([slug, c]) => [slug, formatSpfContext(c)]));
  // Extractor SEARCH scope per component: the SPF deliverables + activities + workshops to look for.
  const spfScope = new Map([...spfCtx].map(([slug, c]) => [slug, toExtractionScope(c)]));

  return {
    components,
    byComponent,
    linkMap,
    milestones,
    spfStrings,
    spfScope,
    figmaFiles,
    figmaSubsByFile,
    figmaToken,
  };
}

/** Build the injected side effects (LLM extract, LLM write-arc, render+store) for one run. */
function buildEffects(
  svc: SvcClient,
  ctx: RunContext,
  loaded: Awaited<ReturnType<typeof loadRunContext>>,
  guardCall: () => void,
  onUsage: UsageMeter
): StepEffects {
  const { requestId, writerModel } = ctx;
  const mechModel = resolveMechanicalModel();
  const { byComponent, linkMap, milestones, spfStrings, spfScope, figmaSubsByFile, figmaToken } =
    loaded;

  // ADR-0006 ingest unit: fetch ONE Figma/FigJam file's nodes, persist each of its submissions' text
  // to extracted_text (durable + idempotent), and feed it to THIS run's extractor. Fail-closed: a
  // board that can't be fetched degrades to no material (its deep-link still renders), never fails the
  // run. Runs as a checkpointed step, so many boards never overrun one worker invocation.
  const ingestFigma = async (file: FigmaFile): Promise<void> => {
    if (!figmaToken) return;
    const entries = figmaSubsByFile.get(file.fileKey) ?? [];
    if (!entries.length) return;
    let nodeText: Record<string, string[]>;
    try {
      nodeText = await fetchNodesText(file.fileKey, file.nodeIds, figmaToken);
    } catch (e) {
      log.warn(
        "ingest",
        `figma fetch failed for file ${file.fileKey} [${requestId}]: ${e instanceof Error ? e.message : String(e)}`,
        { requestId }
      );
      return;
    }
    for (const { submissionId, nodeId, slug } of entries) {
      const texts = nodeText[nodeId] ?? [];
      if (!texts.length) continue;
      const joined = texts.join("\n\n").slice(0, MAX_EXTRACTED_CHARS);
      const { error } = await svc
        .from("handoff_deliverable_submissions")
        .update({ extracted_text: joined, extracted_at: new Date().toISOString() })
        .eq("id", submissionId);
      if (error) {
        log.warn("ingest", `persist extracted_text failed for ${submissionId} [${requestId}]`, {
          requestId,
        });
        continue;
      }
      // Same-tick visibility for the extractor (loadRunContext rebuilds this from the DB next tick).
      const list = byComponent.get(slug) ?? [];
      list.push({ kind: "figma", content: joined });
      byComponent.set(slug, list);
    }
  };

  const extractFacts = async (component: HandoffComponent): Promise<ComponentFactBase> => {
    const slug = component.slug;
    const name = String(component.Component ?? slug);
    const subsFor = byComponent.get(slug) ?? [];
    const scope = spfScope.get(slug); // SPF deliverables + activities + workshops to search for
    // Extract from real material only; bare-URL submissions (Figma deep-links) feed the link map.
    const material = subsFor.filter((s) => !/^https?:\/\/\S+$/.test(s.content.trim()));
    let facts: string[] = [];
    if (material.length) {
      // Read ALL of it: concatenate, drop unfilled-template noise, chunk to fit, extract per chunk,
      // then merge + dedupe. No truncation.
      const fullText = material.map((s) => s.content).join("\n\n");
      // Drop unfilled-template ITEMS (keeps real terse stickies next to "Enter here" scaffolding),
      // then chunk. No whole-chunk template filter, which used to discard real work with the noise.
      const chunks = chunkText(stripTemplateItems(fullText));
      const perChunk: string[][] = [];
      for (const chunk of chunks) {
        guardCall();
        const p = buildFactExtractionPrompt(
          name,
          String((component as Record<string, unknown>).Description ?? ""),
          [{ kind: "material", content: chunk }],
          scope
        );
        const out = await generateStructured(
          // temperature 0 = deterministic extraction: same content -> same facts, every instance.
          {
            model: mechModel,
            messages: p.messages,
            toolName: p.toolName,
            schema: p.schema,
            reasoningEffort: "low",
            temperature: 0,
          },
          { requestId, onUsage }
        );
        perChunk.push(
          Array.isArray(out.facts) ? (out.facts as string[]).map((f) => dlpScrub(String(f))) : []
        );
      }
      const merged = mergeFacts(perChunk);
      // Stage 3.5: collapse near-duplicate quotes (reworded/reordered restatements of one point) that
      // survive mergeFacts' exact dedup, so the writer gets distinct points, not repeats. Non-lossy:
      // only near-identical facts merge, and the more complete one wins. Never a silent drop.
      const deduped = dedupeFacts(merged.facts);
      facts = deduped.facts;
      if (merged.dropped > 0)
        log.info(
          "extract",
          `${slug}: ${chunks.length} chunks, +${merged.dropped} facts dropped [${requestId}]`,
          { requestId }
        );
      if (deduped.dropped > 0)
        log.info(
          "extract",
          `${slug}: ${deduped.dropped} near-duplicate facts collapsed [${requestId}]`,
          { requestId }
        );
    }
    return {
      slug,
      component: name,
      storyArc: String(component["Hand-Off Story Arc"] ?? ""),
      facts,
    };
  };

  const writeArc = async (
    unit: WriteUnit,
    arcFacts: ComponentFactBase[]
  ): Promise<WrittenComponent[]> => {
    guardCall();
    // Write ONE story arc: a small, bounded response that cannot truncate a reasoning model's
    // output budget or overflow a provider's structured-output limit.
    const miniOutline = { ...unit.outline, sections: [unit.outline.sections[unit.arcIndex]] };
    const wp = buildWriterPrompt(unit.audience, miniOutline, arcFacts, spfStrings);
    try {
      const out = await generateStructured(
        {
          model: writerModel,
          messages: wp.messages,
          toolName: wp.toolName,
          schema: wp.schema,
          reasoningEffort: "low",
          // temperature 0 = deterministic writing: same fact base -> same hand-off, every run. The
          // writer previously inherited the port's 0.3 default, which made re-runs drift (and risked
          // losing an approved version). The extractor is already temp 0; the writer now matches.
          temperature: 0,
        },
        { requestId, onUsage, timeoutMs: WRITER_TIMEOUT_MS, deadlineMs: WRITER_DEADLINE_MS }
      );
      return Array.isArray(out.components)
        ? (out.components as WrittenComponent[]).map((c) => ({
            slug: String(c.slug),
            markdown: dlpScrub(String(c.markdown ?? "")),
          }))
        : [];
    } catch (e) {
      // The port already retried within its deadline; a failure here (terminal or exhausted) degrades
      // THIS arc to the renderer's honest "Awaiting content." placeholder rather than failing the run.
      log.warn(
        "write",
        `${unit.audience}: arc "${unit.outline.sections[unit.arcIndex].arc}" degraded [${requestId}]: ${e instanceof Error ? e.message : String(e)}`,
        { requestId }
      );
      return [];
    }
  };

  const finalize = async (unit: FinalizeUnit, written: WrittenComponent[]): Promise<void> => {
    const meta = {
      phase: ctx.phase,
      milestones,
      generatedLabel: `Generated from the Skills and Practices Framework (${ctx.spfVersion}).`,
    };
    const md = renderVersionMarkdown(unit.outline, written, meta, linkMap);
    const html = renderVersionHtml(unit.outline, written, meta, linkMap);
    // Idempotent store: upsert the blobs + the file rows (unique on production_id,audience,format),
    // so re-finalizing after a resume overwrites rather than duplicates.
    for (const [fmt, body, ctype] of [
      ["md", md, "text/markdown"],
      ["html", html, "text/html"],
    ] as const) {
      const path = `${ctx.projectId}/${ctx.phase}/${ctx.runId}/${unit.audience}.${fmt}`;
      const bytes = new TextEncoder().encode(body);
      const up = await svc.storage
        .from("handoff-outputs")
        .upload(path, bytes, { contentType: ctype, upsert: true });
      if (up.error) throw up.error;
      const row = await svc.from("handoff_output_files").upsert(
        {
          production_id: ctx.runId,
          audience: unit.audience,
          format: fmt,
          storage_path: path,
          checksum: await sha256Hex(body),
          bytes: bytes.length,
        },
        { onConflict: "production_id,audience,format" }
      );
      if (row.error) throw row.error;
    }
    log.info("write", `${unit.audience} md+html stored [${ctx.requestId}]`, {
      requestId: ctx.requestId,
    });
  };

  return { ingestFigma, extractFacts, writeArc, finalize };
}

/**
 * Drive a run (from `initial` state, or a fresh run) toward completion, calling `hooks` between
 * units for the caller's budget + checkpoint control. This is the shared core used by both the
 * run-to-completion path (processRun) and the durable worker.
 */
export async function runHandoff(
  svc: SvcClient,
  ctx: RunContext,
  hooks: { shouldContinue: () => boolean; checkpoint: (s: PipelineState) => Promise<boolean> },
  initial?: PipelineState
): Promise<{
  state: PipelineState;
  stopped: DriveStop;
  gaps: { total: number; byAudience: Record<string, number> };
}> {
  let llmCalls = 0;
  const guardCall = () => {
    if (++llmCalls > MAX_LLM_CALLS) throw new Error(`LLM call cap (${MAX_LLM_CALLS}) exceeded`);
  };
  // Per-tick usage meter: accumulate tokens per model, then fold into the shared cost counters once
  // at the end of the tick (fewer RPCs than per-call). A tick only bills the calls IT made — resumed
  // ticks skip completed units, so there is no double counting across the run's ticks.
  const meter = new Map<string, { tokensIn: number; tokensOut: number }>();
  const onUsage: UsageMeter = (u) => {
    const cur = meter.get(u.model) ?? { tokensIn: 0, tokensOut: 0 };
    cur.tokensIn += u.tokensIn;
    cur.tokensOut += u.tokensOut;
    meter.set(u.model, cur);
  };
  const loaded = await loadRunContext(svc, ctx.projectId, ctx.phase);
  const plan = buildRunPlan(
    loaded.components,
    loaded.figmaFiles,
    ctx.audiences as HandoffAudience[] | undefined
  );
  const eff = buildEffects(svc, ctx, loaded, guardCall, onUsage);

  // Pick the starting state. A resumed run uses its persisted state. A fresh WRITER-ONLY re-create
  // seeds the fact base from handoff_fact_base and jumps straight to writing (no extraction). A fresh
  // full production starts at extraction.
  let start = initial;
  if (!start) {
    if (ctx.writerOnly) {
      const facts = await loadFactBase(svc, ctx.projectId, ctx.phase);
      start = { cursor: firstWriteCursor(plan), factBase: facts, written: {} };
    } else {
      start = { cursor: firstCursor(plan), factBase: [], written: {} };
    }
  }

  const result = await driveRun(start, plan, eff, hooks);
  await recordCost(svc, meter, ctx.requestId); // best-effort; never fails the run
  // On a completed FULL production, persist the fact base so the team's one retry stays writer-only.
  if (!ctx.writerOnly && result.stopped === "done") {
    await saveFactBase(svc, ctx, result.state.factBase);
  }
  // Degraded-arc count: only meaningful once the run is done, but cheap + pure to compute always.
  return { ...result, gaps: runGaps(plan, result.state) };
}

/**
 * Run a hand-off to completion in one call (no budget, no external checkpoint). Used by tests and
 * any synchronous driver. The durable worker uses runHandoff with real budget + checkpoint hooks.
 */
export async function processRun(svc: SvcClient, ctx: RunContext): Promise<void> {
  const { runId, projectId, phase, requestId } = ctx;
  const setStatus = (status: string, error?: string) =>
    svc
      .from("handoff_productions")
      .update({ status, updated_at: new Date().toISOString(), ...(error ? { error } : {}) })
      .eq("id", runId);
  try {
    await setStatus("extracting");
    const { stopped, gaps } = await runHandoff(svc, ctx, {
      shouldContinue: () => true,
      checkpoint: () => Promise.resolve(true),
    });
    if (stopped !== "done") throw new Error(`run did not complete: ${stopped}`);
    await svc
      .from("handoff_productions")
      .update({ is_latest: false })
      .eq("project_id", projectId)
      .eq("phase", phase)
      .neq("id", runId);
    await svc
      .from("handoff_productions")
      .update({ status: "complete", gap_count: gaps.total, updated_at: new Date().toISOString() })
      .eq("id", runId);
    if (gaps.total > 0)
      log.warn(
        "run",
        `hand-off complete WITH ${gaps.total} gap(s) ${JSON.stringify(gaps.byAudience)} [${requestId}] run=${runId}`,
        { requestId }
      );
    else log.info("run", `hand-off complete [${requestId}] run=${runId}`, { requestId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("run", `hand-off failed [${requestId}]: ${msg}`, { requestId });
    await setStatus("failed", msg.slice(0, 500));
  }
}
