// Hermetic smoke coverage for the support/Freescout PR #1 (hardening + finish
// existing flows). File-content assertions in the repo's established style (see
// membership-ledger.smoke.test.ts) — no DB/network/RTL, so they run in CI where
// the worktree can't. Each guards a SECURITY or CORRECTNESS invariant; if one
// fails, fix the source, don't relax the test.
//
// Backs BDD scenarios HELP-DESK-050..058.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const proxy = read("supabase/functions/freescout-proxy/index.ts");
const provisionAdmin = read("supabase/functions/freescout-provision-admin/index.ts");
const webhook = read("supabase/functions/freescout-webhook/index.ts");
const grid = read("src/pages/community/AdminAllTicketsGrid.tsx");
const getHelp = read("src/pages/community/GetHelpPage.tsx");
const serviceRoleFns = [
  "freescout-provision-customer",
  "freescout-sync-customer",
  "support-provisioning-retry",
  "support-monthly-report",
].map((f) => ({ f, src: read(`supabase/functions/${f}/index.ts`) }));

const migrationsDir = resolve(REPO, "supabase/migrations");
const agentsMigration =
  readdirSync(migrationsDir)
    .filter((f) => /support_list_agents\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

describe("support hardening PR #1 (smoke)", () => {
  it("HELP-DESK-050: service-role support fns use the shared authorizer (not bespoke string-equality)", () => {
    for (const { f, src } of serviceRoleFns) {
      expect(src, f).toMatch(/authorizeServiceRoleRequest/);
      // The old bespoke helper (which rejected sb_secret_* + wasn't shared) is gone.
      expect(src, f).not.toMatch(/function isServiceRole/);
    }
  });

  it("HELP-DESK-051: assign accepts a platform admin UUID (not a raw Freescout numeric id)", () => {
    // Schema: "self" | uuid — the numeric-Freescout-id path is removed so an
    // admin can't target an arbitrary upstream user.
    expect(proxy).toMatch(/assigneeUserId:\s*z\.union\(\[\s*z\.literal\("self"\),\s*z\.string\(\)\.uuid\(\)/);
    expect(proxy).not.toMatch(/assigneeUserId:\s*z\.union\(\[\s*z\.literal\("self"\),\s*z\.number\(\)/);
  });

  it("HELP-DESK-052: a UUID assignee must itself be an admin (no assigning tickets to members)", () => {
    expect(proxy).toMatch(/if \(!\(await isAdmin\(input\.assigneeUserId\)\)\)/);
    expect(proxy).toMatch(/Assignee must be an admin/);
  });

  it("HELP-DESK-053: upsertPointer never nulls out ownership — customer_user_id only written when asserted", () => {
    expect(proxy).toMatch(/if \(customerUserId !== null\) row\.customer_user_id = customerUserId/);
    // The old unconditional customer_user_id: customerUserId on the upsert is gone.
    expect(proxy).not.toMatch(/\.upsert\(\{\s*\n\s*conversation_id: conversationId,\s*\n\s*customer_user_id: customerUserId,/);
  });

  it("HELP-DESK-054: support_list_agents RPC is admin-gated, SECURITY DEFINER, pinned search_path", () => {
    expect(agentsMigration).toBeTruthy();
    expect(agentsMigration).toMatch(/create or replace function public\.support_list_agents/i);
    expect(agentsMigration).toMatch(/security definer/i);
    expect(agentsMigration).toMatch(/set search_path = ''/i);
    expect(agentsMigration).toMatch(/has_role\(auth\.uid\(\),\s*'admin'\)/i);
    expect(agentsMigration).toMatch(/insufficient_privilege/i);
  });

  it("HELP-DESK-055: triage grid can assign to self AND to another admin, and opens the thread on click", () => {
    expect(grid).toMatch(/assigneeUserId:\s*"self"/); // Assign me
    expect(grid).toMatch(/support_list_agents/); // agent picker source
    expect(grid).toMatch(/assigneeUserId:\s*a\.user_id/); // Assign to <admin>
    expect(grid).toMatch(/onCellClicked/); // row -> thread
    expect(grid).toMatch(/TicketDetail[\s\S]{0,80}viewerRole="admin"/);
  });

  it("HELP-DESK-056: TicketDetail is a shared component reused by member + admin views", () => {
    // Extracted out of GetHelpPage; both import it (no duplicate local copy).
    expect(getHelp).toMatch(/import TicketDetail.*from "\.\/TicketDetail"/);
    expect(getHelp).not.toMatch(/^function TicketDetail\(/m);
    expect(grid).toMatch(/import TicketDetail from "\.\/TicketDetail"/);
  });

  it("HELP-DESK-057: provision-admin looks up the profile by auth uid (user_id), never the row PK", () => {
    expect(provisionAdmin).toMatch(/\.eq\("user_id", targetUserId\)/);
    expect(provisionAdmin).not.toMatch(/\.eq\("id", targetUserId\)/);
    // On-behalf-of provisioning verifies the target is an admin.
    expect(provisionAdmin).toMatch(/Target must be an admin/);
  });

  it("HELP-DESK-058: webhook documents the dedupe-based replay model (body-only HMAC has no timestamp)", () => {
    expect(webhook).toMatch(/support_webhook_events/);
    expect(webhook).toMatch(/deduped/);
    // Honest note that the date header is not a security control.
    expect(webhook).toMatch(/not a security control|attacker-mutable|unsigned/i);
  });
});
