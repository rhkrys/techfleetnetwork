// @edge-cron
// support-provisioning-retry — cron-driven retry of failed Freescout provisioning rows.
// Drains rows with status='retry' (attempts < 5) at most 25/run.
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import {
  findUserByEmail,
  createUser,
  findCustomerByEmail,
  createCustomer,
  FreescoutError,
} from "../_shared/freescout.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

Deno.serve(
  withAuditWrapper("support-provisioning-retry", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    // Shared authorizer (legacy JWT or opaque sb_secret_*): consistent with the
    // other cron workers, survives a Supabase key-format rollover.
    const authz = authorizeServiceRoleRequest(req);
    if (!authz.ok) return jsonResponse({ error: authz.error }, authz.status);

    const admin = getAdminClient();
    const { data: pending, error: pErr } = await admin.rpc("support_pending_provisioning", {
      _limit: 25,
    });
    if (pErr) {
      console.error("[support-provisioning-retry] pending query failed:", pErr);
      return jsonResponse({ ok: false, error: "Failed to query pending provisioning" }, 500);
    }

    const results: Array<{ user_id: string; kind: string; status: string; error?: string }> = [];
    for (const row of (pending ?? []) as Array<{
      user_id: string;
      kind: string;
      attempts: number;
    }>) {
      // row.user_id is the AUTH uid (support_provisioning_log.user_id) — look up by
      // user_id, not the random profiles PK `id` (audit T-A). Keying on `id` here
      // silently failed every admin-path row and any auth-uid-keyed row.
      const { data: prof } = await admin
        .from("profiles")
        .select("id, email, first_name, last_name, freescout_user_id, freescout_customer_id")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (!prof?.email) {
        await admin.from("support_provisioning_log").insert({
          user_id: row.user_id,
          kind: row.kind,
          status: "failed",
          attempts: row.attempts + 1,
          last_error: "missing profile/email",
        });
        results.push({ user_id: row.user_id, kind: row.kind, status: "failed" });
        continue;
      }

      try {
        if (row.kind === "admin_user") {
          let id = prof.freescout_user_id;
          if (!id) {
            let u = await findUserByEmail(prof.email);
            if (!u)
              u = await createUser(
                prof.email,
                prof.first_name ?? "Admin",
                prof.last_name ?? "User"
              );
            id = String(u.id);
            await admin
              .from("profiles")
              .update({ freescout_user_id: id })
              .eq("user_id", row.user_id);
          }
          await admin.from("support_provisioning_log").insert({
            user_id: row.user_id,
            kind: "admin_user",
            freescout_id: id,
            status: "success",
            attempts: row.attempts + 1,
          });
        } else if (row.kind === "customer") {
          let id = prof.freescout_customer_id;
          if (!id) {
            let c = await findCustomerByEmail(prof.email);
            if (!c)
              c = await createCustomer(
                prof.email,
                prof.first_name ?? undefined,
                prof.last_name ?? undefined
              );
            id = String(c.id);
            await admin
              .from("profiles")
              .update({ freescout_customer_id: id })
              .eq("user_id", row.user_id);
          }
          await admin.from("support_provisioning_log").insert({
            user_id: row.user_id,
            kind: "customer",
            freescout_id: id,
            status: "success",
            attempts: row.attempts + 1,
          });
        }
        results.push({ user_id: row.user_id, kind: row.kind, status: "success" });
      } catch (e) {
        const msg = e instanceof FreescoutError ? e.message : "retry failed";
        const nextAttempts = row.attempts + 1;
        const nextStatus = nextAttempts >= 5 ? "failed" : "retry";
        await admin.from("support_provisioning_log").insert({
          user_id: row.user_id,
          kind: row.kind,
          status: nextStatus,
          attempts: nextAttempts,
          last_error: msg,
        });
        results.push({ user_id: row.user_id, kind: row.kind, status: nextStatus, error: msg });
      }
      // Soft pace — 1/sec
      await new Promise((r) => setTimeout(r, 1000));
    }

    return jsonResponse({ ok: true, processed: results.length, results });
  })
);
