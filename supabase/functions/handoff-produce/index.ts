// @edge-auth required — JWT-gated; produce-gate enforces active_participant on OWN project (or admin).
// handoff-produce (Phase B2): the ENQUEUE front door.
// Gate + auth are synchronous; the request only creates a 'queued' run row and returns immediately.
// The durable, cron-driven handoff-worker (see ../handoff-worker) claims the run and drives it to
// completion with checkpointed, resumable state, so a recycled invocation can never strand a run
// (the old EdgeRuntime.waitUntil path could). The SPA polls handoff_productions.status.
// Guards: produce-gate (active_participant on OWN project, or admin), strict 26-gate,
// one-run-per-project (DB partial unique index), idempotency key.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { createEdgeLogger } from "../_shared/logger.ts";
import { applyWaf } from "../_shared/waf.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { resolveWriterModel } from "../_shared/llm/port.ts";
import { killSwitchOn } from "./ops.ts";

const log = createEdgeLogger("handoff-produce");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
type SvcClient = SupabaseClient<any, "public", any>;

const AUDIENCES = ["client", "teammate", "teammate_case_study", "org_case_study"] as const;
const BodySchema = z.object({
  project_id: z.string().uuid(),
  phase: z.enum(["phase_1", "phase_2", "phase_3", "phase_4"]),
  format: z.enum(["md", "pdf"]).optional(),
  idempotency_key: z.string().max(200).optional(),
  // Targeted re-create: which of the four versions to re-write. Ignored for the first production
  // (which always writes all four); the server decides full-vs-retry from the team budget.
  audiences: z.array(z.enum(AUDIENCES)).min(1).max(4).optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(
  withAuditWrapper("handoff-produce", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const blocked = await applyWaf(req, "handoff-produce");
    if (blocked) return blocked;
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Ops kill switch (SRE runbook: LLM outage or cost runaway). Flip the HANDOFF_PRODUCE_DISABLED
    // secret to halt NEW production without a deploy; the worker honors the same flag so already-
    // queued runs HOLD rather than drain into a down provider. Read fresh per request.
    if (killSwitchOn(Deno.env.get("HANDOFF_PRODUCE_DISABLED"))) {
      return new Response(
        JSON.stringify({
          error: "Hand-off production is temporarily disabled. Please try again later.",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "300" },
        }
      );
    }

    const requestId = crypto.randomUUID().substring(0, 8);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) return json({ error: "Invalid or expired token" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Invalid request body" }, 400);
    const { project_id, phase, idempotency_key } = parsed.data;

    const svc: SvcClient = createClient(SUPABASE_URL, SERVICE_KEY);

    // Produce gate: active teammate on THIS project (member-scoped via the user's client) or admin.
    const { data: isAdmin } = await svc.rpc("has_role", { _user_id: user.id, _role: "admin" });
    const { data: memberForUser } = await authClient.rpc("handoff_is_active_member", {
      p_project_id: project_id,
    });
    if (!memberForUser && !isAdmin) {
      return json({ error: "Only active teammates on this project can produce hand-offs." }, 403);
    }

    // Strict completeness gate.
    const { data: gate } = await svc.rpc("handoff_completeness", {
      p_project_id: project_id,
      p_phase: phase,
    });
    const g = gate as { is_ready?: boolean; progress_pct?: number } | null;
    if (!g?.is_ready) {
      return json(
        { error: "Hand-off is not ready: all components must be provided first.", gate: g },
        409
      );
    }

    // Pin the active SPF snapshot version for reproducibility.
    const { data: cfg } = await svc
      .from("framework_source_config")
      .select("spf_active_version")
      .eq("id", 1)
      .maybeSingle();
    const { data: anySpf } = await svc
      .from("spf_entity")
      .select("spf_version")
      .limit(1)
      .maybeSingle();
    const spfVersion =
      (cfg?.spf_active_version as string) || (anySpf?.spf_version as string) || "v1";
    const writerModel = resolveWriterModel();

    // Atomic enqueue: enforces the team budget (1 production + 1 retry), creates the run, and
    // decides full-vs-writer-only re-create in one transaction (see handoff_enqueue_production).
    const { data: enq, error: enqErr } = await svc.rpc("handoff_enqueue_production", {
      p_project_id: project_id,
      p_phase: phase,
      p_triggered_by: user.id,
      p_spf_version: spfVersion,
      p_model: writerModel,
      p_idempotency_key: idempotency_key ?? null,
      p_audiences: parsed.data.audiences ?? null,
    });
    if (enqErr) {
      log.error("run", `enqueue failed [${requestId}]: ${enqErr.message}`, { requestId });
      return json({ error: "Could not start hand-off production." }, 500);
    }
    const result = enq as {
      status: string;
      run_id?: string;
      ordinal?: number;
      writer_only?: boolean;
    };
    switch (result.status) {
      case "budget_exceeded":
        return json(
          {
            error:
              "Your team has already used its hand-off re-create for this phase. Contact a Tech Fleet admin if you need another.",
          },
          409
        );
      case "in_progress":
        return json(
          { error: "A hand-off run is already in progress for this project and phase." },
          409
        );
      case "duplicate":
        return json({ error: "This request was already submitted." }, 409);
      case "queued": {
        const kind = result.writer_only ? "writer-only re-create" : "full production";
        log.info(
          "run",
          `queued run=${result.run_id} (${kind}, run #${result.ordinal}) [${requestId}]`,
          {
            requestId,
          }
        );
        return json(
          { run_id: result.run_id, status: "queued", message: "Hand-off production queued." },
          202
        );
      }
      default:
        log.error("run", `unexpected enqueue status ${result.status} [${requestId}]`, {
          requestId,
        });
        return json({ error: "Could not start hand-off production." }, 500);
    }
  })
);
