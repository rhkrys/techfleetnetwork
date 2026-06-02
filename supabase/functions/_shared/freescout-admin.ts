// Resolves the calling admin's Freescout user id, provisioning on demand.
// Used by freescout-proxy `reply` (admin branch) and `assign` (self) actions
// so admins never have to manually run freescout-provision-admin first.
import { getAdminClient } from "./admin-client.ts";
import { findUserByEmail, createUser, FreescoutError } from "./freescout.ts";

export async function resolveAdminFreescoutUserId(userId: string): Promise<number> {
  const admin = getAdminClient();
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, freescout_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new FreescoutError(500, `Profile lookup failed: ${error.message}`);
  }
  if (!prof) throw new FreescoutError(404, "Profile not found");

  if (prof.freescout_user_id) {
    const n = Number(prof.freescout_user_id);
    if (Number.isFinite(n) && n > 0) return n;
  }

  if (!prof.email) {
    throw new FreescoutError(412, "Admin email missing — cannot provision helpdesk account.");
  }

  // Provision inline (idempotent — Freescout findUserByEmail wins on collision).
  let user = await findUserByEmail(prof.email);
  if (!user) {
    user = await createUser(prof.email, prof.first_name ?? "Admin", prof.last_name ?? "User");
  }
  const id = Number(user.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new FreescoutError(502, "Helpdesk provisioning returned no user id.");
  }
  await admin.from("profiles").update({ freescout_user_id: String(id) }).eq("id", userId);
  await admin.from("support_provisioning_log").insert({
    user_id: userId, kind: "admin_user", freescout_id: String(id), status: "success", attempts: 1,
  });
  return id;
}
