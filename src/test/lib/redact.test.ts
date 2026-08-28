import { describe, it, expect } from "vitest";
import { redactText } from "@/lib/redact";

describe("redactText", () => {
  it("redacts email addresses", () => {
    expect(redactText("contact alice@example.com now")).toBe("contact [redacted-email] now");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc-_123";
    expect(redactText(`token ${jwt} rejected`)).toBe("token [redacted-jwt] rejected");
  });

  it("redacts bearer tokens without leaking the secret", () => {
    const out = redactText("header Authorization: Bearer abcDEF.ghi-123_456");
    expect(out).toContain("Bearer [redacted]");
    expect(out).not.toContain("abcDEF");
  });

  it("redacts multiple emails in one string", () => {
    expect(redactText("a@b.com and c@d.org")).toBe("[redacted-email] and [redacted-email]");
  });

  it("leaves clean text unchanged", () => {
    expect(redactText("just a normal error message")).toBe("just a normal error message");
  });

  it("handles empty input", () => {
    expect(redactText("")).toBe("");
  });
});
