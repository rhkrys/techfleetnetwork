// freescout-health — Admin-only probe for the Freescout integration.
// Returns { configured, reachable, latencyMs, reason? } so the System Health
// Help Desk tab can show a live banner without anyone digging through edge logs.
import { getAdminClient } from "../_shared/admin-client.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/http.ts";
import {
  getFreescoutConfig,
  freescoutFetch,
  FreescoutError,
  DEFAULT_MAILBOX_ID,
} from "../_shared/freescout.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = await requireAuthenticatedRequest(req, "freescout-health");
    if (auth instanceof Response) return auth;

    const admin = getAdminClient();
    const { data: isAdmin, error } = await admin
      .rpc("has_role", { _user_id: auth.userId, _role: "admin" });
    if (error || isAdmin !== true) return jsonResponse({ error: "Forbidden" }, 403);

    const recordTransition = async (status: "online" | "offline", reason?: string, detail?: string, latencyMs?: number) => {
      const { data: latest } = await admin
        .from("system_health_events")
        .select("status,reason")
        .eq("component", "freescout")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.status === status && (latest?.reason ?? null) === (reason ?? null)) return;
      await admin.from("system_health_events").insert({
        component: "freescout",
        status,
        reason: reason ?? null,
        detail: detail ?? null,
        metadata: { mailboxId: DEFAULT_MAILBOX_ID, latencyMs: latencyMs ?? null },
      });
    };

    const cfg = getFreescoutConfig();
    if (!cfg.ok) {
      await recordTransition("offline", cfg.reason, cfg.detail);
      return jsonResponse({
        configured: false,
        reachable: false,
        mailboxId: DEFAULT_MAILBOX_ID,
        reason: cfg.reason,
        detail: cfg.detail,
      });
    }

    const start = Date.now();
    try {
      await freescoutFetch({ path: "/api/mailboxes", timeoutMs: 3000, maxAttempts: 1 });
      const latencyMs = Date.now() - start;
      await recordTransition("online", undefined, undefined, latencyMs);
      return jsonResponse({
        configured: true,
        reachable: true,
        mailboxId: DEFAULT_MAILBOX_ID,
        latencyMs,
      });
    } catch (e) {
      const status = e instanceof FreescoutError ? e.status : 502;
      const latencyMs = Date.now() - start;
      const detail = `Upstream returned ${status}: ${e instanceof Error ? e.message : String(e)}`;
      await recordTransition("offline", "upstream_error", detail, latencyMs);
      return jsonResponse({
        configured: true,
        reachable: false,
        mailboxId: DEFAULT_MAILBOX_ID,
        latencyMs,
        reason: "upstream_error",
        detail,
      });
    }
  } catch (e) {
    return errorResponse(e);
  }
});
