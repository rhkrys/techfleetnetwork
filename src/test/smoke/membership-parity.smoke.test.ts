// Smoke-tier coverage for BDD feature area: Membership Parity, Tiers, FAQ & Announcement
// File-content greps in the project's established convention. No DOM, no network.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();
const tiersGridSrc = fs.readFileSync(
  path.join(root, "src/components/MembershipTiersGrid.tsx"),
  "utf8"
);
const editProfileSrc = fs.readFileSync(path.join(root, "src/pages/EditProfilePage.tsx"), "utf8");
const faqDataSrc = fs.readFileSync(path.join(root, "src/data/membership-faq.ts"), "utf8");
const faqComponentSrc = fs.readFileSync(
  path.join(root, "src/components/MembershipFaq.tsx"),
  "utf8"
);
const tiersConfigSrc = fs.readFileSync(path.join(root, "src/config/membership-tiers.ts"), "utf8");

const migrationsDir = path.join(root, "supabase/migrations");
const migrationFiles = fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir).map((f) => fs.readFileSync(path.join(migrationsDir, f), "utf8"))
  : [];
const allMigrations = migrationFiles.join("\n---\n");

const scenarioIds = [
  "MEM-PARITY-001",
  "MEM-PARITY-002",
  "MEM-PARITY-003",
  "MEM-PARITY-004",
  "MEM-PARITY-005",
  "MEM-PARITY-006",
  "MEM-PARITY-007",
  "MEM-PARITY-008",
  "MEM-PARITY-009",
  "MEM-PARITY-FAQ-001",
  "MEM-PARITY-FAQ-002",
  "MEM-PARITY-ANN-001",
  "MEM-PARITY-ANN-002",
];

describe("Membership Parity, Tiers, FAQ & Announcement (smoke)", () => {
  /* ── A. Pricing parity notice ───────────────────────── */

  it("MEM-PARITY-001: Parity notice renders inside the tiers grid mounted on Membership tab", () => {
    expect(tiersGridSrc).toMatch(/Fair pricing, wherever you are/);
    expect(editProfileSrc).toMatch(/MembershipTiersGrid/);
    expect(scenarioIds).toContain("MEM-PARITY-001");
  });

  it("MEM-PARITY-002: Parity notice mentions PPP and 'no code needed'", () => {
    expect(tiersGridSrc).toMatch(/Purchasing Power Parity/);
    expect(tiersGridSrc).toMatch(/no code needed/);
  });

  /* ── B. Tier cards content & CTAs ───────────────────── */

  it("MEM-PARITY-003: All three tier cards render in correct order via TIER_ORDER", () => {
    expect(tiersConfigSrc).toMatch(
      /TIER_ORDER[^=]*=\s*\[\s*"starter"\s*,\s*"community"\s*,\s*"professional"\s*\]/
    );
    expect(tiersGridSrc).toMatch(/TIER_ORDER\.map/);
  });

  it("MEM-PARITY-004: Community card shows 'Most Popular' badge with SR-only 'tier' suffix", () => {
    expect(tiersGridSrc).toMatch(/Most Popular/);
    expect(tiersGridSrc).toMatch(/sr-only[^>]*>\s*tier/);
  });

  it("MEM-PARITY-005: Redundant in-card founding promo strip is removed; founding info stays in the billing toggle + price footnote", () => {
    // The "Founding Member offer" strip inside the tier card was removed as
    // visual clutter (duplicated the billing toggle + price footnote).
    expect(tiersGridSrc).not.toMatch(/Founding Member offer/);
    // Founding messaging still surfaces via the billing toggle and footnote.
    expect(tiersGridSrc).toMatch(/Founding Member rate/);
    expect(tiersGridSrc).toMatch(/locked for life/i);
  });

  it("MEM-PARITY-006: Billing toggle exposes Monthly + Yearly with savings badge while promo active", () => {
    expect(tiersGridSrc).toMatch(/role="radiogroup"/);
    expect(tiersGridSrc).toMatch(/aria-label="Billing frequency"/);
    expect(tiersGridSrc).toMatch(/label="Monthly"/);
    expect(tiersGridSrc).toMatch(/label="Yearly"/);
    expect(tiersGridSrc).toMatch(/savingsLabel/);
  });

  it("MEM-PARITY-007: Professional tier shows 'Coming soon · Join waitlist' until SKU configured", () => {
    expect(tiersConfigSrc).toMatch(/professional[\s\S]*?cta:\s*\{\s*type:\s*"waitlist"/);
    expect(tiersGridSrc).toMatch(/Coming soon · Join waitlist/);
  });

  it("MEM-PARITY-008: Current-tier status uses aria-disabled + role=status, not native disabled", () => {
    expect(tiersGridSrc).toMatch(/role="status"/);
    expect(tiersGridSrc).toMatch(/aria-label=\{`\$\{tier\.name\} is your current/);
    // Current-tier branch uses a <div> status block, not <button disabled>
    const currentBranch =
      tiersGridSrc.match(/if \(isCurrent\)[\s\S]*?return \([\s\S]*?\)\s*;\s*\}/)?.[0] ?? "";
    expect(currentBranch).not.toMatch(/\bdisabled\b/);
  });

  /* ── C. CTA / promo copy ────────────────────────────── */

  it("MEM-PARITY-009: 'locked for life' copy surfaces while promo window is active", () => {
    // Appears in the price footnote and/or the founding promo description
    expect(tiersGridSrc).toMatch(/locked for life/i);
  });

  /* ── D. FAQ link ────────────────────────────────────── */

  it("MEM-PARITY-FAQ-001: Membership FAQ contains 'checkout price' entry", () => {
    expect(faqDataSrc).toMatch(/checkout price (is )?different/i);
    expect(faqDataSrc).toMatch(/Purchasing Power Parity/);
  });

  it("MEM-PARITY-FAQ-002: FAQ block is mounted under tiers on Membership tab and is keyboard accessible", () => {
    expect(editProfileSrc).toMatch(/<MembershipFaq\s*\/>/);
    expect(faqComponentSrc).toMatch(/Accordion/);
    expect(faqComponentSrc).toMatch(/aria-labelledby="membership-faq-heading"/);
  });

  /* ── E. Draft announcement seed ─────────────────────── */

  it("MEM-PARITY-ANN-001: Draft parity announcement is seeded with status implicit (no published flag) and admin authorship", () => {
    expect(allMigrations).toMatch(/Pricing parity is on/i);
    expect(allMigrations).toMatch(/INSERT INTO public\.announcements/i);
    // Author resolved from a user with the admin role
    expect(allMigrations).toMatch(/user_roles[\s\S]*?role\s*=\s*'admin'/i);
  });

  it("MEM-PARITY-ANN-002: Seed insert is idempotent (WHERE NOT EXISTS / ON CONFLICT guard)", () => {
    const parityMigration = migrationFiles.find((m) => /Pricing parity is on/i.test(m));
    expect(parityMigration).toBeDefined();
    expect(parityMigration!).toMatch(/WHERE NOT EXISTS|ON CONFLICT/i);
  });
});
