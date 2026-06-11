import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    }),
  }));
  return {
    supabase: {
      rpc,
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    },
  };
});

vi.mock("@/lib/deploy-watcher", () => ({ checkNow: vi.fn() }));
vi.mock("@/lib/trace", () => ({ getCurrentTraceId: () => undefined }));

import { reportError } from "@/services/error-reporter.service";
import { supabase } from "@/integrations/supabase/client";

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpcMock.mockClear();
});

describe("error-reporter — structural ZodError drop (Ship 3)", () => {
  it("never writes audit_log when thrown value has name='ZodError'", async () => {
    const zodLike = Object.assign(new Error("registration_url required"), {
      name: "ZodError",
      issues: [{ path: ["registration_url"], message: "Required", code: "invalid_type" }],
    });
    reportError(zodLike, "useGeneralApplication.submit");
    await new Promise((r) => setTimeout(r, 0));
    const writeAuditCalls = rpcMock.mock.calls.filter((c) => c[0] === "write_audit_log");
    expect(writeAuditCalls).toHaveLength(0);
  });

  it("never writes audit_log when value has an issues[] array (duck-typed ZodError)", async () => {
    const ducked = {
      message: "validation failed",
      issues: [{ path: ["email"], message: "Invalid email", code: "invalid_string" }],
    };
    reportError(ducked, "RegisterScreen.onSubmit");
    await new Promise((r) => setTimeout(r, 0));
    const writeAuditCalls = rpcMock.mock.calls.filter((c) => c[0] === "write_audit_log");
    expect(writeAuditCalls).toHaveLength(0);
  });

  it("still reports non-Zod errors normally", async () => {
    reportError(new ReferenceError("foo is not defined"), "DashboardPage.render");
    await new Promise((r) => setTimeout(r, 0));
    const writeAuditCalls = rpcMock.mock.calls.filter((c) => c[0] === "write_audit_log");
    expect(writeAuditCalls.length).toBeGreaterThan(0);
  });
});
