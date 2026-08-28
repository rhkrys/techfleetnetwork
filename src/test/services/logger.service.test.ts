// bdd-gate coverage: src/services/logger.service.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger } from "@/services/logger.service";

describe("logger redacts PII in the message argument (finding 2232)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts an email in the error message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createLogger("RedactTestA").error("save", "failed for user alice@example.com");
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls[0].join(" ");
    expect(logged).toContain("[redacted-email]");
    expect(logged).not.toContain("alice@example.com");
  });

  it("redacts a JWT in the error message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-_123";
    createLogger("RedactTestB").error("auth", `token ${jwt} rejected`);
    const logged = spy.mock.calls[0].join(" ");
    expect(logged).toContain("[redacted-jwt]");
    expect(logged).not.toContain(jwt);
  });
});
