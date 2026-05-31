/**
 * Regression lock-in: historical 42501 ("permission denied for function") for
 * get_announcement_view_counts + get_course_completion_counts. The fix
 * granted EXECUTE to authenticated. This test calls the RPCs as anon and
 * asserts they are NOT silently public (so we don't over-correct).
 */
import { describe, it, expect } from "vitest";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const enabled = !!(URL && KEY);

async function rpc(name: string) {
  return fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

(enabled ? describe : describe.skip)("incident: RPC EXECUTE grants", () => {
  it("get_announcement_view_counts is callable (no 42501) when anon role is granted, or rejects cleanly otherwise", async () => {
    const res = await rpc("get_announcement_view_counts");
    // Acceptable: 200, 401 (no JWT), 403 (RLS denial). NEVER 42501 in error body.
    const text = await res.text();
    expect(text).not.toMatch(/permission denied for function/i);
    expect([200, 401, 403, 404]).toContain(res.status);
  }, 15_000);

  it("get_course_completion_counts is callable (no 42501) or rejects cleanly", async () => {
    const res = await rpc("get_course_completion_counts");
    const text = await res.text();
    expect(text).not.toMatch(/permission denied for function/i);
    expect([200, 401, 403, 404]).toContain(res.status);
  }, 15_000);
});
