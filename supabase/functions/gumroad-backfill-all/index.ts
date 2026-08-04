// @edge-cron
/**
 * gumroad-backfill-all — one-shot / scheduled full ledger resync.
 *
 * Pulls EVERY sale from the Gumroad API into public.gumroad_sales, resolving
 * each to a profile by email, then calls reproject_membership_drift() so every
 * member is projected. This is the server-side, no-machine equivalent of the
 * one-time ingest — a "resync everyone" button for admins + a periodic backstop.
 *
 * Auth: admin JWT (has_role) OR service-role bearer (cron). Never members.
 * Lifecycle: for subscription sales it verifies status via /v2/subscribers and
 * FAILS CLOSED on anything it can't confirm active (no lapsed self-restore).
 * Observability: emits auditEdgeEvent rows (info/warn/error) at every stage so
 * failures + warnings surface in the Activity Log.
 */
import { withAuditWrapper, auditEdgeEvent } from "../_shared/audit.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GUMROAD_ACCESS_TOKEN = Deno.env.get("GUMROAD_ACCESS_TOKEN") ?? "";
const GUMROAD_SELLER_ID = Deno.env.get("GUMROAD_SELLER_ID") ?? "";
const MAX_PAGES = 100;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface GumroadSale {
  id: string; email: string; seller_id?: string; product_id?: string;
  product_permalink?: string; permalink?: string; subscription_id?: string;
  price?: number; recurrence?: string; refunded?: boolean; disputed?: boolean; dispute_won?: boolean;
  [k: string]: unknown;
}
type SubLifecycle = { state: "active" | "ended" | "unknown"; endedAt: string | null; cancelledAt: string | null };

async function fetchSubscriberLifecycle(subscriptionId: string): Promise<SubLifecycle> {
  try {
    const resp = await fetch(
      `https://api.gumroad.com/v2/subscribers/${encodeURIComponent(subscriptionId)}?access_token=${encodeURIComponent(GUMROAD_ACCESS_TOKEN)}`,
    );
    if (!resp.ok) return { state: "unknown", endedAt: null, cancelledAt: null };
    const body = (await resp.json()) as { success?: boolean; subscriber?: Record<string, string | null> };
    const s = body.subscriber;
    if (!body.success || !s) return { state: "unknown", endedAt: null, cancelledAt: null };
    const cancelledAt = (s.cancelled_at ?? s.user_requested_cancellation_at ?? null) as string | null;
    const status = s.status as string | undefined;
    const terminal = !!s.ended_at || !!s.failed_at ||
      (!!status && ["cancelled", "failed_payment", "fixed_subscription_period_ended", "ended"].includes(status));
    const active = status === "alive" || status === "pending_cancellation";
    if (terminal) return { state: "ended", endedAt: (s.ended_at ?? s.failed_at ?? new Date().toISOString()) as string, cancelledAt };
    if (active) return { state: "active", endedAt: null, cancelledAt };
    return { state: "unknown", endedAt: null, cancelledAt };
  } catch {
    return { state: "unknown", endedAt: null, cancelledAt: null };
  }
}

async function isAdmin(admin: SupabaseClient<any, any, any>, userId: string): Promise<boolean> {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  return !!data;
}

Deno.serve(
  withAuditWrapper("gumroad-backfill-all", async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Audit client comes from the shared factory so its type matches
    // auditEdgeEvent's param (the esm.sh `admin` above is a different supabase-js
    // version and won't type-check when passed across module boundaries).
    const auditClient = getAdminClient();

    // ── Auth: service-role (cron) OR admin JWT. Never members. ────────────────
    let actor = "cron";
    const svc = authorizeServiceRoleRequest(req);
    if (!svc.ok) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
      const userId = claims?.claims?.sub as string | undefined;
      if (!userId) return json({ error: "Unauthorized" }, 401);
      if (!(await isAdmin(admin, userId))) {
        void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "authz_admin_denied", traceId: ctx.traceId, severity: "warn", userId });
        return json({ error: "Admin role required" }, 403);
      }
      actor = userId;
    }

    if (!GUMROAD_ACCESS_TOKEN) {
      void auditEdgeEvent(auditClient, {
        fn: "gumroad-backfill-all", event: "gumroad_ingestion_misconfigured", traceId: ctx.traceId,
        severity: "error", fields: ["secret:GUMROAD_ACCESS_TOKEN", "state:missing"],
        errorMessage: "gumroad-backfill-all cannot run: GUMROAD_ACCESS_TOKEN is unset",
      });
      return json({ error: "Not configured" }, 503);
    }

    void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "gumroad_backfill_all_started", traceId: ctx.traceId, severity: "info", fields: [`actor:${actor.slice(0, 40)}`] });

    // ── Pull all sales ────────────────────────────────────────────────────────
    const sales: GumroadSale[] = [];
    let pageKey: string | undefined;
    let pages = 0;
    try {
      do {
        const params = new URLSearchParams({ access_token: GUMROAD_ACCESS_TOKEN });
        if (pageKey) params.set("page_key", pageKey);
        const resp = await fetch(`https://api.gumroad.com/v2/sales?${params}`, { method: "GET" });
        if (!resp.ok) {
          void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "gumroad_api_error", traceId: ctx.traceId, severity: "error", fields: [`status:${resp.status}`], errorMessage: "sales API non-2xx" });
          return json({ error: "Gumroad API error", status: resp.status }, 502);
        }
        const body = (await resp.json()) as { success?: boolean; sales?: GumroadSale[]; next_page_key?: string; message?: string };
        if (!body.success) {
          void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "gumroad_api_error", traceId: ctx.traceId, severity: "error", errorMessage: body.message ?? "unsuccessful" });
          return json({ error: body.message ?? "Gumroad API error" }, 502);
        }
        if (body.sales?.length) sales.push(...body.sales);
        pageKey = body.next_page_key;
        pages += 1;
      } while (pageKey && pages < MAX_PAGES);
    } catch (err) {
      void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "gumroad_api_error", traceId: ctx.traceId, severity: "error", errorMessage: err instanceof Error ? err.message : "fetch failed" });
      return json({ error: "Fetch failed" }, 502);
    }
    if (pageKey) {
      void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "gumroad_backfill_truncated", traceId: ctx.traceId, severity: "warn", fields: [`max_pages:${MAX_PAGES}`], errorMessage: "sales pages remained after the cap" });
    }

    // ── Ingest (lifecycle-aware, fail-closed on unverifiable subscriptions) ────
    const now = new Date().toISOString();
    const subCache = new Map<string, SubLifecycle>();
    let ingested = 0, pending = 0, skipped = 0;
    for (const s of sales) {
      const email = (s.email || "").trim().toLowerCase();
      if (!email || !s.id) { skipped++; continue; }
      if (GUMROAD_SELLER_ID && s.seller_id && s.seller_id !== GUMROAD_SELLER_ID) { skipped++; continue; }

      const subId = typeof s.subscription_id === "string" ? s.subscription_id : null;
      let endedAt: string | null = null, cancelledAt: string | null = null, grant = true;
      if (subId) {
        let life = subCache.get(subId);
        if (!life) { life = await fetchSubscriberLifecycle(subId); subCache.set(subId, life); }
        if (life.state === "ended") { endedAt = life.endedAt; cancelledAt = life.cancelledAt; }
        else if (life.state === "active") { cancelledAt = life.cancelledAt; }
        else grant = false;
      }
      const { data: prof } = await admin.from("profiles").select("user_id").ilike("email", escapeLike(email)).maybeSingle();
      const resolvedUserId = grant ? (prof?.user_id ?? null) : null;

      const { error, count } = await admin.from("gumroad_sales").upsert({
        sale_id: s.id, seller_id: s.seller_id ?? GUMROAD_SELLER_ID,
        subscription_id: subId, product_id: s.product_id ?? "",
        product_permalink: s.permalink || s.product_permalink || "", email,
        price_cents: typeof s.price === "number" ? s.price : 0,
        recurrence: typeof s.recurrence === "string" ? s.recurrence : "",
        resource_name: "backfill-all",
        resolved_user_id: resolvedUserId,
        status: resolvedUserId ? "applied" : "pending_user",
        refunded_at: s.refunded ? now : null,
        disputed_at: s.disputed && !s.dispute_won ? now : null,
        subscription_cancelled_at: cancelledAt, subscription_ended_at: endedAt,
        raw_payload: s as unknown as Record<string, unknown>,
        received_at: now, processed_at: resolvedUserId ? now : null,
      }, { onConflict: "sale_id", ignoreDuplicates: true, count: "exact" });
      if (error) { skipped++; continue; }
      if ((count ?? 0) > 0) { if (resolvedUserId) ingested++; else pending++; } else skipped++;
    }

    // ── Project everyone (also fires the invariant tripwire). ─────────────────
    const { error: reErr } = await admin.rpc("reproject_membership_drift");
    if (reErr) {
      void auditEdgeEvent(auditClient, { fn: "gumroad-backfill-all", event: "membership_projection_failed", traceId: ctx.traceId, severity: "error", errorMessage: reErr.message });
      return json({ error: "Projection failed" }, 500);
    }

    void auditEdgeEvent(auditClient, {
      fn: "gumroad-backfill-all", event: "gumroad_backfill_all_completed", traceId: ctx.traceId, severity: "info",
      fields: [`sales:${sales.length}`, `ingested:${ingested}`, `pending:${pending}`, `skipped:${skipped}`],
    });
    return json({ ok: true, sales: sales.length, ingested, pending, skipped }, 200);
  }),
);
