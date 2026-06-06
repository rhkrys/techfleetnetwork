// @edge-cron
// support-monthly-report — refreshes the Help Desk monthly MV. Cron-driven.
// Service-role gated; idempotent; no user input.
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";

function isServiceRole(req: Request): boolean {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return token.length > 0 && secret.length > 0 && token === secret;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (!isServiceRole(req)) return jsonResponse({ error: "Unauthorized" }, 401);

  const admin = getAdminClient();
  const { error } = await admin.rpc("refresh_support_monthly_report");
  if (error) return jsonResponse({ ok: false, error: error.message }, 500);
  // Best-effort prune of webhook events (7-day rolling window)
  await admin.rpc("support_prune_webhook_events").catch(() => null);
  return jsonResponse({ ok: true });
});
