// Smoke coverage for audit Wave 2 — sync-airtable IDOR.
// Any authenticated caller could previously pass a victim's application_id and
// overwrite that Airtable record (upsert keyed on application_id, no ownership
// check). These are hermetic file-content invariants; if one fails, the ownership
// gate has been weakened or removed — restore it, don't relax the test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = "supabase/functions/sync-airtable";
const index = readFileSync(resolve(process.cwd(), `${dir}/index.ts`), "utf8");
const ownership = readFileSync(resolve(process.cwd(), `${dir}/ownership.ts`), "utf8");

describe("sync-airtable ownership gate (smoke)", () => {
  it("IDOR-001: index verifies the caller owns the general_applications row before the Airtable write", () => {
    // Must read the row and run it through the ownership decision.
    expect(index).toMatch(/from\(["']general_applications["']\)/);
    expect(index).toMatch(/decideOwnership\s*\(/);
    // The ownership check must precede the Airtable upsert (PATCH to api.airtable.com).
    const gateIdx = index.indexOf("decideOwnership");
    const writeIdx = index.indexOf("api.airtable.com");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(writeIdx);
  });

  it("IDOR-002: a failed ownership check fails closed (403 deny / 500 on error), never proceeds", () => {
    expect(index).toMatch(/gate\.ok/);
    expect(ownership).toMatch(/status:\s*403/);
  });

  it("IDOR-003: stamped user_email is the server-verified JWT email, not the caller-supplied body", () => {
    // Body email must not be able to override the verified identity.
    expect(index).toMatch(/user_email:\s*userEmail\s*\|\|\s*email/);
    expect(index).not.toMatch(/user_email:\s*email\s*\|\|\s*userEmail/);
  });
});
