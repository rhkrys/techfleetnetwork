// Smoke coverage for audit H11 — resolve-discord-id must NOT bind a
// caller-supplied Discord snowflake without ownership proof (interim lockdown).
// Hermetic file-content invariant; if it fails, the vulnerable self-service
// bind has been reintroduced — restore the lockdown, don't relax the test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(process.cwd(), "supabase/functions/resolve-discord-id/index.ts"),
  "utf8"
);

describe("resolve-discord-id Discord-link ownership (smoke)", () => {
  it("H11-001: never writes a caller-supplied snowflake onto the caller's profile", () => {
    // The vulnerable write bound discord_user_id: confirm_user_id + has_discord_account.
    expect(src).not.toMatch(/discord_user_id:\s*confirm_user_id/);
    expect(src).not.toMatch(/has_discord_account:\s*true/);
  });

  it("H11-002: the confirm path is locked down (audit + 403, no proof of ownership)", () => {
    expect(src).toMatch(/discord_link_blocked_no_ownership_proof/);
    expect(src).toMatch(/ownership_proof_required/);
    expect(src).toMatch(/status:\s*403/);
  });
});
