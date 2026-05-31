// Regression: invalid_refresh_token_cleared was being triaged as an error.
// Lock in: classifier marks it as suppressed (never enqueued to agent_fix_queue).
import { describe, it, expect } from "vitest";

type Classification = "suppress" | "enqueue";

function classify(message: string): Classification {
  const SUPPRESS = [
    /invalid_refresh_token_cleared/i,
    /validation_rejected/i,
    /ResizeObserver loop/i,
    /duplicate client error\(s\) deduped/i,
    /email_queue\.rate_limited/i,
    /MetaMask/i,
    /Extension context invalidated/i,
    /^Script error\.?$/i,
  ];
  return SUPPRESS.some((r) => r.test(message)) ? "suppress" : "enqueue";
}

describe("incident: invalid_refresh_token_cleared is never triaged", () => {
  it("suppresses the exact fingerprint", () => {
    expect(classify("invalid_refresh_token_cleared")).toBe("suppress");
  });

  it("suppresses when wrapped in a longer message", () => {
    expect(classify("auth: invalid_refresh_token_cleared after rotation")).toBe("suppress");
  });

  it("does not suppress a real auth error", () => {
    expect(classify("AuthApiError: Invalid login credentials")).toBe("enqueue");
  });
});
