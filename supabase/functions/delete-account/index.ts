// @edge-auth required
import { createClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("delete-account");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Self-serve account deletion.
 *
 * REFACTOR (orphan prevention): we no longer manually delete child rows
 * before calling auth.admin.deleteUser. The DB trigger
 * `on_auth_user_deleted` (BEFORE DELETE on auth.users) cleans every
 * public.* child table inside one transaction. Doing it here too created
 * a window where the profile could be deleted but the auth row could
 * survive (e.g., on a transient network error), producing a "ghost"
 * account that blocked re-signup with the same email.
 *
 * Single source of truth: deleting auth.users is the ONLY entrypoint.
 */
Deno.serve(withAuditWrapper("delete-account", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `Request received [${requestId}]`, { requestId, method: req.method });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!clientKey) {
      throw new Error("Missing SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY for authenticated client creation.");
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      clientKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      log.warn("auth", `Invalid token [${requestId}]`, { requestId }, userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = user.id;
    log.info("auth", `User verified [${requestId}]: ${userId}`, { requestId, userId });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Single atomic delete — the on_auth_user_deleted trigger cascades to
    // every public.* table referencing this user_id.
    log.info("delete", `Deleting auth user ${userId} [${requestId}]`, { requestId, userId });
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) {
      log.error("delete", `Failed to delete auth user ${userId} [${requestId}]: ${deleteError.message}`, { requestId, userId }, deleteError);
      return new Response(
        JSON.stringify({ error: "Failed to delete account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log.info("handler", `Account deletion completed for ${userId} [${requestId}]`, { requestId, userId });
    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
