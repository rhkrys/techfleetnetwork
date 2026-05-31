/**
 * Regression lock-in: historical 42501 ("permission denied for function") for
 * get_announcement_view_counts + get_course_completion_counts. The fix
 * granted EXECUTE to authenticated. As anon, we expect denial — what we
 * MUST never see again is 42883 (function missing) or 500. Authenticated
 * paths are covered by the e2e admin journeys.
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
  for (const fn of ["get_announcement_view_counts", "get_course_completion_counts"]) {
    it(`${fn} exists and is wired (no 42883, no 5xx)`, async () => {
      const res = await rpc(fn);
      const text = await res.text();
      // Function-missing would mean GRANT regression on the function itself.
      expect(text).not.toMatch(/does not exist|42883/i);
      // Anything 4xx is acceptable as anon; 5xx means broken wiring.
      expect(res.status).toBeLessThan(500);
    }, 15_000);
  }
});

