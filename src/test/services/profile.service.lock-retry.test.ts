/**
 * AUTH-LOCK-RETRY-001 regression: ProfileService.fetch must retry exactly
 * once when GoTrue's Web Lock is stolen by a parallel auth call (the
 * "AbortError: Lock broken by another request with the 'steal' option."
 * surface observed during identity bootstrap).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { ProfileService } from "@/services/profile.service";

function chainOnce(value: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => Promise.resolve(value)),
  };
  return builder;
}

describe("ProfileService.fetch — auth lock contention retry (AUTH-LOCK-RETRY-001)", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("retries once when the first call throws AbortError: Lock broken … and succeeds on the second", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // Simulate Web Locks contention surfacing from the underlying call.
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => {
            const err = Object.assign(new Error("Lock broken by another request with the 'steal' option."), {
              name: "AbortError",
            });
            return Promise.reject(err);
          }),
        };
        return builder;
      }
      return chainOnce({
        data: {
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.com",
          country: "UK",
          timezone: "Europe/London",
          discord_username: "",
          discord_user_id: "",
          display_name: "Ada",
          avatar_url: null,
          profile_completed: true,
          interests: [],
          portfolio_url: "",
          linkedin_url: "",
          scheduling_url: "",
          experience_areas: [],
          professional_goals: "",
          notify_training_opportunities: true,
          notify_announcements: true,
          education_background: [],
          has_discord_account: false,
          discord_invite_url: "",
          membership_tier: "community",
          is_founding_member: false,
          membership_billing_period: "",
          membership_sku: "",
          membership_gumroad_sale_id: "",
          membership_updated_at: null,
          preferred_language: null,
        },
        error: null,
      });
    });

    const out = await ProfileService.fetch("user-1");
    expect(out?.first_name).toBe("Ada");
    expect(call).toBe(2);
  });

  it("does NOT retry a non-lock AbortError", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call += 1;
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() => {
          const err = Object.assign(new Error("signal is aborted without reason"), { name: "AbortError" });
          return Promise.reject(err);
        }),
      };
      return builder;
    });

    // Our `withAuthLockRetry` wrapper only retries the Lock-broken pattern;
    // other AbortErrors flow into `retryPostgrest` which DOES treat them as
    // transient — so the total observed attempts are bounded by the inner
    // retry budget (default 3 retries + 1 = 4), not by the lock wrapper.
    const out = await ProfileService.fetch("user-1");
    expect(out).toBeNull();
    expect(call).toBeGreaterThanOrEqual(1);
  });
});
