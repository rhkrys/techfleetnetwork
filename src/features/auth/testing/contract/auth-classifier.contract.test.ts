import { describe, expect, it } from "vitest";
import { classifyAuthErrorCode } from "../../services/auth-classifier";

describe("auth-classifier contract", () => {
  it("trusts a typed server code", () => {
    expect(classifyAuthErrorCode({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(classifyAuthErrorCode({ code: "rate_limited" })).toBe("rate_limited");
    expect(classifyAuthErrorCode({ body: { code: "mfa_required" } })).toBe("mfa_required");
  });

  it("ignores unknown codes and returns unexpected", () => {
    expect(classifyAuthErrorCode({ code: "not_a_real_code" })).toBe("unexpected");
  });

  // VICHEA REGRESSION GUARDS — these must never produce invalid_credentials.
  const VICHEA_INPUTS: unknown[] = [
    new (class ClientSessionWriteError extends Error { constructor() { super("Invalid login response"); this.name = "ClientSessionWriteError"; } })(),
    Object.assign(new Error("Invalid login response"), { name: "ClientSessionWriteError" }),
    "Invalid login response",
    new Error("Invalid login response"),
  ];
  it.each(VICHEA_INPUTS.map((v, i) => [i, v]))("vichea input #%i is never invalid_credentials", (_, input) => {
    const code = classifyAuthErrorCode(input);
    expect(code).not.toBe("invalid_credentials");
  });

  it("maps ClientSessionWriteError to client_session_write_failed", () => {
    const e = new Error("anything");
    e.name = "ClientSessionWriteError";
    expect(classifyAuthErrorCode(e)).toBe("client_session_write_failed");
  });

  it("maps HTTP 429 to rate_limited", () => {
    expect(classifyAuthErrorCode({ status: 429 })).toBe("rate_limited");
  });

  it("maps network errors via message", () => {
    expect(classifyAuthErrorCode(new Error("Failed to fetch"))).toBe("network_error");
  });

  it("string-matched paths can never produce punitive codes", () => {
    // Forge a message that historically caused misclassification.
    expect(classifyAuthErrorCode("Invalid login")).not.toBe("invalid_credentials");
    expect(classifyAuthErrorCode("Account locked")).not.toBe("account_locked");
  });
});
