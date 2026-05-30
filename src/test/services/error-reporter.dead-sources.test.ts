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

vi.mock("@/lib/deploy-watcher", () => ({
  checkNow: vi.fn(),
}));

vi.mock("@/lib/trace", () => ({ getCurrentTraceId: () => undefined }));

import { reportError } from "@/services/error-reporter.service";
import { supabase } from "@/integrations/supabase/client";
import { checkNow } from "@/lib/deploy-watcher";

const rpcMock = supabase.rpc as ReturnType<typeof vi.fn>;
const checkNowMock = checkNow as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpcMock.mockClear();
  checkNowMock.mockClear();
});

describe("error-reporter — stale-bundle transport suppression", () => {
  it("never writes audit_log for stale transport failures", async () => {
    reportError(
      new Error("FunctionsFetchError: Failed to send a request to the Edge Function"),
      "legacy-client.token",
      { severity: "warn" },
    );
    await new Promise((r) => setTimeout(r, 0));
    const writeAuditCalls = rpcMock.mock.calls.filter((c) => c[0] === "write_audit_log");
    expect(writeAuditCalls).toHaveLength(0);
  });

  it("triggers a deploy-watcher check on FunctionsFetchError so stuck tabs reload", async () => {
    reportError(
      new Error("FunctionsFetchError: Failed to send a request to the Edge Function"),
      "legacy-client.token",
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(checkNowMock).toHaveBeenCalled();
  });

  it("still surfaces real errors from live components", async () => {
    reportError(new Error("ReferenceError: foo is not defined"), "DashboardPage.handleX");
    await new Promise((r) => setTimeout(r, 0));
    const writeAuditCalls = rpcMock.mock.calls.filter((c) => c[0] === "write_audit_log");
    expect(writeAuditCalls.length).toBeGreaterThanOrEqual(1);
  });
});
