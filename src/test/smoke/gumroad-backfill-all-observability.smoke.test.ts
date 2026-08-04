// Smoke coverage for the server-side full resync (gumroad-backfill-all) and the
// membership/Gumroad observability wiring (failures + warnings surfaced in the
// Activity Log).
//
// Backs BDD scenarios MEM-OBS-001..008. Hermetic file-content convention (no
// DB/network) matching src/test/smoke/membership-ledger.smoke.test.ts. Each test
// guards a SECURITY or CORRECTNESS invariant of the design — if one fails, fix
// the source, do not relax the test.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const backfillAll = read("supabase/functions/gumroad-backfill-all/index.ts");
const backfill = read("supabase/functions/gumroad-backfill/index.ts");
const webhook = read("supabase/functions/gumroad-webhook/index.ts");
const reconcile = read("supabase/functions/gumroad-reconcile/index.ts");
const activityLog = read("src/pages/ActivityLogPage.tsx");
const config = read("supabase/config.toml");

const migrationsDir = resolve(REPO, "supabase/migrations");
const tripwireMigration =
  readdirSync(migrationsDir)
    .filter((f) => /membership_tripwire_severity\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";
const cronMigration =
  readdirSync(migrationsDir)
    .filter((f) => /gumroad_backfill_all_cron\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";
const manifest = read("src/generated/edge-functions.manifest.json");

describe("gumroad-backfill-all + membership observability (smoke)", () => {
  it("MEM-OBS-001: backfill-all is admin- or service-role-gated, never callable by members", () => {
    // Cron path: shared service-role authorizer. Human path: admin JWT only.
    expect(backfillAll).toMatch(/authorizeServiceRoleRequest/);
    expect(backfillAll).toMatch(/function isAdmin/);
    expect(backfillAll).toMatch(/\.eq\(\s*["']role["']\s*,\s*["']admin["']\s*\)/);
    // A non-admin JWT is refused with a 403 AND audited.
    expect(backfillAll).toMatch(/authz_admin_denied/);
    expect(backfillAll).toMatch(/Admin role required["']\s*}\s*,\s*403/);
  });

  it("MEM-OBS-002: backfill-all fails closed on subscriptions it cannot confirm active", () => {
    expect(backfillAll).toMatch(/fetchSubscriberLifecycle/);
    // Unknown/unverifiable lifecycle → grant=false → resolved_user_id null (pending),
    // so a lapsed member cannot self-restore via a resync.
    expect(backfillAll).toMatch(/else grant = false/);
    expect(backfillAll).toMatch(/resolvedUserId = grant \? \(prof\?\.user_id \?\? null\) : null/);
  });

  it("MEM-OBS-003: backfill-all never writes a tier — it projects via reproject_membership_drift", () => {
    expect(backfillAll).not.toMatch(/membership_tier:/);
    expect(backfillAll).not.toMatch(/\.from\(\s*["']profiles["']\s*\)\s*\.update/);
    expect(backfillAll).toMatch(/reproject_membership_drift/);
  });

  it("MEM-OBS-004: backfill-all emits lifecycle + failure observability events with severity", () => {
    for (const evt of [
      "gumroad_ingestion_misconfigured",
      "gumroad_api_error",
      "gumroad_backfill_truncated",
      "gumroad_backfill_all_started",
      "gumroad_backfill_all_completed",
      "membership_projection_failed",
    ]) {
      expect(backfillAll).toContain(evt);
    }
    // Severities are explicit, not inferred.
    expect(backfillAll).toMatch(/severity:\s*["']error["']/);
    expect(backfillAll).toMatch(/severity:\s*["']warn["']/);
    expect(backfillAll).toMatch(/severity:\s*["']info["']/);
  });

  it("MEM-OBS-005: every gumroad/membership edge failure routes through auditEdgeEvent (source:edge + severity)", () => {
    // The shared helper tags source:edge.<fn> + severity so the Activity Log can
    // classify it. All three API-facing functions use it on their failure paths.
    expect(backfill).toMatch(/auditEdgeEvent/);
    expect(reconcile).toMatch(/auditEdgeEvent/);
    expect(webhook).toMatch(/auditEdgeEvent/);
    // Silent 500s are now audited.
    expect(backfill).toMatch(/gumroad_sale_persist_failed/);
    expect(reconcile).toMatch(/gumroad_reconcile_failed/);
    expect(webhook).toMatch(/gumroad_sale_persist_failed/);
    // auditEdgeEvent must receive a type-compatible client (getAdminClient), not
    // the esm.sh service client — otherwise deno-check fails (version drift).
    expect(backfill).toMatch(/getAdminClient/);
    expect(reconcile).toMatch(/getAdminClient/);
  });

  it("MEM-OBS-006: the Activity Log labels + classifies every new event type", () => {
    for (const evt of [
      "gumroad_ingestion_misconfigured",
      "gumroad_api_error",
      "gumroad_backfill_truncated",
      "gumroad_backfill_all_started",
      "gumroad_backfill_all_completed",
      "gumroad_sale_persist_failed",
      "gumroad_reconcile_failed",
      "membership_projection_failed",
      "membership_invariant_violation",
    ]) {
      expect(activityLog).toContain(evt);
    }
    // inferSeverity recognises the membership/gumroad shapes as error/warn.
    expect(activityLog).toMatch(/violation|misconfigured/);
    expect(activityLog).toMatch(/truncated/);
  });

  it("MEM-OBS-007: the invariant tripwire carries an explicit severity:error tag", () => {
    expect(tripwireMigration).toBeTruthy();
    expect(tripwireMigration).toMatch(/reproject_membership_drift/);
    expect(tripwireMigration).toMatch(/'severity:error'/);
    expect(tripwireMigration).toMatch(/membership_invariant_violation/);
    // Still a definer fn with a pinned search_path (unchanged hardening).
    expect(tripwireMigration).toMatch(/security definer[\s\S]{0,60}set search_path\s*=\s*''/i);
  });

  it("MEM-OBS-008: gumroad-backfill-all is pinned in config.toml + the generated manifest (deploy-guarantee)", () => {
    expect(config).toMatch(/\[functions\.gumroad-backfill-all\]/);
    // Cron/admin auth is enforced in code, so verify_jwt is false.
    expect(config).toMatch(/\[functions\.gumroad-backfill-all\]\s*\n\s*verify_jwt = false/);
    // The coverage generator must have picked it up as a cron function.
    expect(manifest).toMatch(/"name":\s*"gumroad-backfill-all"/);
    expect(manifest).toMatch(/"name":\s*"gumroad-backfill-all"[\s\S]{0,120}"kind":\s*"cron"/);
  });

  it("MEM-OBS-009: a weekly server-side cron runs the resync (no operator machine required)", () => {
    expect(cronMigration).toBeTruthy();
    expect(cronMigration).toMatch(/gumroad-backfill-all-weekly/);
    expect(cronMigration).toMatch(/functions\/v1\/gumroad-backfill-all/);
    // Authorized by the service-role bearer from Vault (same proven pattern).
    expect(cronMigration).toMatch(/vault\.decrypted_secrets/);
    // Weekly cron expression (Sunday).
    expect(cronMigration).toMatch(/cron\.schedule\(\s*\n?\s*['"]gumroad-backfill-all-weekly['"]\s*,\s*['"][^'"]*\* 0['"]/);
  });
});
