// @edge-auth
// freescout-sync-customer — syncs profile changes to the corresponding Freescout customer.
// Service-role only. Triggered by profile email change / soft-delete flows.
// OWASP A01 (service-role gated), A03 (Zod), A07 (no client trust), A09 (audited).
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { freescoutFetch, FreescoutError } from "../_shared/freescout.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";

const Body = z.object({
  userId: z.string().uuid(),
  action: z.enum(["sync", "anonymize"]).default("sync"),
});

Deno.serve(
  withAuditWrapper("freescout-sync-customer", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    // Shared authorizer (legacy JWT or opaque sb_secret_*): consistent with the
    // queue drainers, survives a Supabase key-format rollover.
    const authz = authorizeServiceRoleRequest(req);
    if (!authz.ok) return jsonResponse({ error: authz.error }, authz.status);

    let parsed;
    try {
      parsed = Body.safeParse(await parseJsonBody(req, 8 * 1024));
    } catch (e) {
      if (e instanceof Response) return e;
      return jsonResponse({ error: "Invalid body" }, 400);
    }
    if (!parsed.success) return jsonResponse({ error: "Invalid input" }, 400);

    const admin = getAdminClient();
    // `userId` is the AUTH uid (profiles.user_id) — the platform-standard identity.
    // Look up by user_id, NOT the random profiles PK `id` (audit T-A).
    const { data: prof } = await admin
      .from("profiles")
      .select("id, user_id, email, first_name, last_name, freescout_customer_id")
      .eq("user_id", parsed.data.userId)
      .maybeSingle();

    if (!prof) return jsonResponse({ error: "Profile not found" }, 404);
    if (!prof.freescout_customer_id) return jsonResponse({ ok: true, skipped: "no_customer" });

    try {
      if (parsed.data.action === "anonymize") {
        // Mark customer as deleted-by-user in Freescout (PUT with anonymized fields).
        await freescoutFetch({
          method: "PUT",
          path: `/api/customers/${encodeURIComponent(prof.freescout_customer_id)}`,
          body: {
            firstName: "Deleted",
            lastName: "Member",
            emails: [{ value: `deleted+${prof.id}@techfleet.invalid`, type: "work" }],
          },
        });
        await admin.from("support_provisioning_log").insert({
          user_id: prof.user_id,
          kind: "customer",
          freescout_id: prof.freescout_customer_id,
          status: "success",
          attempts: 1,
          last_error: "anonymized",
        });
        return jsonResponse({ ok: true });
      }

      // Sync (email/name change)
      await freescoutFetch({
        method: "PUT",
        path: `/api/customers/${encodeURIComponent(prof.freescout_customer_id)}`,
        body: {
          firstName: prof.first_name ?? undefined,
          lastName: prof.last_name ?? undefined,
          emails: prof.email ? [{ value: prof.email, type: "work" }] : undefined,
        },
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      const msg = e instanceof FreescoutError ? e.message : "Sync failed";
      await admin.from("support_provisioning_log").insert({
        user_id: prof.user_id,
        kind: "customer",
        freescout_id: prof.freescout_customer_id,
        status: "retry",
        attempts: 1,
        last_error: msg,
      });
      return jsonResponse({ error: msg }, 502);
    }
  })
);
