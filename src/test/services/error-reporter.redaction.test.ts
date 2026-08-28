// bdd-gate coverage: src/services/error-reporter.service.ts
import { describe, it, expect, vi } from "vitest";

// Capture every write_audit_log RPC payload so we can assert the persisted
// message is redacted (finding 2227). refreshPolicy / system_health_state reads
// are stubbed to no-ops so the first unique report writes immediately.
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  },
}));

import { reportError, normalizeFingerprintKey } from "@/services/error-reporter.service";

describe("normalizeFingerprintKey redacts PII (dedup + PII-free fingerprints)", () => {
  it("collapses emails to :email so per-user messages dedupe to one fingerprint", () => {
    const a = normalizeFingerprintKey("login failed for alice@example.com");
    const b = normalizeFingerprintKey("login failed for bob@example.com");
    expect(a).toBe(b);
    expect(a).toContain(":email");
    expect(a).not.toContain("alice@");
  });

  it("collapses JWTs to :jwt", () => {
    const out = normalizeFingerprintKey(
      "bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-_1 here"
    );
    expect(out).toContain(":jwt");
  });
});

describe("reportError redacts PII in the persisted message (finding 2227)", () => {
  it("writes a redacted p_error_message to audit_log", async () => {
    reportError(new Error("login failed for alice@example.com"), "redaction-e2e-source-unique");
    // reportToAuditLog is fired as a floating promise; flush microtasks/timers.
    await new Promise((r) => setTimeout(r, 20));

    const writeCall = rpcMock.mock.calls.find((c) => c[0] === "write_audit_log");
    expect(writeCall, "write_audit_log should have been called").toBeTruthy();
    const payload = writeCall![1] as { p_error_message: string };
    expect(payload.p_error_message).toContain("[redacted-email]");
    expect(payload.p_error_message).not.toContain("alice@example.com");
  });
});
