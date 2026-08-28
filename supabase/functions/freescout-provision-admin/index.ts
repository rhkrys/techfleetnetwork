// @edge-auth
// freescout-provision-admin — auto-create a Freescout user for an admin
// Called by ConfirmAdminPage after the user_roles row is inserted.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { requireAdminRequest } from "../_shared/request-auth.ts";
import { handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { findUserByEmail, createUser, FreescoutError } from "../_shared/freescout.ts";

const Body = z.object({
  action: z.enum(["provision", "resend_invite", "deactivate"]).default("provision"),
  userId: z.string().uuid().optional(), // admin can act on behalf of another admin
});

Deno.serve(
  withAuditWrapper("freescout-provision-admin", async (req) => {
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

    // On-behalf-of provisioning: the target must itself be an admin — you cannot
    // mint a Freescout staff user for a non-admin. (Self-provisioning is already
    // gated by requireAdminRequest above.)
    if (parsed.data.userId && parsed.data.userId !== auth.userId) {
      const { data: targetIsAdmin } = await admin.rpc("has_role", {
        _user_id: parsed.data.userId,
        _role: "admin",
      });
      if (targetIsAdmin !== true) return jsonResponse({ error: "Target must be an admin" }, 422);
    }

    // Look up by auth uid (user_id), NEVER the row PK (id): the PK never equals
    // auth.uid() for any profile row, so `.eq("id", authUid)` 404'd every default
    // self-provision (same root cause as the historical "Assign me" 404s fixed in
    // _shared/freescout-admin.ts).
    const { data: prof } = await admin
      .from("profiles")
      .select("id, email, first_name, last_name, freescout_user_id")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!prof?.email) return jsonResponse({ error: "Profile not found" }, 404);

    try {
      if (parsed.data.action === "provision") {
        if (prof.freescout_user_id) {
          return jsonResponse({
            ok: true,
            freescoutUserId: prof.freescout_user_id,
            alreadyProvisioned: true,
          });
        }
        let user = await findUserByEmail(prof.email);
        if (!user) {
          user = await createUser(prof.email, prof.first_name ?? "Admin", prof.last_name ?? "User");
        }
        const id = String(user.id);
        await admin.from("profiles").update({ freescout_user_id: id }).eq("user_id", targetUserId);
        // support_provisioning_log.user_id is the AUTH uid (audit T-A) — matches the
        // trigger/backfill/retry convention after the identity standardization.
        await admin.from("support_provisioning_log").insert({
          user_id: targetUserId,
          kind: "admin_user",
          freescout_id: id,
          status: "success",
          attempts: 1,
        });
        // In-app notification keys on auth uid.
        try {
          await admin.from("notifications").insert({
            user_id: targetUserId,
            title: "Your help desk account is ready",
            body: "You can now triage support tickets at Get Help.",
            link: "/community/get-help",
            category: "support",
          });
        } catch {
          /* best effort */
        }
        return jsonResponse({ ok: true, freescoutUserId: id });
      }
      // resend_invite / deactivate: FreeScout's REST API exposes no user-status
      // mutation, so there is nothing to call. This is NOT an offboarding gap:
      // every Freescout action is brokered through freescout-proxy, which gates on
      // has_role(admin) — so revoking the platform admin role fully removes support
      // access. The lingering Freescout user is inert (admins are created with
      // sendInvite:false and never hold a Freescout login).
      return jsonResponse(
        {
          error: "Not supported by the help desk API — manage admin access via platform roles",
          action: parsed.data.action,
        },
        501
      );
    } catch (e) {
      const msg = e instanceof FreescoutError ? e.message : "Provisioning failed";
      await admin.from("support_provisioning_log").insert({
        user_id: targetUserId,
        kind: "admin_user",
        status: "failed",
        attempts: 1,
        last_error: msg,
      });
      return jsonResponse({ error: msg }, 502);
    }
  })
);
