#!/usr/bin/env node
/**
 * seed-e2e-fixtures — provision fixture data on the LOCAL Supabase instance
 * used by the CI e2e job (PRD B-01/B-09: local Docker, never a hosted project,
 * never production).
 *
 * Reads the local instance's URL + service-role key from env (the e2e job
 * exports them from `supabase status`). Creates a confirmed member + admin
 * test account so auth'd flows have someone to sign in as. Idempotent: safe
 * to re-run; existing users are left as-is.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SERVICE_ROLE_KEY) {
  console.error("::error::SUPABASE_SERVICE_ROLE_KEY missing — cannot seed e2e fixtures.");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) {
  console.error(
    `::error::Refusing to seed non-local instance (${SUPABASE_URL}). ` +
      "The e2e fixture seeder only ever targets the local Docker Supabase (PRD G-03)."
  );
  process.exit(1);
}

const FIXTURES = [
  { email: "e2e-member@techfleet.test", password: "E2e-member-pass-1!", role: null },
  { email: "e2e-admin@techfleet.test", password: "E2e-admin-pass-1!", role: "admin" },
];

async function adminFetch(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

let failures = 0;
for (const f of FIXTURES) {
  // Create the user (email pre-confirmed so no email flow is needed).
  const create = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: f.email, password: f.password, email_confirm: true }),
  });

  let userId = null;
  if (create.ok) {
    userId = (await create.json()).id;
    console.log(`created ${f.email} (${userId})`);
  } else if (create.status === 422) {
    // Already exists (idempotent re-run) — look it up.
    const list = await adminFetch(`/auth/v1/admin/users?page=1&per_page=100`);
    const body = await list.json().catch(() => ({}));
    const existing = (body.users ?? []).find((u) => u.email === f.email);
    if (existing) {
      userId = existing.id;
      console.log(`exists  ${f.email} (${userId})`);
    }
  }

  if (!userId) {
    console.error(
      `::error::could not create or find fixture user ${f.email} (HTTP ${create.status})`
    );
    failures += 1;
    continue;
  }

  // Grant role via user_roles (PostgREST with service role bypasses RLS).
  if (f.role) {
    const grant = await adminFetch("/rest/v1/user_roles", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify({ user_id: userId, role: f.role }),
    });
    if (!grant.ok && grant.status !== 409) {
      console.error(
        `::error::role grant failed for ${f.email}: HTTP ${grant.status} ${await grant.text()}`
      );
      failures += 1;
      continue;
    }
    console.log(`role    ${f.email} -> ${f.role}`);
  }
}

if (failures > 0) process.exit(1);
console.log("e2e fixtures seeded.");
