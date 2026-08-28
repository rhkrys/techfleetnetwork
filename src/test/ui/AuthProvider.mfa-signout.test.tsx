/**
 * Audit P35 regression — on SIGNED_OUT the AuthProvider must clear the per-tab MFA
 * factor cache, so the next user to sign in on the same tab within the 60s TTL can
 * never read the previous user's enrolled factors.
 *
 * Fails on pre-fix code: the SIGNED_OUT handler cleared session + React Query cache
 * but never invalidated the MFA factor cache.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";

const { resetMfaSpy } = vi.hoisted(() => ({ resetMfaSpy: vi.fn() }));

const authSubscribers = new Set<(event: string, session: unknown) => void>();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi
        .fn()
        .mockImplementation((cb: (event: string, session: unknown) => void) => {
          authSubscribers.add(cb);
          setTimeout(() => cb("INITIAL_SESSION", null), 0);
          return { data: { subscription: { unsubscribe: () => authSubscribers.delete(cb) } } };
        }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
  },
}));

// Keep the real module but spy on the sign-out reset so we can assert AuthContext calls it.
vi.mock("@/services/mfa.service", async (orig) => ({
  ...(await orig<typeof import("@/services/mfa.service")>()),
  resetMfaCachesForSignOut: resetMfaSpy,
}));

vi.mock("@/services/profile.service", () => ({
  ProfileService: {
    fetch: vi.fn().mockResolvedValue(null),
    updateNames: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/services/discord-notify.service", () => ({
  DiscordNotifyService: { userSignedUp: vi.fn() },
}));

describe("AuthProvider — MFA cache cleared on sign-out (P35)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authSubscribers.clear();
    vi.clearAllMocks();
  });

  it("invalidates the MFA factor cache when a SIGNED_OUT event fires", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AuthProvider>
            <div />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Let the provider subscribe to auth state changes.
    await waitFor(() => expect(authSubscribers.size).toBeGreaterThan(0));

    // Fire SIGNED_OUT through the subscribed handler(s).
    for (const cb of authSubscribers) cb("SIGNED_OUT", null);

    await waitFor(() => expect(resetMfaSpy).toHaveBeenCalled());
  });
});
