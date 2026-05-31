// Regression: invalid_refresh_token_cleared must NEVER reach agent_fix_queue (it self-heals).
import { describe, it, expect } from "vitest";
import { isSuppressed } from "@/services/error-reporter.service";

describe("incident: invalid_refresh_token_cleared is silent", () => {
  it("drops invalid refresh token signal", () => {
    expect(isSuppressed("invalid_refresh_token_cleared")).toBe(true);
  });

  it("drops email_queue.rate_limited (self-heals via cooldown)", () => {
    expect(isSuppressed("email_queue.rate_limited")).toBe(true);
  });
});
