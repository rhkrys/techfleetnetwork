// @edge-auth
// freescout-provision-customer — auto-create a Freescout customer record for
// a new platform member. Idempotent: no-ops if profiles.freescout_customer_id
// is already set. Called by:
//   * support-provisioning-retry cron (drains support_provisioning_log retry rows)
//   * Optionally directly by other server code if eager provisioning is needed.
//
// Service-role gated. Members never call this directly.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { findCustomerByEmail, createCustomer, FreescoutError } from "../_shared/freescout.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";

const Body = z.object({
  userId: z.string().uuid(),
});

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  // Shared authorizer: accepts a legacy service-role JWT OR an opaque
  // sb_secret_* token, so a Supabase key-format rollover can't 401-storm this
  // worker while the queue drainers keep working. (Was a bespoke string-equal.)
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
  // `userId` is the AUTH uid (profiles.user_id) — look up by user_id, never the
  // random profiles PK `id` (audit T-A).
  const { data: prof } = await admin
    .from("profiles")
    .select("id, user_id, email, first_name, last_name, freescout_customer_id")
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (!prof) return jsonResponse({ error: "Profile not found" }, 404);
  if (!prof.email) {
    return jsonResponse({ error: "Profile missing email" }, 412);
  }

  if (prof.freescout_customer_id) {
    return jsonResponse({
      ok: true,
      freescoutCustomerId: prof.freescout_customer_id,
      alreadyProvisioned: true,
    });
  }

  try {
    let customer = await findCustomerByEmail(prof.email);
    if (!customer) {
      customer = await createCustomer(
        prof.email,
        prof.first_name ?? undefined,
        prof.last_name ?? undefined
      );
    }
    const id = String(customer.id);
    await admin
      .from("profiles")
      .update({ freescout_customer_id: id })
      .eq("user_id", parsed.data.userId);
    await admin.from("support_provisioning_log").insert({
      user_id: parsed.data.userId,
      kind: "customer",
      freescout_id: id,
      status: "success",
      attempts: 1,
    });
    return jsonResponse({ ok: true, freescoutCustomerId: id });
  } catch (e) {
    const msg = e instanceof FreescoutError ? e.message : "Provisioning failed";
    await admin.from("support_provisioning_log").insert({
      user_id: parsed.data.userId,
      kind: "customer",
      status: "retry",
      attempts: 1,
      last_error: msg,
    });
    return jsonResponse({ error: msg }, 502);
  }
});
