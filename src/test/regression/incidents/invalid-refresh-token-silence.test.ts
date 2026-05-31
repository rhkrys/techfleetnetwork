// Regression: invalid_refresh_token_cleared must NEVER reach agent_fix_queue (it self-heals).
// Lock in: error-reporter classifier drops it.
import { describe, it, expect } from "vitest";
import { classifyError } from "@/lib/observability/classify";

describe("incident: invalid_refresh_token_cleared is silent", () => {
  it("drops invalid refresh token signal", () => {
    const verdict = classifyError({
      message: "invalid_refresh_token_cleared",
      source: "auth",
    });
    expect(verdict.action).toBe("drop");
  });

  it("drops validation_rejected (Zod path) — not triage worthy", () => {
    const verdict = classifyError({
      message: "validation_rejected: email invalid",
      source: "edge-fn",
    });
    expect(verdict.action).toBe("drop");
  });

  it("drops aggregate dedup flush events", () => {
    const verdict = classifyError({
      message: "duplicate client error(s) deduped",
      source: "client",
    });
    expect(verdict.action).toBe("drop");
  });

  it("drops email_queue.rate_limited (self-heals via cooldown)", () => {
    const verdict = classifyError({
      message: "email_queue.rate_limited",
      source: "edge-fn",
    });
    expect(verdict.action).toBe("drop");
  });
});
