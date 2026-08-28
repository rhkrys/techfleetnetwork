import { describe, it, expect, vi } from "vitest";

// Capture the write_audit_log payload so we can assert the persisted message is
// redacted (finding 2227, adjacent chokepoint — same PII class as error-reporter).
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import { logSecurityEvent } from "@/lib/security-events";

describe("logSecurityEvent redacts PII in errorMessage (2227-adjacent)", () => {
  it("writes a redacted p_error_message", async () => {
    await logSecurityEvent({
      event: "authn_login_failure",
      table: "auth.users",
      errorMessage: "login failed for eve@example.com",
    });
    const call = rpcMock.mock.calls.find((c) => c[0] === "write_audit_log");
    expect(call, "write_audit_log should have been called").toBeTruthy();
    const payload = call![1] as { p_error_message: string };
    expect(payload.p_error_message).toContain("[redacted-email]");
    expect(payload.p_error_message).not.toContain("eve@example.com");
  });
});
