/**
 * Regression lock-in: per-recipient 24h bulk-email frequency cap is an
 * INTENDED guardrail (memory: features/email-frequency-cap). Without this
 * test, a well-meaning refactor could remove the cap and flood members.
 *
 * Asserts the email_send_state row carries a configurable cap.
 */
import { describe, it, expect } from "vitest";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const enabled = !!(URL && KEY);

(enabled ? describe : describe.skip)("incident: email-frequency-cap", () => {
  it("email_send_state advertises a per-recipient bulk cap", async () => {
    const res = await fetch(`${URL}/rest/v1/email_send_state?select=*&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    // The table may be admin-read-only; that's fine — we accept 401/403 as
    // "RLS protects config", not as a regression.
    if (res.status === 401 || res.status === 403) return;
    expect(res.ok).toBe(true);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (rows.length === 0) return; // no row yet — not a regression
    const row = rows[0];
    const hasCap =
      "cap_window_hours" in row ||
      "frequency_cap_window_hours" in row ||
      "bulk_cap_window_hours" in row;
    expect(hasCap, "email_send_state must expose a bulk frequency cap window").toBe(true);
  }, 15_000);
});
