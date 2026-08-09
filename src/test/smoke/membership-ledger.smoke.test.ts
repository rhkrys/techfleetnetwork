// Smoke coverage for the Early Career Membership ledger→projection feature.
//
// Backs BDD scenarios MEM-LEDGER-001..012. Following the repo's hermetic
// file-content convention (no DB/network — those live in the pgTAP suite
// supabase/tests/membership_ledger_test.sql, run via `supabase db test`).
//
// Each test guards a SECURITY or CORRECTNESS invariant of the design. If one
// fails, an invariant has regressed — fix the source, do not relax the test.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const migrationsDir = resolve(REPO, "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(`supabase/migrations/${f}`))
  .join("\n---\n");

const ledgerMigration =
  readdirSync(migrationsDir)
    .filter((f) => /membership_ledger_projection\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

const webhook = read("supabase/functions/gumroad-webhook/index.ts");
// H10 extracted lifecycle classification + timestamp patching into a sibling
// module (unit-tested in lifecycle.test.ts); the columns live here now.
const webhookLifecycle = read("supabase/functions/gumroad-webhook/lifecycle.ts");
const backfill = read("supabase/functions/gumroad-backfill/index.ts");
const reconcile = read("supabase/functions/gumroad-reconcile/index.ts");
const tiers = read("src/config/membership-tiers.ts");
const hook = read("src/hooks/use-membership-realtime.ts");

describe("Early Career Membership ledger→projection (smoke)", () => {
  it("MEM-LEDGER-001: the migration exists and defines the projector as the single writer", () => {
    expect(ledgerMigration).toBeTruthy();
    expect(ledgerMigration).toMatch(/create or replace function public\.compute_membership\(/i);
    expect(ledgerMigration).toMatch(/COMMENT ON FUNCTION public\.compute_membership/i);
  });

  it("MEM-LEDGER-002: every SECURITY DEFINER function pins an empty search_path (no hijack/SQLi)", () => {
    // Strip line comments first (prose mentions "SECURITY DEFINER" too). In
    // real function defs the pin immediately follows the qualifier.
    const sql = ledgerMigration.replace(/--.*$/gm, "");
    const definerBlocks = sql.match(/security definer[\s\S]{0,60}/gi) ?? [];
    expect(definerBlocks.length).toBeGreaterThan(0);
    for (const block of definerBlocks) {
      expect(block).toMatch(/set search_path\s*=\s*''/i);
    }
  });

  it("MEM-LEDGER-003: membership_* columns are guarded — only the projector may write them", () => {
    expect(ledgerMigration).toMatch(/guard_profile_membership_columns/i);
    expect(ledgerMigration).toMatch(/app\.membership_writer/);
    expect(ledgerMigration).toMatch(
      /create trigger trg_guard_profile_membership[\s\S]*?before insert or update on public\.profiles/i
    );
    // The projector authorizes its own write via the txn-local flag.
    expect(ledgerMigration).toMatch(
      /set_config\(\s*['"]app\.membership_writer['"]\s*,\s*['"]on['"]\s*,\s*true\s*\)/i
    );
    // Backward-compat + trust boundary: service_role is exempt (members are not).
    expect(ledgerMigration).toMatch(/auth\.role\(\)\s*=\s*['"]service_role['"]/i);
  });

  it("MEM-LEDGER-004: tier is catalog-gated — uncataloged products grant nothing (SETOF lookup)", () => {
    expect(ledgerMigration).toMatch(
      /create or replace function public\.membership_catalog_lookup[\s\S]*?returns setof public\.membership_products/i
    );
    // The projector joins sales THROUGH the catalog lookup (LATERAL), so a
    // non-matching product yields no row and is excluded.
    expect(ledgerMigration).toMatch(/join lateral public\.membership_catalog_lookup/i);
  });

  it("MEM-LEDGER-005: founding is a permanent latch — set by a non-refunded founding sale, not revoked by cancellation", () => {
    expect(ledgerMigration).toMatch(/c\.is_founding[\s\S]*?gs\.refunded_at is null/i);
    // The latch must NOT reference subscription_ended/cancelled (cancellation-proof).
    const foundingBlock =
      ledgerMigration.match(
        /SELECT EXISTS \([\s\S]*?is_founding[\s\S]*?\) INTO v_founding/i
      )?.[0] ?? "";
    expect(foundingBlock).toBeTruthy();
    expect(foundingBlock).not.toMatch(/subscription_ended_at|subscription_cancelled_at/i);
  });

  it("MEM-LEDGER-006: access tier counts only ACTIVE sales — refund/dispute/ended downgrade", () => {
    // The tier query excludes refunded, disputed, and ended sales.
    expect(ledgerMigration).toMatch(
      /gs\.refunded_at is null[\s\S]*?gs\.disputed_at is null[\s\S]*?gs\.subscription_ended_at is null/i
    );
  });

  it("MEM-LEDGER-007: ledger RLS denies member writes (only admin SELECT + service_role) ", () => {
    // The base table's policies (in its creating migration) grant no
    // authenticated INSERT/UPDATE/DELETE. Assert no such policy exists anywhere.
    expect(migrations).not.toMatch(
      /create policy[^;]*on public\.gumroad_sales[^;]*for (insert|update|delete)[^;]*to authenticated/i
    );
  });

  it("MEM-LEDGER-008: admin reattach is admin-gated inside the definer fn + audited", () => {
    expect(ledgerMigration).toMatch(/create or replace function public\.attach_gumroad_sale\(/i);
    // v_actor is unique to this function; its admin gate + audit must be present.
    expect(ledgerMigration).toMatch(/has_role\(\s*v_actor\s*,\s*['"]admin['"]\s*\)/i);
    expect(ledgerMigration).toMatch(/write_audit_log/i);
  });

  it("MEM-LEDGER-009: never-blank invariant — one-time backfill + drift tripwire", () => {
    expect(ledgerMigration).toMatch(/membership_tier = 'starter' where membership_tier is null/i);
    expect(ledgerMigration).toMatch(/reproject_membership_drift/i);
    expect(ledgerMigration).toMatch(/membership_invariant_violation/i);
  });

  it("MEM-LEDGER-010: webhook is ledger-only, constant-time auth, body-capped — never writes tier", () => {
    expect(webhook).toMatch(/function safeEqual/);
    expect(webhook).toMatch(/MAX_BODY_BYTES/);
    expect(webhook).toMatch(/PayloadSchema/); // zod validation
    // It records the ledger but must NOT update the profiles membership columns.
    expect(webhook).not.toMatch(/\.from\(\s*["']profiles["']\s*\)\s*\.update/);
    expect(webhook).not.toMatch(/membership_tier:/);
    // Lifecycle handling present. H10 extracted the refund/dispute/cancel/ended
    // classification + timestamp patch into ./lifecycle.ts; index.ts must wire it
    // in, and that module must set the lifecycle timestamps the projector reads.
    expect(webhook).toMatch(/from ["']\.\/lifecycle\.ts["']/);
    expect(webhookLifecycle).toMatch(/refunded_at|subscription_ended_at/);
  });

  it("MEM-LEDGER-011: backfill uses the verified token email + no keyword tier mapping", () => {
    expect(backfill).toMatch(/getClaims/);
    // The old keyword heuristic must be gone from both API-facing functions.
    expect(backfill).not.toMatch(/includes\(\s*["']founding["']\s*\)/);
    expect(reconcile).not.toMatch(/includes\(\s*["']founding["']\s*\)/);
    // Neither may write the tier directly anymore.
    expect(backfill).not.toMatch(/membership_tier:/);
    expect(reconcile).not.toMatch(/membership_tier:/);
    // Both derive via the projector.
    expect(backfill).toMatch(/compute_membership/);
    expect(reconcile).toMatch(/compute_membership/);
  });

  it("MEM-LEDGER-012: UX — 'Early Career Membership' label + once-per-session backfill guard", () => {
    expect(tiers).toMatch(/name:\s*["']Early Career Membership["']/);
    expect(hook).toMatch(/Early Career Membership/);
    expect(hook).toMatch(/sessionStorage/);
    expect(hook).toMatch(/backfillSessionKey/);
  });

  it("MEM-LEDGER-013: billing period is derived from the sale's recurrence (ftpql sells monthly + yearly)", () => {
    // The projector maps gs.recurrence -> yearly/monthly (one product, two options).
    expect(ledgerMigration).toMatch(/lower\(gs\.recurrence\)[\s\S]*?yearly/i);
    expect(ledgerMigration).toMatch(/lower\(gs\.recurrence\)[\s\S]*?monthly/i);
    // The founding SKU is keyed on the real Gumroad product_id.
    expect(ledgerMigration).toMatch(/values\s*\(\s*'ftpql'/i);
  });
});
