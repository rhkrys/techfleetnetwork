// @edge-auth
/**
 * Gumroad reconcile — thin login-time safety net.
 *
 * Resolves any of the caller's PENDING sales (paid before signup, or a webhook
 * that couldn't match a user yet) to their account by VERIFIED token email, then
 * projects. Tier is derived by public.compute_membership() from the ledger +
 * the membership_products catalog — never keyword-guessed here, and only
 * cataloged membership products grant "Early Career Membership".
 *
 * Most recognition now happens server-side (webhook + profile-insert trigger);
 * this remains a cheap belt-and-suspenders call on login.
 *
 * Security (OWASP): verify_jwt=true; identity from the verified token only
 * (never client-supplied email) -> no cross-account resolution (IDOR).
 */
import { withAuditWrapper, auditEdgeEvent } from "../_shared/audit.ts";
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Neutralize LIKE/ILIKE wildcards so an email containing `%`/`_` can't widen
 *  the match to another user's pending sale (IDOR). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

Deno.serve(
  withAuditWrapper("gumroad-reconcile", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);

    const userId = claims.claims.sub as string;
    const email = (claims.claims.email as string | undefined)?.toLowerCase();
    if (!email) return json({ ok: true, applied: 0, reason: "no_email" }, 200);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Bind any unresolved sales for this verified email to this user. Each update
    // fires the projection trigger; compute_membership derives the tier.
    const { error: bindErr, count } = await admin
      .from("gumroad_sales")
      .update(
        { resolved_user_id: userId, status: "applied", processed_at: new Date().toISOString() },
        { count: "exact" }
      )
      .ilike("email", escapeLike(email))
      .is("resolved_user_id", null);
    if (bindErr) {
      void auditEdgeEvent(getAdminClient(), {
        fn: "gumroad-reconcile", event: "gumroad_reconcile_failed", table: "gumroad_sales",
        severity: "error", fields: [`user:${userId}`], errorMessage: bindErr.message,
      });
      return json({ error: "Reconcile failed" }, 500);
    }

    // Project (idempotent; also covers the case where sales were already bound).
    const { data: tier, error: projErr } = await admin.rpc("compute_membership", {
      p_user_id: userId,
    });
    if (projErr) {
      void auditEdgeEvent(getAdminClient(), {
        fn: "gumroad-reconcile", event: "membership_projection_failed", table: "gumroad_sales",
        severity: "error", fields: [`user:${userId}`], errorMessage: projErr.message,
      });
      return json({ error: "Projection failed" }, 500);
    }

    return json({ ok: true, applied: count ?? 0, tier }, 200);
  })
);
