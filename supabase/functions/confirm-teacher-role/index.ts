// @edge-public
// Audit Wave 1 (H13/T-G): teacher role confirmation.
// H13: teacher tokens were stored + looked up in PLAINTEXT; now verified by hash
// via verify_teacher_promotion_token (mirrors the admin path).
// T-G: the grant requires a POST carrying the TARGET user's bearer JWT (the
// signed-in owner clicks "Confirm" on /confirm-teacher). A bare GET, an email
// prefetch (no session), or a signed-in non-owner can no longer grant the role.
// Tokens are expiring + single-use (H12-parity).
import { createClient } from "npm:@supabase/supabase-js@2";
import { withAuditWrapper } from "../_shared/audit.ts";
import { evaluateConfirmation, type PromotionRow, TOKEN_RE } from "../_shared/confirm-role.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_ORIGINS = new Set([
  "https://techfleetnetwork.lovable.app",
  "https://www.techfleet.network",
  "https://techfleet.network",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const json = (obj: unknown, status: number) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(
  withAuditWrapper("confirm-teacher-role", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const origin = req.headers.get("Origin");

    let callerId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      callerId = user?.id ?? null;
    }

    let token: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        token = typeof body?.token === "string" ? body.token : null;
      } catch {
        token = null;
      }
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    let promotion: PromotionRow | null = null;
    if (req.method === "POST" && callerId && token && TOKEN_RE.test(token)) {
      const { data } = await admin.rpc("verify_teacher_promotion_token", { p_token: token });
      promotion = Array.isArray(data) ? ((data[0] as PromotionRow) ?? null) : null;
    }

    const decision = evaluateConfirmation({
      method: req.method,
      origin,
      allowedOrigins: ALLOWED_ORIGINS,
      callerId,
      token,
      promotion,
      nowMs: Date.now(),
    });

    switch (decision.kind) {
      case "method_not_allowed":
        return json({ error: "Method not allowed" }, 405);
      case "forbidden_origin":
        return json({ error: "Forbidden" }, 403);
      case "unauthenticated":
        return json(
          { error: "Sign in as the invited user to confirm this role", code: "auth_required" },
          401
        );
      case "bad_token":
        return json({ error: "Invalid or missing token" }, 400);
      case "not_found":
        return json({ error: "Invalid confirmation link" }, 404);
      case "already_confirmed":
        return json({ success: true, already_confirmed: true }, 200);
      case "expired":
        return json({ error: "This confirmation link has expired", code: "expired" }, 410);
      case "not_owner":
        return json(
          { error: "This invitation was issued to a different account", code: "not_owner" },
          403
        );
      case "grant":
        break;
    }

    const promo = promotion as PromotionRow;

    // Single-use claim (teacher_promotions has no hash-chain guard).
    const { data: claimed, error: claimErr } = await admin
      .from("teacher_promotions")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", promo.id)
      .is("confirmed_at", null)
      .select("id");
    if (claimErr) {
      console.error("Failed to claim teacher promotion:", claimErr);
      return json({ error: "Could not activate role" }, 500);
    }
    if (!claimed || claimed.length === 0) {
      return json({ success: true, already_confirmed: true }, 200);
    }

    const { error: roleErr } = await admin
      .from("user_roles")
      .upsert({ user_id: promo.user_id, role: "teacher" }, { onConflict: "user_id,role" });
    if (roleErr) {
      console.error("Failed to grant teacher role:", roleErr);
      return json({ error: "Could not activate role" }, 500);
    }

    await admin.rpc("write_audit_log", {
      p_event_type: "teacher_role_confirmed",
      p_table_name: "user_roles",
      p_record_id: promo.user_id,
      p_user_id: promo.user_id,
      p_changed_fields: ["role:teacher"],
    });

    return json({ success: true }, 200);
  })
);
