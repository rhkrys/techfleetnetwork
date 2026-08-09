// @edge-public
// Audit Wave 1 (H12/T-G): admin role confirmation.
// The grant now requires a POST carrying the TARGET user's bearer JWT (the
// signed-in owner clicks "Confirm" on the /confirm-admin page). A bare GET, an
// email prefetch (SafeLinks/AV — no session), or a signed-in non-owner can no
// longer silently activate an admin role. Token is verified by hash (H13-parity)
// and is expiring + single-use (H12).
import { createClient } from "npm:@supabase/supabase-js@2";
import { withAuditWrapper } from "../_shared/audit.ts";
import { evaluateConfirmation, type PromotionRow, TOKEN_RE } from "../_shared/confirm-role.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// CSRF defense-in-depth (the bearer-JWT ownership check is the primary gate).
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
  withAuditWrapper("confirm-admin-role", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const origin = req.headers.get("Origin");

    // Resolve caller identity from the bearer JWT (null if none/invalid).
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

    // Token arrives in the POST body.
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

    // Only look up the promotion once identity + token format are plausible, so an
    // unauthenticated or malformed request never touches the table.
    let promotion: PromotionRow | null = null;
    if (req.method === "POST" && callerId && token && TOKEN_RE.test(token)) {
      const { data } = await admin.rpc("verify_admin_promotion_token", { p_token: token });
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

    // Single-use claim (H12): atomically consume the token; only the first wins.
    // The service-role UPDATE is allowed past the admin_promotions hash-chain guard.
    const { data: claimed, error: claimErr } = await admin
      .from("admin_promotions")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", promo.id)
      .is("confirmed_at", null)
      .select("id");
    if (claimErr) {
      console.error("Failed to claim admin promotion:", claimErr);
      return json({ error: "Could not activate role" }, 500);
    }
    if (!claimed || claimed.length === 0) {
      return json({ success: true, already_confirmed: true }, 200);
    }

    // Grant the role (idempotent).
    const { error: roleErr } = await admin
      .from("user_roles")
      .upsert({ user_id: promo.user_id, role: "admin" }, { onConflict: "user_id,role" });
    if (roleErr) {
      console.error("Failed to grant admin role:", roleErr);
      return json({ error: "Could not activate role" }, 500);
    }

    await admin.rpc("write_audit_log", {
      p_event_type: "admin_role_confirmed",
      p_table_name: "user_roles",
      p_record_id: promo.user_id,
      p_user_id: promo.user_id,
      p_changed_fields: ["role:admin"],
    });

    return json({ success: true }, 200);
  })
);
