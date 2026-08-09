// Smoke-tier coverage for email deliverability hardening (EMAIL-DELIV-001..030).
// Asserts the shared transactional-email helper still ships the bulk-sender
// headers, plaintext alternative, and verified From/Reply-To required to keep
// us out of Promotions/Spam.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const shared = fs.readFileSync(
  path.join(process.cwd(), "supabase/functions/_shared/transactional-email.ts"),
  "utf8"
);
const footer = fs.readFileSync(path.join(process.cwd(), "src/components/AppFooter.tsx"), "utf8");

describe("Email deliverability (smoke)", () => {
  // NOTE: quote-agnostic (['"]) — the pre-commit prettier normalizes this
  // legacy single-quoted edge file to double quotes on any touch; asserting a
  // hardcoded quote style makes these source-greps spuriously brittle.
  it("DELIV-001: From identity uses Tech Fleet <onboarding@techfleet.org>", () => {
    expect(shared).toMatch(/FROM_DOMAIN\s*=\s*['"]techfleet\.org['"]/);
    expect(shared).toMatch(/FROM_MAILBOX\s*=\s*['"]onboarding['"]/);
    expect(shared).toMatch(/SITE_NAME\s*=\s*['"]Tech Fleet['"]/);
  });

  it("DELIV-002: Reply-To routes to onboarding@techfleet.org", () => {
    expect(shared).toMatch(/REPLY_TO\s*=\s*['"]onboarding@techfleet\.org['"]/);
  });

  it("DELIV-003: DKIM signing subdomain unchanged (notify.techfleet.org)", () => {
    expect(shared).toMatch(/SENDER_DOMAIN\s*=\s*['"]notify\.techfleet\.org['"]/);
  });

  it("DELIV-026: List-Unsubscribe + One-Click headers present", () => {
    expect(shared).toMatch(/['"]List-Unsubscribe['"]/);
    expect(shared).toMatch(/List-Unsubscribe=One-Click/);
    expect(shared).toMatch(/['"]X-Entity-Ref-ID['"]/);
  });

  it("DELIV-027: Precedence: bulk only on bulk templates; non-bulk get Auto-Submitted", () => {
    expect(shared).toMatch(/Precedence/);
    expect(shared).toMatch(/Auto-Submitted/);
    expect(shared).toMatch(/BULK_TEMPLATES/);
  });

  it("DELIV-030: Plaintext alternative is rendered alongside HTML", () => {
    expect(shared).toMatch(/plainText:\s*true/);
    expect(shared).toMatch(/text:\s*plainText/);
  });

  it("DELIV-028: Global footer exposes onboarding@techfleet.org mailto", () => {
    expect(footer).toMatch(/mailto:onboarding@techfleet\.org/);
  });

  it("DELIV-019: Bulk subjects sanitized server-side", () => {
    expect(shared).toMatch(/sanitizeBulkSubject/);
  });

  it("Role-based mailboxes are blocked before enqueue", () => {
    expect(shared).toMatch(/ROLE_LOCAL_PARTS/);
    expect(shared).toMatch(/postmaster/);
  });
});
