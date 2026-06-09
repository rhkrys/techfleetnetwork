import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
  },
}));

vi.mock("@/services/profile.service", () => ({
  ProfileService: { fetch: vi.fn().mockResolvedValue(null) },
}));

import { ProfileSetupService } from "../profile-setup.service";
import { supabase } from "@/integrations/supabase/client";

const buildUpdate = () => {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  (supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ update });
  return { eq, update };
};

describe("profile-setup.service contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("autosaveDraft NEVER sets profile_completed even if caller fabricates it", async () => {
    const { update } = buildUpdate();
    // Force a poisoned draft past the type system.
    const poisoned = { first_name: "Vichea", profile_completed: true } as never;
    await ProfileSetupService.autosaveDraft("user-1", poisoned);
    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("profile_completed");
    expect(written).toEqual({ first_name: "Vichea" });
  });

  it("autosaveDraft no-ops when the draft is empty", async () => {
    const { update } = buildUpdate();
    await ProfileSetupService.autosaveDraft("user-1", {});
    expect(update).not.toHaveBeenCalled();
  });

  it("complete is the ONLY writer of profile_completed=true", async () => {
    const { update } = buildUpdate();
    await ProfileSetupService.complete("user-1", { first_name: "V" });
    const written = update.mock.calls[0][0] as Record<string, unknown>;
    expect(written.profile_completed).toBe(true);
    expect(written.first_name).toBe("V");
  });
});
