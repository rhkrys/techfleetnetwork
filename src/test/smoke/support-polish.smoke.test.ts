// Hermetic smoke coverage for the support polish PR (#5 idempotency, #7 sweep
// scale). File-content assertions; backs BDD HELP-DESK-090 + MEM-SCALE-001.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const helper = read("supabase/functions/_shared/support-ticket.ts");
const proxy = read("supabase/functions/freescout-proxy/index.ts");
const migrationsDir = resolve(REPO, "supabase/migrations");
const reprojectMig =
  readdirSync(migrationsDir)
    .filter((f) => /reproject_scale_scope\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

describe("support polish (smoke)", () => {
  it("HELP-DESK-090: ticket creation is idempotent on both create paths (no duplicate on double-tap)", () => {
    // Shared guard used by the Discord path.
    expect(helper).toMatch(/export async function recentDuplicateTicketId/);
    expect(helper).toMatch(/const dupId = await recentDuplicateTicketId\(prof\.user_id, subject\)/);
    expect(helper).toMatch(/return \{ status: "ok", conversationId: dupId \}/);
    // Web create path dedupes on the same subject+owner window before creating.
    expect(proxy).toMatch(/case "create":/);
    expect(proxy).toMatch(/from\("support_ticket_pointers"\)[\s\S]{0,400}deduped: true/);
  });

  it("MEM-SCALE-001: the drift sweep is scoped to membership-relevant profiles (10k-scale)", () => {
    expect(reprojectMig).toBeTruthy();
    expect(reprojectMig).toMatch(/create or replace function public\.reproject_membership_drift/i);
    // Loop 2 now skips provably-starter, no-sales profiles.
    expect(reprojectMig).toMatch(/membership_tier <> 'starter'\s*\n\s*OR EXISTS \(SELECT 1 FROM public\.gumroad_sales/i);
    // Tripwire (loop 1) + severity tag preserved.
    expect(reprojectMig).toMatch(/membership_invariant_violation/);
    expect(reprojectMig).toMatch(/'severity:error'/);
    // Still definer + pinned empty search_path.
    expect(reprojectMig).toMatch(/security definer[\s\S]{0,40}set search_path = ''/i);
  });
});
