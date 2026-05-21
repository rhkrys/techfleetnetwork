// Verifies the v5 contract that course completions and course_completed:* badges
// are produced by the same trigger pipeline. This is a static-assertion smoke
// test — runtime parity is enforced server-side by admin_reconcile_parity().
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const sql = fs.existsSync(MIGRATIONS_DIR)
  ? fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n")
  : "";

describe("Network Stats v5 — badge parity (smoke)", () => {
  it("STATS-001/010: course_completions has UNIQUE(user_id, course_key)", () => {
    expect(sql).toMatch(/course_completions[\s\S]*UNIQUE\s*\(\s*user_id\s*,\s*course_key\s*\)/i);
  });

  it("STATS-004: general_application_submissions has UNIQUE(user_id)", () => {
    expect(sql).toMatch(/general_application_submissions[\s\S]*UNIQUE\s*\(\s*user_id\s*\)/i);
  });

  it("STATS-009: parity reconciler RPC is defined", () => {
    expect(sql).toMatch(/reconcile_course_badge_parity|admin_reconcile_parity/);
  });

  it("STATS-008: recompute_all_stats RPC is defined", () => {
    expect(sql).toMatch(/recompute_all_stats|admin_recompute_stats/);
  });

  it("STATS-005: profiles.is_test_account column exists", () => {
    expect(sql).toMatch(/is_test_account\s+boolean/i);
  });

  it("STATS-RECON-001: all_course_completions_total metric is written", () => {
    expect(sql).toMatch(/all_course_completions_total/);
  });

  it("STATS-RECON-002: discord_linked_at column + trigger exist", () => {
    expect(sql).toMatch(/discord_linked_at\s+timestamptz/i);
    expect(sql).toMatch(/set_discord_linked_at/);
  });

  it("STATS-RECON-004: get_network_stats exposes course_completions_total", () => {
    expect(sql).toMatch(/'course_completions_total'/);
  });

  it("STATS-RECON-004: badges reconcile to courses + applications + Discord links", () => {
    expect(sql).toMatch(/discord_links_total/);
    expect(sql).toMatch(/v_badges_total\s*:=\s*v_all_courses_total\s*\+\s*v_apps_total\s*\+\s*v_discord_total/i);
    expect(sql).toMatch(/v_pw_badges\s*:=\s*v_pw_all_courses\s*\+\s*v_pw_apps\s*\+\s*v_pw_discord/i);
    expect(sql).toMatch(/'discord_links_count'/);
    expect(sql).toMatch(/'prev_week_discord_links_count'/);
  });
});
