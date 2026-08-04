// Hermetic smoke coverage for support categories (PR #2a) — admin-managed
// taxonomy, per-ticket tagging, and category reporting. File-content assertions
// (repo convention); each guards a SECURITY or CORRECTNESS invariant.
// Backs BDD scenarios HELP-DESK-060..066.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const proxy = read("supabase/functions/freescout-proxy/index.ts");
const grid = read("src/pages/community/AdminAllTicketsGrid.tsx");
const panel = read("src/pages/community/CategoryReportPanel.tsx");
const getHelp = read("src/pages/community/GetHelpPage.tsx");

const migrationsDir = resolve(REPO, "supabase/migrations");
const mig =
  readdirSync(migrationsDir)
    .filter((f) => /support_categories\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

const SEED = [
  "Advice", "Billing", "Classes", "Code of Conduct", "Conflict Escalation",
  "Discord", "Figma Verification", "Membership", "Onboarding", "Projects",
  "Safety", "Technical Help", "Other",
];

describe("support categories PR #2a (smoke)", () => {
  it("HELP-DESK-060: category table exists with RLS (admins manage, members read visible only)", () => {
    expect(mig).toMatch(/create table if not exists public\.support_categories/i);
    expect(mig).toMatch(/enable row level security/i);
    // Member read is limited to active, non-internal rows; admins see all.
    expect(mig).toMatch(/is_active and not is_internal/i);
    expect(mig).toMatch(/has_role\(auth\.uid\(\),\s*'admin'\)/i);
    expect(mig).toMatch(/is_internal boolean/i);
  });

  it("HELP-DESK-061: seeds exactly Tech Fleet's taxonomy (alphabetical, Other last)", () => {
    for (const label of SEED) expect(mig).toContain(`'${label}'`);
    // Other sorts last via a large sort_order.
    expect(mig).toMatch(/'other',\s*'Other',\s*9999/i);
  });

  it("HELP-DESK-062: tickets carry a category (FK on the pointer, ON DELETE SET NULL)", () => {
    expect(mig).toMatch(/alter table public\.support_ticket_pointers[\s\S]*?add column if not exists category_id uuid references public\.support_categories\(id\) on delete set null/i);
  });

  it("HELP-DESK-063: category report RPC is admin-gated, DEFINER, pinned search_path, conflict-safe", () => {
    expect(mig).toMatch(/create or replace function public\.get_support_category_report/i);
    expect(mig).toMatch(/security definer/i);
    expect(mig).toMatch(/set search_path = ''/i);
    expect(mig).toMatch(/#variable_conflict use_column/i);
    expect(mig).toMatch(/insufficient_privilege/i);
  });

  it("HELP-DESK-064: setCategory is admin-only and validates the category id", () => {
    expect(proxy).toMatch(/action: z\.literal\("setCategory"\)/);
    expect(proxy).toMatch(/ADMIN_ACTIONS = new Set\(\[[^\]]*"setCategory"/);
    expect(proxy).toMatch(/from\("support_categories"\)[\s\S]{0,200}Unknown category/);
    expect(proxy).toMatch(/category_id: input\.categoryId/);
  });

  it("HELP-DESK-065: listAll enriches admin rows with category + private (Freescout doesn't hold them)", () => {
    expect(proxy).toMatch(/from\("support_ticket_pointers"\)[\s\S]{0,160}category_id/);
    expect(proxy).toMatch(/category: categoryId \? \(catById\.get\(categoryId\) \?\? null\) : null/);
  });

  it("HELP-DESK-066: triage grid tags tickets + a category report renders in Reports", () => {
    expect(grid).toMatch(/support_categories/); // useCategories source
    expect(grid).toMatch(/Set category/);
    expect(grid).toMatch(/action: "setCategory"/);
    expect(grid).toMatch(/headerName: "Category"/);
    expect(panel).toMatch(/get_support_category_report/);
    expect(getHelp).toMatch(/CategoryReportPanel/);
  });
});
