// Hermetic smoke coverage for the Discord /support -> Freescout ticket feature
// (PR #2c). File-content assertions; each guards a SECURITY or CORRECTNESS
// invariant. Backs BDD scenarios HELP-DESK-080..085.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const interactions = read("supabase/functions/discord-interactions/index.ts");
const helper = read("supabase/functions/_shared/support-ticket.ts");
const registrar = read("supabase/functions/register-support-command/index.ts");
const config = read("supabase/config.toml");
const manifest = read("src/generated/edge-functions.manifest.json");

describe("Discord /support ticket (smoke)", () => {
  it("HELP-DESK-080: interactions handler routes the /support command", () => {
    expect(interactions).toMatch(/commandName === "support"/);
    expect(interactions).toMatch(/o\.name === "subject"/);
    expect(interactions).toMatch(/o\.name === "details"/);
    // Signature verification is untouched + still gates everything.
    expect(interactions).toMatch(/verifySignature/);
  });

  it("HELP-DESK-081: the ticket confirmation is ephemeral (private to the requester)", () => {
    expect(interactions).toMatch(/type: RESPONSE_DEFERRED_CHANNEL_MESSAGE, data: \{ flags: 64 \}/);
  });

  it("HELP-DESK-082: the Freescout helper is lazy-imported (keeps the API-key tripwire off /fleety + PING)", () => {
    expect(interactions).toMatch(/await import\("\.\.\/_shared\/support-ticket\.ts"\)/);
    // No static import of the freescout-backed helper at module top.
    expect(interactions).not.toMatch(/^import .*support-ticket/m);
  });

  it("HELP-DESK-083: unlinked / no-email Discord users get actionable feedback (no silent fail)", () => {
    expect(interactions).toMatch(/isn't linked/i);
    expect(interactions).toMatch(/connect-discord/);
    expect(interactions).toMatch(/no email on file/i);
  });

  it("HELP-DESK-084: the helper resolves the member by discord_user_id and creates a ticket + owned pointer", () => {
    expect(helper).toMatch(/\.eq\("discord_user_id", discordUserId\)/);
    expect(helper).toMatch(/return \{ status: "unlinked" \}/);
    expect(helper).toMatch(/path: "\/api\/conversations"/);
    // Pointer is owned by the member's auth uid (so RLS + "My tickets" work).
    expect(helper).toMatch(/customer_user_id: prof\.user_id/);
  });

  it("HELP-DESK-085: the /support registrar is admin-gated and pinned", () => {
    expect(registrar).toMatch(/\.eq\("role", "admin"\)/);
    expect(registrar).toMatch(/name: "support"/);
    expect(registrar).toMatch(/name: "subject"/);
    expect(registrar).toMatch(/name: "details"/);
    expect(config).toMatch(/\[functions\.register-support-command\]/);
    expect(manifest).toMatch(/"name":\s*"register-support-command"/);
  });

  // ── Hardening folded in from the skills audit (#1-#4) ──
  it("HELP-DESK-086: Discord /support is rate-limited per member (abuse/DoS guard)", () => {
    expect(helper).toMatch(/RATE_LIMIT_PER_HOUR/);
    // T-F: enforced via the ATOMIC increment RPC (was a read-then-upsert on
    // support_rate_limits, which raced and let concurrent taps bypass the cap).
    expect(helper).toMatch(/support_check_rate_limit_for/);
    expect(helper).toMatch(/return \{ status: "rate_limited" \}/);
    // The command surfaces the cap to the user rather than silently failing.
    expect(interactions).toMatch(/result\.status === "rate_limited"/);
  });

  it("HELP-DESK-087: subject/body are sanitized (control chars / null bytes)", () => {
    expect(interactions).toMatch(/dropControls/);
    expect(interactions).toMatch(/dropNulls/);
    expect(interactions).toMatch(/charCodeAt\(0\)/);
  });

  it("HELP-DESK-088: create success/failure + rate-limit are audited to the Activity Log", () => {
    expect(helper).toMatch(/auditEdgeEvent/);
    for (const evt of [
      "support_ticket_created",
      "support_ticket_create_failed",
      "support_rate_limited",
    ]) {
      expect(helper).toContain(evt);
    }
    const activityLog = read("src/pages/ActivityLogPage.tsx");
    for (const evt of [
      "support_ticket_created",
      "support_ticket_create_failed",
      "support_rate_limited",
    ]) {
      expect(activityLog).toContain(evt);
    }
  });

  it("HELP-DESK-089: legacy support DEFINER functions are hardened to search_path = ''", () => {
    const mig = read("supabase/migrations/20260804170000_harden_support_search_path.sql");
    expect(mig).toMatch(/create or replace function public\.support_check_rate_limit/i);
    // No real `SET search_path = public` statement lines remain (comments allowed).
    expect(mig).not.toMatch(/^\s*SET search_path = public\b/im);
    expect(mig).toMatch(/set search_path = ''/i);
    // The app_role cast is schema-qualified for the empty search_path.
    expect(mig).toMatch(/'admin'::public\.app_role/);
    // RETURNS TABLE plpgsql fns carry the conflict directive.
    expect(mig).toMatch(/#variable_conflict use_column/);
  });
});
