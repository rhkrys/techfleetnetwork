// @edge-auth
// freescout-validate-secret — admin-only live probe of a candidate API key.
// The admin Settings UI calls this BEFORE writing FREESCOUT_API_KEY so a bad
// key is rejected at the source. Runs ~twice in the secret's lifetime.
//
// Accepts the candidate in the body so we test it WITHOUT persisting it.
// Confirms HTTP 200 + DEFAULT_MAILBOX_ID is present in the response.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { handleCors, jsonResponse, errorResponse, parseJsonBody } from "../_shared/http.ts";
import { FREESCOUT_BASE_URL, DEFAULT_MAILBOX_ID } from "../_shared/freescout.ts";

const Body = z.object({
  candidateApiKey: z.string().min(8).max(2048),
});

Deno.serve(
  withAuditWrapper("freescout-validate-secret", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    try {
      const auth = await requireAuthenticatedRequest(req, "freescout-validate-secret");
      if (auth instanceof Response) return auth;

      const admin = getAdminClient();
      const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
        _user_id: auth.userId,
        _role: "admin",
      });
      if (roleErr || isAdmin !== true) return jsonResponse({ error: "Forbidden" }, 403);

      const parsed = Body.safeParse(await parseJsonBody(req, 8 * 1024));
      if (!parsed.success) return jsonResponse({ error: "Invalid input" }, 400);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const start = Date.now();
      let res: Response;
      try {
        res = await fetch(`${FREESCOUT_BASE_URL}/api/mailboxes`, {
          method: "GET",
          headers: {
            "X-FreeScout-API-Key": parsed.data.candidateApiKey,
            Accept: "application/json",
          },
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        return jsonResponse({
          ok: false,
          reason: "upstream_unreachable",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      if (res.status === 401 || res.status === 403) {
        return jsonResponse({ ok: false, reason: "invalid_key", status: res.status, latencyMs });
      }
      if (!res.ok) {
        return jsonResponse({
          ok: false,
          reason: "upstream_error",
          status: res.status,
          latencyMs,
        });
      }

      let body: { _embedded?: { mailboxes?: Array<{ id?: number }> } } = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }
      const mailboxes = body._embedded?.mailboxes ?? [];
      const ids = mailboxes.map((m) => Number(m.id)).filter((n) => Number.isFinite(n));
      const found = ids.includes(DEFAULT_MAILBOX_ID);

      if (!found) {
        return jsonResponse({
          ok: false,
          reason: "mailbox_not_found",
          detail: `DEFAULT_MAILBOX_ID=${DEFAULT_MAILBOX_ID} is not present in the Freescout mailboxes list (found: ${ids.join(", ") || "none"}). Edit _shared/freescout.ts and open a PR to use a valid mailbox id.`,
          availableMailboxIds: ids,
          latencyMs,
        });
      }

      return jsonResponse({
        ok: true,
        mailboxId: DEFAULT_MAILBOX_ID,
        availableMailboxIds: ids,
        latencyMs,
      });
    } catch (e) {
      return errorResponse(e);
    }
  })
);
