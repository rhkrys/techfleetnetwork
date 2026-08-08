import { test, expect } from "@playwright/test";

/**
 * Class Curriculum Authoring v2 — over-the-wire RPC/RLS e2e.
 *
 * Signs in as the seeded teacher / learner / outsider via the auth REST endpoint
 * and exercises the real RPCs through PostgREST against the LOCAL Supabase
 * (CI e2e job). This proves the grants + RLS + release engine end-to-end over
 * the wire — the layer pgTAP's in-process SET ROLE cannot fully replicate.
 *
 * Fixtures are provisioned by scripts/ci/seed-e2e-fixtures.mjs (deterministic
 * ids). Requires the local-Supabase env the e2e job exports; skips otherwise.
 *
 * Covers BDD CURR-LEARN-001 (learner sees published+released; locked hidden) and
 * the server-enforced release gate (F1) end-to-end.
 */
const URL = process.env.SUPABASE_URL ?? "";
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

const FX = {
  classId: "e2e0c1a5-0000-4000-8000-000000000001",
  module1Id: "e2e0c1a5-0000-4000-8000-000000000004",
  teacher: { email: "e2e-teacher@techfleet.test", password: "E2e-teacher-pass-1!" },
  learner: { email: "e2e-member@techfleet.test", password: "E2e-member-pass-1!" },
  outsider: { email: "e2e-outsider@techfleet.test", password: "E2e-outsider-pass-1!" },
};

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `sign-in failed for ${email}: ${res.status}`).toBeTruthy();
  return (await res.json()).access_token as string;
}

async function rpc(token: string, name: string, args: Record<string, unknown>) {
  return fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

async function readCurriculum(token: string) {
  const res = await rpc(token, "get_class_curriculum_for_learner", { p_class_id: FX.classId });
  return res;
}

test.describe("Class curriculum — server-enforced release (RPC e2e) @critical", () => {
  // Serial: the by_date test mutates the class policy and restores it.
  test.describe.configure({ mode: "serial", retries: 1 });

  test.skip(!URL || !ANON, "requires local Supabase env (CI e2e job only)");

  test("learner sees a published module with its body under all_at_once", async () => {
    const token = await signIn(FX.learner.email, FX.learner.password);
    const res = await readCurriculum(token);
    expect(res.ok).toBeTruthy();
    const data = await res.json();
    const item = data?.sections?.[0]?.items?.[0];
    expect(item, "expected at least one section/module").toBeTruthy();
    expect(item.released).toBe(true);
    expect(item.content_html).toBeTruthy(); // body present when released
  });

  test("a future by_date lock hides the body from the learner (F1)", async () => {
    const teacher = await signIn(FX.teacher.email, FX.teacher.password);
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    const setRes = await rpc(teacher, "set_class_release_policy", {
      p_class_id: FX.classId,
      p_policy: "by_date",
      p_release_at: future,
      p_offset_days: null,
    });
    expect(setRes.ok, `set_class_release_policy failed: ${setRes.status}`).toBeTruthy();

    try {
      const learner = await signIn(FX.learner.email, FX.learner.password);
      const data = await (await readCurriculum(learner)).json();
      const item = data?.sections?.[0]?.items?.[0];
      expect(item.released).toBe(false); // locked
      expect(item.content_html).toBeNull(); // body omitted server-side
      expect(item.available_at).toBeTruthy(); // "Available on…" metadata present
    } finally {
      // Restore so the fixture ends in its default state.
      await rpc(teacher, "set_class_release_policy", {
        p_class_id: FX.classId,
        p_policy: "all_at_once",
        p_release_at: null,
        p_offset_days: null,
      });
    }
  });

  test("a non-entitled outsider is forbidden from the curriculum", async () => {
    const token = await signIn(FX.outsider.email, FX.outsider.password);
    const res = await readCurriculum(token);
    expect(res.ok).toBeFalsy(); // RAISE forbidden (42501) → PostgREST error status
  });

  test("an outsider cannot mark a module complete", async () => {
    const token = await signIn(FX.outsider.email, FX.outsider.password);
    const res = await rpc(token, "toggle_class_module_completion", {
      p_item_id: FX.module1Id,
      p_completed: true,
    });
    expect(res.ok).toBeFalsy();
  });
});
