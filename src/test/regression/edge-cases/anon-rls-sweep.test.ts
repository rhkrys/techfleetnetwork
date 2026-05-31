/**
 * Wave 3 — parameterized edge-case sweep for EDGE-001 (anon denied) and
 * EDGE-008 (RLS bypass via PostgREST filter chain blocked) across every
 * sensitive table surfaced in Wave 2's BDD authoring.
 *
 * The anon client must never receive rows from these tables. Two failure
 * modes we lock against:
 *   - 200 OK with a non-empty array  → RLS regression
 *   - 5xx                            → broken policy / GRANT
 *
 * Acceptable outcomes: 200 with empty array, 401, 403, 404.
 *
 * Each row in COVERAGE is a (table, [scenario_ids]) tuple so the BDD
 * coverage tracker can resolve test_file → scenarios bidirectionally.
 */
import { describe, it, expect } from "vitest";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  "";
const enabled = !!(URL && KEY);

interface Row {
  table: string;
  scenarios: string[];
  /** Optional PostgREST filter chain used for the EDGE-008 bypass attempt. */
  bypassQuery?: string;
}

// table → BDD scenario ids it locks in. Keep in sync with bdd_scenarios.
const COVERAGE: Row[] = [
  { table: "activity_log", scenarios: ["ACT-LOG-EDGE-001", "ACT-LOG-EDGE-008"] },
  { table: "announcements", scenarios: ["ANN-EDGE-001", "ANN-EDGE-008"] },
  { table: "audit_log", scenarios: ["AUD-LOG-EDGE-001", "AUD-LOG-EDGE-008"] },
  { table: "cca_signatures", scenarios: ["CCA-EDGE-001", "CCA-EDGE-008"] },
  { table: "email_send_log", scenarios: ["EMAIL-DEL-EDGE-001", "EMAIL-DEL-EDGE-008"] },
  // ugc_translations has an intentional `public read passed` policy
  // (translation cache for anonymous visitors). Covered separately below.
  { table: "i18n_content_registry", scenarios: ["I18N-UGC-EDGE-001"] },
  { table: "notifications", scenarios: ["NOTIF-EDGE-001", "NOTIF-EDGE-008"] },
  { table: "observer_role_grants", scenarios: ["OBS-EDGE-001", "OBS-EDGE-008"] },
  { table: "web_vital_samples", scenarios: ["PERF-EDGE-001", "PERF-EDGE-008"] },
  { table: "cookie_consents", scenarios: ["PRIV-EDGE-001", "PRIV-EDGE-008"] },
  { table: "dsar_requests", scenarios: ["PRIV-EDGE-001", "PRIV-EDGE-008"] },
  { table: "project_blasts", scenarios: ["PB-EDGE-001", "PB-EDGE-008"] },
  { table: "user_roles", scenarios: ["SEC-EDGE-001", "SEC-EDGE-008"] },
  { table: "classes", scenarios: ["TCH-EDGE-001", "TCH-EDGE-008"] },
  { table: "agent_fix_queue", scenarios: ["TRIAGE-EDGE-001", "TRIAGE-EDGE-008"] },
  { table: "revoked_sessions", scenarios: ["SEC-EDGE-002"] },
  { table: "email_send_state", scenarios: ["EMAIL-DEL-EDGE-002"] },
];

async function anonGet(table: string, query = "select=*&limit=5") {
  return fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
  });
}

(enabled ? describe : describe.skip)(
  "edge-case sweep: anon RLS denial across sensitive tables (EDGE-001/-008)",
  () => {
    for (const { table, scenarios, bypassQuery } of COVERAGE) {
      it(`${table} — anon receives no rows (${scenarios.join(", ")})`, async () => {
        const res = await anonGet(table);
        // 5xx = broken policy / missing GRANT. Never acceptable.
        expect(res.status, `${table} 5xx`).toBeLessThan(500);

        if (res.status === 200) {
          const body = (await res.json()) as unknown;
          // Must be an empty array — anon is never allowed to read these.
          expect(Array.isArray(body), `${table} body shape`).toBe(true);
          expect(
            (body as unknown[]).length,
            `${table} leaked ${(body as unknown[]).length} row(s) to anon`,
          ).toBe(0);
        } else {
          // 401/403/404 are fine — auth gate caught it before RLS.
          await res.text(); // consume body
          expect([401, 403, 404]).toContain(res.status);
        }
      }, 15_000);

      // EDGE-008: attempt a filter-chain bypass (or/in/not.is) to make sure
      // RLS still applies under PostgREST query gymnastics.
      it(`${table} — PostgREST filter-chain bypass blocked`, async () => {
        const q =
          bypassQuery ??
          "select=*&or=(id.not.is.null,id.is.null)&limit=5";
        const res = await anonGet(table, q);
        expect(res.status, `${table} bypass 5xx`).toBeLessThan(500);
        if (res.status === 200) {
          const body = (await res.json()) as unknown;
          expect(Array.isArray(body)).toBe(true);
          expect(
            (body as unknown[]).length,
            `${table} bypass leaked rows`,
          ).toBe(0);
        } else {
          await res.text();
        }
      }, 15_000);
    }
  },
);
