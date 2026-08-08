import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * Guards audit C3: support ticket identity must be the AUTH uid (profiles.user_id)
 * everywhere — RLS filters `customer_user_id = auth.uid()`, so the FK and every
 * writer must use profiles.user_id, NOT the random PK profiles.id. Writing
 * profiles.id made drain-created tickets invisible and broke idempotency.
 */
describe("support ticket customer_user_id identity (C3)", () => {
  it("process-freescout-events stores profiles.user_id, not profiles.id", () => {
    const src = read("supabase/functions/process-freescout-events/index.ts");
    expect(src).toMatch(/customerUserId\s*=\s*prof\.user_id/);
    expect(src).not.toMatch(/customerUserId\s*=\s*prof\.id\b/);
    // must select user_id to use it
    expect(src).toMatch(/\.select\(\s*["']id, user_id/);
  });

  it("the migration re-points the FK to profiles(user_id)", () => {
    const mig = read(
      "supabase/migrations/20260808140000_fix_support_customer_user_id_identity.sql"
    );
    expect(mig).toMatch(/DROP CONSTRAINT IF EXISTS support_ticket_pointers_customer_user_id_fkey/);
    expect(mig).toMatch(/REFERENCES public\.profiles\(user_id\)/);
    expect(mig).not.toMatch(/REFERENCES public\.profiles\(id\)/);
  });

  it("web + Discord create paths use the auth uid for the identity key", () => {
    const proxy = read("supabase/functions/freescout-proxy/index.ts");
    // ownership + idempotency keyed on the caller's auth uid
    expect(proxy).toMatch(/\.eq\("customer_user_id",\s*auth\.userId\)/);
    const shared = read("supabase/functions/_shared/support-ticket.ts");
    expect(shared).toMatch(/\.eq\("customer_user_id",\s*userId\)/);
  });
});
