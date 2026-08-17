import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * @security regression guard for in-chat material review (member pastes a Figma/doc link and
 * Fleety reviews it against the SPF, in the same chat). These properties are the OWASP controls
 * that keep the new user-influenced outbound fetch safe; a refactor must not silently drop them.
 * (Behavioral SSRF/allow-list cases are covered by the Deno tests in
 * supabase/functions/_shared/material-fetch.test.ts.)
 */
describe("in-chat material review is wired securely", () => {
  const shared = read("supabase/functions/_shared/material-fetch.ts");
  const chat = read("supabase/functions/techfleet-chat/index.ts");
  const reviewLib = read("supabase/functions/fleety-review/lib.ts");

  it("shared fetch enforces the SSRF controls (https, no-redirect, bounds)", () => {
    expect(shared).toMatch(/protocol !== "https:"/);
    expect(shared).toMatch(/IP-literal/);
    expect(shared).toMatch(/redirect:\s*"error"/);
    expect(shared).toMatch(/MATERIAL_MAX_BYTES/);
  });

  it("both surfaces share ONE allow-list (no drift)", () => {
    // fleety-review re-exports the shared guard rather than defining its own.
    expect(reviewLib).toMatch(/from "\.\.\/_shared\/material-fetch\.ts"/);
    expect(chat).toMatch(/from "\.\.\/_shared\/material-fetch\.ts"/);
  });

  it("chat frames fetched material as UNTRUSTED DATA (prompt-injection defense)", () => {
    expect(chat).toMatch(/MEMBER-SHARED MATERIAL UNDER REVIEW/);
    expect(chat).toMatch(/UNTRUSTED DATA/);
    expect(chat).toMatch(/do not comply/i);
  });

  it("chat bypasses the caches + canned answers when material is present", () => {
    expect(chat).toMatch(/exactHit && !hasMaterial/);
    expect(chat).toMatch(/haveEmbeddings && !hasMaterial/);
    expect(chat).toMatch(/!hasMaterial && top/);
  });

  it("material counts as grounding so a 'review my link' turn isn't refused as off-topic", () => {
    expect(chat).toMatch(/materialContext \/\/ member shared their own work/);
  });
});
