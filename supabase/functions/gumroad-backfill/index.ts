// @edge-cron
/**
 * Gumroad backfill — LEDGER CATCH-UP for the calling user.
 *
 * Pulls the caller's historical sales from the Gumroad API and inserts any that
 * aren't already in public.gumroad_sales, then triggers a re-projection. It does
 * NOT compute or write a tier — public.compute_membership() derives the profile
 * from the ledger + catalog (a DB trigger fires on insert; we also call it once
 * explicitly to return the resulting tier).
 *
 * Security (OWASP):
 *  - Auth: valid Bearer JWT required; sales are filtered by the caller's VERIFIED
 *    token email (never a client-supplied email) -> no IDOR across buyers.
 *  - Seller-id filter (defense in depth) + email re-check.
 *  - Misconfiguration (no access token) fails closed with a 503 AND an audit
 *    event, so a silent outage is visible (Observability).
 *  - ignoreDuplicates: never clobbers webhook-managed lifecycle timestamps.
 */
import { withAuditWrapper, auditEdgeEvent, type AuditSeverity } from "../_shared/audit.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

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

interface GumroadSale {
  id: string;
  email: string;
  seller_id?: string;
  product_id?: string;
  product_permalink?: string;
  permalink?: string;
  subscription_id?: string;
  price?: number;
  recurrence?: string;
  refunded?: boolean;
  disputed?: boolean;
  dispute_won?: boolean;
  [key: string]: unknown;
}

interface GumroadSalesResponse {
  success: boolean;
  sales?: GumroadSale[];
  next_page_key?: string;
  message?: string;
}

interface GumroadSubscriber {
  id: string;
  status?: string;
  ended_at?: string | null;
  cancelled_at?: string | null;
  user_requested_cancellation_at?: string | null;
  failed_at?: string | null;
}

type SubLifecycle = {
  state: "active" | "ended" | "unknown";
  endedAt: string | null;
  cancelledAt: string | null;
};

/**
 * Resolve a subscription's lifecycle from Gumroad's /v2/subscribers endpoint
 * (the /v2/sales list does NOT expose whether a subscription has lapsed). This
 * is what stops a lapsed member from self-restoring access via backfill.
 * Returns "unknown" on any error/ambiguity so the caller can FAIL CLOSED
 * (leave the sale pending rather than granting access it can't verify).
 */
async function fetchSubscriberLifecycle(subscriptionId: string): Promise<SubLifecycle> {
  try {
    const resp = await fetch(
      `https://api.gumroad.com/v2/subscribers/${encodeURIComponent(subscriptionId)}?access_token=${encodeURIComponent(GUMROAD_ACCESS_TOKEN)}`
    );
    if (!resp.ok) return { state: "unknown", endedAt: null, cancelledAt: null };
    const body = (await resp.json()) as { success?: boolean; subscriber?: GumroadSubscriber };
    const s = body.subscriber;
    if (!body.success || !s) return { state: "unknown", endedAt: null, cancelledAt: null };
    const cancelledAt = s.cancelled_at ?? s.user_requested_cancellation_at ?? null;
    const terminal =
      !!s.ended_at ||
      !!s.failed_at ||
      (!!s.status &&
        ["cancelled", "failed_payment", "fixed_subscription_period_ended", "ended"].includes(
          s.status
        ));
    // "alive" / "pending_cancellation" still have access (until period end).
    const active = s.status === "alive" || s.status === "pending_cancellation";
    if (terminal)
      return {
        state: "ended",
        endedAt: s.ended_at ?? s.failed_at ?? new Date().toISOString(),
        cancelledAt,
      };
    if (active) return { state: "active", endedAt: null, cancelledAt };
    return { state: "unknown", endedAt: null, cancelledAt };
  } catch {
    return { state: "unknown", endedAt: null, cancelledAt: null };
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fire-and-forget observability event; never throws. Routed through
 *  auditEdgeEvent so it lands in the Activity Log tagged source:edge + severity
 *  (misconfig / API errors = error; pagination truncation = warn). */
async function audit(event: string, fields: string[], msg: string) {
  const severity: AuditSeverity = /truncated/.test(event) ? "warn" : "error";
  await auditEdgeEvent(getAdminClient(), {
    fn: "gumroad-backfill", event, table: "gumroad_sales", severity, fields, errorMessage: msg,
  });
}

Deno.serve(
  withAuditWrapper("gumroad-backfill", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!GUMROAD_ACCESS_TOKEN) {
      await audit(
        "gumroad_ingestion_misconfigured",
        ["secret:GUMROAD_ACCESS_TOKEN", "state:missing"],
        "gumroad-backfill cannot run: GUMROAD_ACCESS_TOKEN is unset"
      );
      return json({ error: "Backfill not configured" }, 503);
    }

    // Identity from the VERIFIED token — never client-supplied.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const userId = claims.claims.sub as string;
    const email = (claims.claims.email as string | undefined)?.toLowerCase();
    if (!email) return json({ ok: true, imported: 0, reason: "no_email" }, 200);

    // Walk all pages of the caller's sales (server-side email filter minimizes
    // cross-buyer exposure).
    const sales: GumroadSale[] = [];
    let pageKey: string | undefined;
    let pageCount = 0;
    const MAX_PAGES = 20;
    try {
      do {
        const params = new URLSearchParams({ access_token: GUMROAD_ACCESS_TOKEN, email });
        if (pageKey) params.set("page_key", pageKey);
        const resp = await fetch(`https://api.gumroad.com/v2/sales?${params.toString()}`, {
          method: "GET",
        });
        if (!resp.ok) {
          await audit(
            "gumroad_api_error",
            [`status:${resp.status}`],
            "gumroad-backfill: sales API non-2xx"
          );
          return json({ error: "Gumroad API error", status: resp.status }, 502);
        }
        const body = (await resp.json()) as GumroadSalesResponse;
        if (!body.success) {
          await audit(
            "gumroad_api_error",
            ["status:success_false"],
            body.message ?? "unsuccessful"
          );
          return json({ error: body.message ?? "Gumroad API error" }, 502);
        }
        if (body.sales?.length) sales.push(...body.sales);
        pageKey = body.next_page_key;
        pageCount += 1;
      } while (pageKey && pageCount < MAX_PAGES);
    } catch {
      await audit(
        "gumroad_api_error",
        ["status:fetch_failed"],
        "gumroad-backfill: fetch threw"
      );
      return json({ error: "Fetch failed" }, 502);
    }
    if (pageKey) {
      // Pages remained after the cap — a sale/refund beyond the cap could be missed.
      await audit(
        "gumroad_backfill_truncated",
        [`max_pages:${MAX_PAGES}`],
        "gumroad-backfill: sales pages remained after the page cap"
      );
    }

    // This seller + this verified email only. Record refunded/disputed sales too
    // (with lifecycle timestamps) so the ledger is complete; the projector
    // excludes them. Tier is NOT computed here.
    const nowIso = new Date().toISOString();
    const eligible = sales.filter(
      (s) =>
        (!GUMROAD_SELLER_ID || !s.seller_id || s.seller_id === GUMROAD_SELLER_ID) &&
        typeof s.email === "string" &&
        s.email.trim().toLowerCase() === email
    );

    // Resolve subscription lifecycle once per subscription (cached). A subscription
    // sale we CANNOT confirm active is left pending (fail closed) so a lapsed
    // member can't self-restore access via backfill (C1). One-time sales (no
    // subscription_id) grant directly — they don't lapse.
    const subCache = new Map<string, SubLifecycle>();
    const rows: Record<string, unknown>[] = [];
    for (const s of eligible) {
      const subId = typeof s.subscription_id === "string" ? s.subscription_id : null;
      let endedAt: string | null = null;
      let cancelledAt: string | null = null;
      let grant = true; // resolve to the user (grant) unless we must fail closed

      if (subId) {
        let life = subCache.get(subId);
        if (!life) {
          life = await fetchSubscriberLifecycle(subId);
          subCache.set(subId, life);
        }
        if (life.state === "ended") {
          endedAt = life.endedAt;
          cancelledAt = life.cancelledAt;
        } else if (life.state === "active") {
          cancelledAt = life.cancelledAt;
        } else {
          grant = false; // unknown → leave pending (no false "ended" data, no grant)
        }
      }

      rows.push({
        sale_id: s.id,
        seller_id: s.seller_id ?? GUMROAD_SELLER_ID,
        subscription_id: subId,
        product_id: s.product_id ?? "",
        product_permalink: s.permalink || s.product_permalink || "",
        email,
        price_cents: typeof s.price === "number" ? s.price : 0,
        recurrence: typeof s.recurrence === "string" ? s.recurrence : "",
        resource_name: "backfill",
        resolved_user_id: grant ? userId : null,
        status: grant ? "applied" : "pending_user",
        refunded_at: s.refunded ? nowIso : null,
        disputed_at: s.disputed && !s.dispute_won ? nowIso : null,
        subscription_cancelled_at: cancelledAt,
        subscription_ended_at: endedAt,
        raw_payload: s as unknown as Record<string, unknown>,
        received_at: nowIso,
        processed_at: grant ? nowIso : null,
      });
    }

    if (rows.length > 0) {
      // Insert new sales only; never clobber webhook-managed lifecycle state.
      const { error: upsertErr } = await admin
        .from("gumroad_sales")
        .upsert(rows, { onConflict: "sale_id", ignoreDuplicates: true });
      if (upsertErr) {
        await audit("gumroad_sale_persist_failed", [`rows:${rows.length}`], upsertErr.message);
        return json({ error: "Persist failed" }, 500);
      }
    }

    // Derive + persist the tier from the ledger (also fired by the insert trigger;
    // called explicitly to return the authoritative result).
    const { data: tier, error: projErr } = await admin.rpc("compute_membership", {
      p_user_id: userId,
    });
    if (projErr) {
      await audit("membership_projection_failed", [`user:${userId}`], projErr.message);
      return json({ error: "Projection failed" }, 500);
    }

    return json({ ok: true, imported: rows.length, tier }, 200);
  })
);
