// @edge-auth required — verify_jwt=true; invoked by pg_cron with the service-role bearer only.
// handoff-worker (Phase B2): the durable, cron-driven queue drainer for hand-off production.
//
// A pg_cron job invokes this every minute with the service-role bearer. Each tick claims leased runs
// from handoff_productions and advances each toward completion via the resumable step machine
// (pipeline.ts -> pipeline-steps.ts), checkpointing after every unit. If a run doesn't finish within
// the tick's soft budget, its state is released so the NEXT tick resumes exactly where it left off.
// If this worker dies mid-run, the lease lapses and a later tick reclaims and continues (bounded by
// the crash-recovery cap in handoff_claim_run). This replaces the old EdgeRuntime.waitUntil path,
// which could not survive an invocation recycle. Service-role only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { resolveWriterModel } from "../_shared/llm/port.ts";
import { runHandoff } from "../handoff-produce/pipeline.ts";
import type { PipelineState } from "../handoff-produce/pipeline-steps.ts";
import { killSwitchOn } from "../handoff-produce/ops.ts";
import { bearerMatches, statusForCursor } from "./lib.ts";

const log = createEdgeLogger("handoff-worker");
type SvcClient = SupabaseClient<any, "public", any>;

const LEASE_SECONDS = 120; // lease held per claim; a checkpoint extends it
const TICK_BUDGET_MS = 110_000; // stop claiming/working before the invocation limit; resume next tick

// Constant-time bearer check against the service-role key (this is a service-role-only worker).
function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return bearerMatches(got, expected);
}

serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!isAuthorized(req))
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  // Kill switch (same flag the enqueue front door reads): HOLD — claim nothing this tick so queued
  // runs sit safely until an operator re-enables, rather than draining into a degraded provider.
  if (killSwitchOn(Deno.env.get("HANDOFF_PRODUCE_DISABLED"))) {
    log.warn("hold", "HANDOFF_PRODUCE_DISABLED is set — holding all queued runs this tick");
    return new Response(JSON.stringify({ held: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc: SvcClient = createClient(SUPABASE_URL, SERVICE_KEY);

  const workerId = crypto.randomUUID();
  const tickDeadline = Date.now() + TICK_BUDGET_MS;
  const processed: Array<{ run: string; outcome: string }> = [];

  while (Date.now() < tickDeadline) {
    const { data: claimed, error: claimErr } = await svc.rpc("handoff_claim_run", {
      p_worker_id: workerId,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (claimErr) {
      log.error("claim", `claim failed: ${claimErr.message}`);
      break;
    }
    const run = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!run) break; // nothing due

    const ctx = {
      runId: run.id as string,
      projectId: run.project_id as string,
      phase: run.phase as string,
      spfVersion: (run.spf_version as string) || "v1",
      writerModel: (run.model as string) || resolveWriterModel(),
      requestId: workerId.slice(0, 8),
      audiences: (run.audiences as string[] | null) ?? undefined,
      writerOnly: (run.writer_only as boolean) ?? false,
    };
    const initial = (run.pipeline_state as PipelineState | null) ?? undefined;

    // Each unit runHandoff advances (ingest / extract / write / finalize) is BOUNDED per invocation —
    // the Figma fetch (fetchFigmaBounded) and per-component extraction (extractChunksBounded) each run
    // under a wall-clock budget — so no single unit can overrun this tick and strand the run before it
    // checkpoints (the extract-stage "exceeded max recovery attempts" loop). Between units,
    // shouldContinue() releases the run cleanly for the next tick; a real crash resumes from the last
    // checkpoint. (This worker bundles handoff-produce/pipeline.ts, so it redeploys when that changes.)
    try {
      const { state, stopped, gaps } = await runHandoff(
        svc,
        ctx,
        {
          shouldContinue: () => Date.now() < tickDeadline,
          checkpoint: async (s) => {
            const { data } = await svc.rpc("handoff_checkpoint_run", {
              p_run_id: ctx.runId,
              p_worker_id: workerId,
              p_lease_seconds: LEASE_SECONDS,
              p_state: s,
              p_status: statusForCursor(s.cursor),
            });
            return data === true; // false => we lost the lease; driveRun stops
          },
        },
        initial
      );

      if (stopped === "done") {
        await svc.rpc("handoff_complete_run", {
          p_run_id: ctx.runId,
          p_worker_id: workerId,
          p_gap_count: gaps.total,
        });
        if (gaps.total > 0)
          // Completed, but shipped "_Awaiting content._" placeholders: surface it (SLO signal + alert
          // source) instead of the run looking clean. Not an error — the run still produced output.
          log.warn(
            "run",
            `completed run=${ctx.runId} WITH ${gaps.total} gap(s) ${JSON.stringify(gaps.byAudience)} [${ctx.requestId}]`,
            { requestId: ctx.requestId }
          );
        else
          log.info("run", `completed run=${ctx.runId} [${ctx.requestId}]`, {
            requestId: ctx.requestId,
          });
        processed.push({
          run: ctx.runId,
          outcome: gaps.total > 0 ? "complete-with-gaps" : "complete",
        });
      } else if (stopped === "budget") {
        // Out of tick time: hand the run back for the next tick to resume, no crash penalty.
        await svc.rpc("handoff_release_run", {
          p_run_id: ctx.runId,
          p_worker_id: workerId,
          p_state: state,
        });
        processed.push({ run: ctx.runId, outcome: "released" });
        break;
      } else {
        // lost-lease: another worker took over; leave it to them.
        processed.push({ run: ctx.runId, outcome: "lost-lease" });
      }
    } catch (e) {
      // Infra error (DB/storage/context load). Do NOT fail the run here: leave the lease to lapse so
      // a later tick reclaims and retries from the last checkpoint. handoff_claim_run gives up (marks
      // failed) only after the crash-recovery cap, so a persistent fault still terminates.
      log.error(
        "run",
        `run=${ctx.runId} tick errored (will retry after lease): ${e instanceof Error ? e.message : String(e)}`,
        { requestId: ctx.requestId }
      );
      processed.push({ run: ctx.runId, outcome: "error-retry" });
    }
  }

  return new Response(JSON.stringify({ worker: workerId, processed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
