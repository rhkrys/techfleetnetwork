// bdd-gate coverage: src/services/mfa.service.ts
// Audit P35 hardening — an in-flight listFactors() that resolves AFTER a sign-out
// reset must NOT re-seed the factor cache with the previous user's factors.
import { describe, it, expect, beforeEach, vi } from "vitest";

let listFactorsImpl: () => Promise<{ data: { all: unknown[] } | null; error: unknown }>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { mfa: { listFactors: () => listFactorsImpl() } } },
}));
vi.mock("@/services/logger.service", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import {
  MfaService,
  resetMfaCachesForSignOut,
  __resetMfaServiceCachesForTests,
} from "@/services/mfa.service";

const factor = (id: string) => ({
  id,
  factor_type: "totp",
  status: "verified",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("MFA factor cache — sign-out race (P35 hardening)", () => {
  beforeEach(() => __resetMfaServiceCachesForTests());

  it("an in-flight fetch resolving after sign-out does not re-seed the cache", async () => {
    // Previous user's fetch — deferred so we can sign out while it is in flight.
    let resolveA!: () => void;
    listFactorsImpl = () =>
      new Promise((r) => {
        resolveA = () => r({ data: { all: [factor("A")] }, error: null });
      });

    const pA = MfaService.listFactors(); // in flight; gen captured
    resetMfaCachesForSignOut(); // SIGNED_OUT mid-flight → gen bumped
    resolveA(); // A resolves now — must NOT seed the cache
    await pA;

    // Next user on the same tab: their fetch returns B.
    listFactorsImpl = async () => ({ data: { all: [factor("B")] }, error: null });
    const next = await MfaService.listFactors();

    // Pre-fix: A re-seeded the cache, so this returned ["A"] (the leak). Fixed: ["B"].
    expect(next.map((f) => f.id)).toEqual(["B"]);
  });
});
