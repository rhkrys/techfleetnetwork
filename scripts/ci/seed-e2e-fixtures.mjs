#!/usr/bin/env node
/**
 * seed-e2e-fixtures — provision fixture data on the LOCAL Supabase instance
 * used by the CI e2e job (PRD B-01/B-09: local Docker, never a hosted project,
 * never production).
 *
 * Reads the local instance's URL + service-role key from env (the e2e job
 * exports them from `supabase status`). Creates confirmed test accounts and a
 * deterministic class-curriculum fixture so auth'd flows have data to exercise.
 * Idempotent: safe to re-run; existing rows are left as-is / merged.
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
  // Curriculum fixtures: a teacher (owns the class) and an outsider (entitled to nothing).
  { email: "e2e-teacher@techfleet.test", password: "E2e-teacher-pass-1!", role: "teacher" },
  { email: "e2e-outsider@techfleet.test", password: "E2e-outsider-pass-1!", role: null },
];

// Deterministic ids so the e2e spec can address the fixture directly.
const CURRICULUM = {
  classId: "e2e0c1a5-0000-4000-8000-000000000001",
  cohortId: "e2e0c1a5-0000-4000-8000-000000000002",
  sectionId: "e2e0c1a5-0000-4000-8000-000000000003",
  module1Id: "e2e0c1a5-0000-4000-8000-000000000004",
  module2Id: "e2e0c1a5-0000-4000-8000-000000000005",
};

async function adminFetch(path, init = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Insert rows with the service role (bypasses RLS); ignore duplicate PKs. */
async function insert(table, rows) {
  const res = await adminFetch(`/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok && res.status !== 409) {
    console.error(`::error::seed ${table} failed: HTTP ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

let failures = 0;
const idByEmail = {};

for (const f of FIXTURES) {
  const create = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: f.email, password: f.password, email_confirm: true }),
  });

  let userId = null;
  if (create.ok) {
    userId = (await create.json()).id;
    console.log(`created ${f.email} (${userId})`);
  } else if (create.status === 422) {
    const list = await adminFetch(`/auth/v1/admin/users?page=1&per_page=100`);
    const body = await list.json().catch(() => ({}));
    const existing = (body.users ?? []).find((u) => u.email === f.email);
    if (existing) {
      userId = existing.id;
      console.log(`exists  ${f.email} (${userId})`);
    }
  }

  if (!userId) {
    // Surface the REAL error, not an opaque status. A GoTrue 500 on createUser
    // is almost always a DB trigger/constraint failure (e.g. handle_new_user or
    // a profiles trigger) — the body carries the message. Permanent diagnostic:
    // never let a fixture-seed failure be a mystery again.
    let detail = "";
    try {
      detail = await create.text();
    } catch {
      /* body already consumed */
    }
    console.error(
      `::error::could not create or find fixture user ${f.email} (HTTP ${create.status}) — ${detail || "no response body"}`
    );
    failures += 1;
    continue;
  }
  idByEmail[f.email] = userId;

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

// ── Curriculum fixture: a draft class owned by the teacher, a cohort the member
//    is registered in, and one published section with two published modules.
const teacherId = idByEmail["e2e-teacher@techfleet.test"];
const learnerId = idByEmail["e2e-member@techfleet.test"];
if (teacherId && learnerId) {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const ok = [
    await insert("classes", [
      {
        id: CURRICULUM.classId,
        owner_user_id: teacherId,
        track: "basic_training",
        title: "E2E Curriculum Class",
        slug: "e2e-curriculum-class",
        summary: "An end-to-end fixture class for curriculum authoring tests.",
        status: "draft",
      },
    ]),
    await insert("cohorts", [
      {
        id: CURRICULUM.cohortId,
        class_id: CURRICULUM.classId,
        label: "E2E Cohort",
        start_date: today,
        end_date: end,
        timezone: "UTC",
        registration_url: "https://example.com/register",
        status: "draft",
      },
    ]),
    await insert("cohort_registrations", [{ cohort_id: CURRICULUM.cohortId, user_id: learnerId }]),
    await insert("class_module_sections", [
      {
        id: CURRICULUM.sectionId,
        class_id: CURRICULUM.classId,
        title: "Section 1",
        position: 1,
        status: "published",
        created_by: teacherId,
      },
    ]),
    await insert("class_module_items", [
      {
        id: CURRICULUM.module1Id,
        section_id: CURRICULUM.sectionId,
        class_id: CURRICULUM.classId,
        title: "Module 1",
        position: 1,
        content_html: "<p>lesson one</p>",
        required: true,
        status: "published",
        created_by: teacherId,
      },
      {
        id: CURRICULUM.module2Id,
        section_id: CURRICULUM.sectionId,
        class_id: CURRICULUM.classId,
        title: "Module 2",
        position: 2,
        content_html: "<p>lesson two</p>",
        required: true,
        status: "published",
        created_by: teacherId,
      },
    ]),
  ];
  if (ok.every(Boolean)) console.log("curriculum fixture seeded.");
  else failures += 1;
} else {
  console.error("::error::teacher/learner fixture ids missing — cannot seed curriculum fixture.");
  failures += 1;
}

if (failures > 0) process.exit(1);
console.log("e2e fixtures seeded.");
