// Resolves the calling admin's Freescout user id, provisioning on demand.
// Used by freescout-proxy `reply` (admin branch) and `assign` (self) actions
// so admins never have to manually run freescout-provision-admin first.
//
// Robustness contract (HELP-DESK-067/068):
//   1. Profile lookup MUST be by `user_id` (auth.uid), never `id` (row PK).
//      The PK never equals the auth uid for any of our 628 profile rows;
//      using `id` here was the root cause of "Assign me" 404s.
//   2. If the profile row is missing entirely we self-heal from
//      `auth.users` rather than 404'ing the admin's click. Self-heal is
//      idempotent (insert ... on conflict do nothing via upsert) and is
//      audited as severity:info / action:profile_self_heal so it never
//      reaches the Triage queue (which filters out non-error rows).
//   3. If `auth.users` also can't supply an email we surface a 412 with
//      actionable copy instead of a generic 500.

import { getAdminClient } from "./admin-client.ts";
import { auditEdgeEvent } from "./audit.ts";
import { findUserByEmail, createUser, FreescoutError } from "./freescout.ts";

interface ProfileSlim {
  id: string;
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  freescout_user_id: string | null;
}

async function fetchProfileByAuthUid(userId: string): Promise<ProfileSlim | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, user_id, email, first_name, last_name, freescout_user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new FreescoutError(500, `Profile lookup failed: ${error.message}`);
  }
  return (data as ProfileSlim | null) ?? null;
}

/**
 * Best-effort: materialize a `profiles` row from `auth.users` so the next
 * lookup succeeds. Idempotent — on conflict we re-read the existing row.
 * Returns null only when auth.users itself can't supply an email (rare;
 * implies a corrupted auth user that needs manual intervention).
 */
async function selfHealProfile(
  userId: string,
  traceId?: string | null
): Promise<ProfileSlim | null> {
  const admin = getAdminClient();
  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
  if (authErr || !authUser?.user) return null;
  const email = authUser.user.email ?? null;
  if (!email) return null;

  const meta = (authUser.user.user_metadata ?? {}) as Record<string, unknown>;
  const firstName =
    (typeof meta.first_name === "string" && meta.first_name) ||
    (typeof meta.given_name === "string" && meta.given_name) ||
    email.split("@")[0] ||
    "Member";
  const lastName =
    (typeof meta.last_name === "string" && meta.last_name) ||
    (typeof meta.family_name === "string" && meta.family_name) ||
    "";

  // Idempotent insert; if a row already exists for user_id we keep it.
  // We use upsert on the unique user_id index — NOT touching freescout_*
  // columns so existing provisioning state is preserved.
  await admin.from("profiles").upsert(
    {
      user_id: userId,
      email,
      first_name: String(firstName),
      last_name: String(lastName),
    },
    { onConflict: "user_id", ignoreDuplicates: false }
  );

  void auditEdgeEvent(admin, {
    fn: "freescout-admin",
    event: "profile_self_heal",
    table: "profiles",
    recordId: userId,
    userId,
    traceId: traceId ?? null,
    severity: "info",
    fields: ["action:profile_self_heal", "source:freescout_admin"],
  });

  return await fetchProfileByAuthUid(userId);
}

export async function resolveAdminFreescoutUserId(
  userId: string,
  opts: { traceId?: string | null } = {}
): Promise<number> {
  const admin = getAdminClient();

  // 1. Primary lookup by auth uid (root-cause fix: was .eq("id", userId)).
  let prof = await fetchProfileByAuthUid(userId);

  // 2. Self-heal: missing row → materialize from auth.users, then retry.
  if (!prof) {
    prof = await selfHealProfile(userId, opts.traceId ?? null);
    if (!prof) {
      throw new FreescoutError(
        412,
        "Admin account is missing required profile metadata — contact support."
      );
    }
  }

  // 3. Already provisioned in Freescout? Return cached id.
  if (prof.freescout_user_id) {
    const n = Number(prof.freescout_user_id);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 4. Resolve email — profile is source of truth, auth.users is fallback.
  let email = prof.email;
  let firstName = prof.first_name ?? "Admin";
  let lastName = prof.last_name ?? "User";
  if (!email) {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    email = authUser?.user?.email ?? null;
    const meta = (authUser?.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (!firstName || firstName === "Admin") {
      firstName = (typeof meta.first_name === "string" && meta.first_name) || firstName;
    }
    if (!lastName || lastName === "User") {
      lastName = (typeof meta.last_name === "string" && meta.last_name) || lastName;
    }
  }
  if (!email) {
    throw new FreescoutError(412, "Admin email missing — cannot provision helpdesk account.");
  }

  // 5. Provision inline (idempotent — Freescout findUserByEmail wins on collision).
  let user = await findUserByEmail(email);
  if (!user) {
    user = await createUser(email, firstName, lastName);
  }
  const id = Number(user.id);
  if (!Number.isFinite(id) || id <= 0) {
    throw new FreescoutError(502, "Helpdesk provisioning returned no user id.");
  }

  // Persist by auth uid (matches other proxy writes after the freescout-proxy
  // column-mismatch fix). support_provisioning_log.user_id is the AUTH uid too,
  // after the identity standardization (audit T-A).
  await admin
    .from("profiles")
    .update({ freescout_user_id: String(id) })
    .eq("user_id", userId);
  await admin.from("support_provisioning_log").insert({
    user_id: userId,
    kind: "admin_user",
    freescout_id: String(id),
    status: "success",
    attempts: 1,
  });
  return id;
}
