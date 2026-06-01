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
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = await requireAuthenticatedRequest(req, "freescout-health");
    if (auth instanceof Response) return auth;

    const { data: isAdmin, error } = await getAdminClient()
      .rpc("has_role", { _user_id: auth.userId, _role: "admin" });
    if (error || isAdmin !== true) return jsonResponse({ error: "Forbidden" }, 403);

    const cfg = getFreescoutConfig();
    if (!cfg.ok) {
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
      return jsonResponse({
        configured: true,
        reachable: true,
        mailboxId: DEFAULT_MAILBOX_ID,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      const status = e instanceof FreescoutError ? e.status : 502;
      return jsonResponse({
        configured: true,
        reachable: false,
        mailboxId: DEFAULT_MAILBOX_ID,
        latencyMs: Date.now() - start,
        reason: "upstream_error",
        detail: `Upstream returned ${status}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  } catch (e) {
    return errorResponse(e);
  }
});
