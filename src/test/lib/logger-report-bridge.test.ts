import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { reportMock, isEnabledMock, refreshMock } = vi.hoisted(() => ({
  reportMock: vi.fn(),
  isEnabledMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("@/lib/observability/report", () => ({ report: reportMock }));
vi.mock("@/services/feature-flags.service", () => ({
  isFeatureEnabled: isEnabledMock,
  refreshFeatureFlags: refreshMock,
}));

import { installLoggerReporting } from "@/lib/observability/logger-report-bridge";
import { createLogger, setLoggerErrorForwarder } from "@/services/logger.service";

describe("logger-report bridge (ADR-0021)", () => {
  beforeEach(() => {
    reportMock.mockClear();
    isEnabledMock.mockReset();
    refreshMock.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    setLoggerErrorForwarder(null);
    vi.restoreAllMocks();
  });

  it("warms the flag snapshot on install", () => {
    installLoggerReporting();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("reports an error (redacted) when the flag is ON", () => {
    isEnabledMock.mockReturnValue(true);
    installLoggerReporting();
    createLogger("BridgeA").error("act", "boom eve@example.com");
    expect(reportMock).toHaveBeenCalledTimes(1);
    const [err, ctx] = reportMock.mock.calls[0] as [Error, { source: string; severity: string }];
    expect(ctx.source).toBe("BridgeA:act");
    expect(ctx.severity).toBe("error");
    expect(err.message).toContain("[redacted-email]");
    expect(err.message).not.toContain("eve@example.com");
  });

  it("forwards the ORIGINAL error (preserving code) so the classifier works", () => {
    isEnabledMock.mockReturnValue(true);
    installLoggerReporting();
    const original = Object.assign(new Error("schema cache reload"), { code: "PGRST002" });
    createLogger("BridgeC").error("query", "query failed", undefined, original);
    expect(reportMock).toHaveBeenCalledTimes(1);
    const [err] = reportMock.mock.calls[0] as [unknown, unknown];
    // Same object (not a lossy reconstruction) → report()'s classifier sees the
    // transient PG code and routes it to infra_transient, not a fake bug.
    expect(err).toBe(original);
    expect((err as { code?: string }).code).toBe("PGRST002");
  });

  it("does NOT report when the flag is OFF (safe default)", () => {
    isEnabledMock.mockReturnValue(false);
    installLoggerReporting();
    createLogger("BridgeB").error("act", "boom");
    expect(reportMock).not.toHaveBeenCalled();
  });
});
