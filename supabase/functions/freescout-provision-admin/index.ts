// @edge-auth
// freescout-provision-admin — auto-create a Freescout user for an admin
// Called by ConfirmAdminPage after the user_roles row is inserted.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { requireAdminRequest } from "../_shared/request-auth.ts";
import { handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { findUserByEmail, createUser, FreescoutError } from "../_shared/freescout.ts";

const Body = z.object({
  action: z.enum(["provision", "resend_invite", "deactivate"]).default("provision"),
  userId: z.string().uuid().optional(), // admin can act on behalf of another admin
});

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireAdminRequest(req, "freescout-provision-admin");
  if (auth instanceof Response) return auth;

  let parsed;
  try {
    parsed = Body.safeParse(await parseJsonBody(req, 16 * 1024));
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonResponse({ error: "Invalid body" }, 400);
  }
  if (!parsed.success) return jsonResponse({ error: "Invalid input" }, 400);

  const targetUserId = parsed.data.userId ?? auth.userId;
  const admin = getAdminClient();

  const { data: prof } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, freescout_user_id")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!prof?.email) return jsonResponse({ error: "Profile not found" }, 404);

  try {
    if (parsed.data.action === "provision") {
      if (prof.freescout_user_id) {
        return jsonResponse({ ok: true, freescoutUserId: prof.freescout_user_id, alreadyProvisioned: true });
      }
      let user = await findUserByEmail(prof.email);
      if (!user) {
        user = await createUser(prof.email, prof.first_name ?? "Admin", prof.last_name ?? "User");
      }
      const id = String(user.id);
      await admin.from("profiles").update({ freescout_user_id: id }).eq("id", targetUserId);
      await admin.from("support_provisioning_log").insert({
        user_id: targetUserId, kind: "admin_user", freescout_id: id, status: "success", attempts: 1,
      });
      // In-app notification
      try {
        await admin.from("notifications").insert({
          user_id: targetUserId,
          title: "Your help desk account is ready",
          body: "You can now triage support tickets at Get Help.",
          link: "/community/get-help",
          category: "support",
        });
      } catch { /* best effort */ }
      return jsonResponse({ ok: true, freescoutUserId: id });
    }
    return jsonResponse({ error: "Action not implemented" }, 501);
  } catch (e) {
    const msg = e instanceof FreescoutError ? e.message : "Provisioning failed";
    await admin.from("support_provisioning_log").insert({
      user_id: targetUserId, kind: "admin_user", status: "failed", attempts: 1, last_error: msg,
    });
    return jsonResponse({ error: msg }, 502);
  }
});
