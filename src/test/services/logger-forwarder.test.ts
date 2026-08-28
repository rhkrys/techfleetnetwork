// bdd-gate coverage: src/services/logger.service.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger, setLoggerErrorForwarder } from "@/services/logger.service";

describe("logger error forwarder (ADR-0021)", () => {
  afterEach(() => {
    setLoggerErrorForwarder(null);
    vi.restoreAllMocks();
  });

  it("forwards error-level logs with a redacted message + source", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fwd = vi.fn();
    setLoggerErrorForwarder(fwd);
    createLogger("FwdSvcA").error("save", "failed for alice@example.com");
    expect(fwd).toHaveBeenCalledTimes(1);
    const payload = fwd.mock.calls[0][0] as { service: string; action: string; message: string };
    expect(payload.service).toBe("FwdSvcA");
    expect(payload.action).toBe("save");
    expect(payload.message).toContain("[redacted-email]");
    expect(payload.message).not.toContain("alice@example.com");
  });

  it("does NOT forward non-error levels", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fwd = vi.fn();
    setLoggerErrorForwarder(fwd);
    const log = createLogger("FwdSvcB");
    log.info("x", "hello");
    log.warn("y", "watch out");
    expect(fwd).not.toHaveBeenCalled();
  });

  it("never throws if the forwarder throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLoggerErrorForwarder(() => {
      throw new Error("boom");
    });
    expect(() => createLogger("FwdSvcC").error("z", "kaboom")).not.toThrow();
  });

  it("can be uninstalled", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fwd = vi.fn();
    setLoggerErrorForwarder(fwd);
    setLoggerErrorForwarder(null);
    createLogger("FwdSvcD").error("z", "msg");
    expect(fwd).not.toHaveBeenCalled();
  });
});
