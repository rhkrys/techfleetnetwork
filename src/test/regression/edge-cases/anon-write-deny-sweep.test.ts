/**
 * Wave 3 (cont.) — EDGE-002 sweep: anon write attempts must be rejected by
 * RLS, never silently swallowed or returned as 5xx.
 *
 * For every sensitive table, fire a minimal POST and assert the response is
 * 4xx (401/403/409) with no row insertion side-effect. We never need to
 * clean up because the write must fail.
 */
import { describe, it, expect } from "vitest";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";
const enabled = !!(URL && KEY);

interface WriteCase {
  table: string;
  payload: Record<string, unknown>;
  scenarios: string[];
}

const CASES: WriteCase[] = [
  { table: "announcements", payload: { title: "anon", body_html: "x" }, scenarios: ["ANN-EDGE-002"] },
  { table: "audit_log", payload: { action: "anon-test" }, scenarios: ["AUD-LOG-EDGE-002"] },
  { table: "notifications", payload: { type: "anon", title: "x" }, scenarios: ["NOTIF-EDGE-002"] },
  { table: "project_blasts", payload: { subject: "x", body_html: "x" }, scenarios: ["PB-EDGE-002"] },
  { table: "classes", payload: { title: "anon" }, scenarios: ["TCH-EDGE-002"] },
  { table: "cookie_consents", payload: { categories: {} }, scenarios: ["PRIV-EDGE-002"] },
  { table: "dsar_requests", payload: { request_type: "access" }, scenarios: ["PRIV-EDGE-005"] },
  { table: "user_roles", payload: { user_id: "00000000-0000-0000-0000-000000000000", role: "admin" }, scenarios: ["SEC-EDGE-002"] },
  { table: "agent_fix_queue", payload: { fingerprint: "anon-x", title: "x" }, scenarios: ["TRIAGE-EDGE-002"] },
  { table: "web_vital_samples", payload: { metric: "LCP", value: 1 }, scenarios: ["PERF-EDGE-005"] },
  { table: "observer_role_grants", payload: { user_id: "00000000-0000-0000-0000-000000000000" }, scenarios: ["OBS-EDGE-002"] },
  { table: "email_send_log", payload: { recipient: "x@x.x", subject: "x" }, scenarios: ["EMAIL-DEL-EDGE-005"] },
  { table: "activity_log", payload: { action: "anon" }, scenarios: ["ACT-LOG-EDGE-002"] },
  { table: "cca_signatures", payload: { signed_at: new Date().toISOString() }, scenarios: ["CCA-EDGE-002"] },
];

(enabled ? describe : describe.skip)(
  "edge-case sweep: anon writes rejected (EDGE-002/-005)",
  () => {
    for (const { table, payload, scenarios } of CASES) {
      it(`${table} — anon POST rejected (${scenarios.join(", ")})`, async () => {
        const res = await fetch(`${URL}/rest/v1/${table}`, {
          method: "POST",
          headers: {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(payload),
        });
        await res.text(); // consume to prevent leak
        // Must NOT succeed (2xx) and must NOT 5xx.
        expect(res.status, `${table} unexpected ${res.status}`).toBeGreaterThanOrEqual(400);
        expect(res.status, `${table} 5xx`).toBeLessThan(500);
      }, 15_000);
    }
  },
);
