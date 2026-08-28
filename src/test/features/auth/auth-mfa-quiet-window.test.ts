import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { mfa: {} } } }));
vi.mock("@/services/logger.service", () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/features/auth/services/auth-telemetry", () => ({
  emitAuthBeacon: vi.fn(),
  newCorrelationId: () => "cid",
}));

import {
  markRecentlyVerified,
  isWithinQuietWindow,
  resetMfaQuietWindowForSignOut,
} from "@/features/auth/services/auth-mfa.service";

describe("MFA post-verify quiet window — reset on sign-out (P35 review follow-up)", () => {
  beforeEach(() => resetMfaQuietWindowForSignOut());

  it("resetMfaQuietWindowForSignOut clears an active quiet window", () => {
    const now = 1_000_000;
    markRecentlyVerified(now);
    expect(isWithinQuietWindow(now)).toBe(true);
    resetMfaQuietWindowForSignOut();
    // recentlyVerifiedAt is back to 0, which is > QUIET_WINDOW_MS in the past.
    expect(isWithinQuietWindow(now)).toBe(false);
  });
});
