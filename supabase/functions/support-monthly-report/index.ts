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
  if (error) {
    console.error("[support-monthly-report] refresh failed:", error);
    return jsonResponse({ ok: false, error: "Report refresh failed" }, 500);
  }
  // Best-effort prune of webhook events (7-day rolling window). The Supabase
  // PostgrestFilterBuilder is awaitable but not a Promise — chaining `.catch`
  // throws "catch is not a function" at runtime (root cause of 18 email_failed
  // rows on 2026-06-05). Always `await` and inspect `{ error }`.
  try {
    const { error: pruneErr } = await admin.rpc("support_prune_webhook_events");
    if (pruneErr) console.warn("support_prune_webhook_events failed:", pruneErr.message);
  } catch (e) {
    console.warn("support_prune_webhook_events threw:", e instanceof Error ? e.message : String(e));
  }
  return jsonResponse({ ok: true });
});
