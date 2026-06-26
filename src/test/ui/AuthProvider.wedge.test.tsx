/**
 * AUTH-WEDGE integration test.
 *
 * A non-JWT access token in localStorage must NOT wedge the AuthProvider in
 * an infinite spinner or re-render loop. The bootstrap validation gate
 * (src/contexts/AuthContext.tsx + src/lib/auth/session-health.ts) must
 * detect the bad shape, purge state, and settle logged-out.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

// ── Module mocks (hoisted — createClient never runs) ─────────────────────────

// Helper: read what the real SDK would return as a session from localStorage.
function getLocalSession() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && /^sb-.*-auth-token$/.test(key)) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch {
        /* noop */
      }
    }
  }
  return null;
}

// Subscribers for the simulated onAuthStateChange channel.
const authSubscribers = new Set<(event: string, session: unknown) => void>();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockImplementation(async () => {
        const session = getLocalSession();
        return { data: { session }, error: null };
      }),
      // Simulate the Supabase server returning bad_jwt for the garbage token.
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "bad_jwt: invalid number of segments", status: 401, name: "AuthApiError" },
      }),
      signOut: vi.fn().mockImplementation(async () => {
        for (const cb of authSubscribers) {
          setTimeout(() => cb("SIGNED_OUT", null), 0);
        }
        return { error: null };
      }),
      onAuthStateChange: vi.fn().mockImplementation((cb: (event: string, session: unknown) => void) => {
        authSubscribers.add(cb);
        const session = getLocalSession();
        setTimeout(() => cb("INITIAL_SESSION", session), 0);
        return { data: { subscription: { unsubscribe: () => authSubscribers.delete(cb) } } };
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
  },
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

// ── Helpers ──────────────────────────────────────────────────────────────────

// Use a stable key — the purgeLocalAuthState in session-health.ts scans for
// any key matching /^sb-.*-auth-token$/, so the exact ref doesn't matter here.
const WEDGE_STORAGE_KEY = "sb-testref-auth-token";

function seedWedgedStorage() {
  localStorage.setItem(
    WEDGE_STORAGE_KEY,
    JSON.stringify({
      access_token: "not-a-jwt-just-garbage",
      refresh_token: "rt-garbage",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "00000000-0000-0000-0000-000000000000", email: "wedge@test" },
    })
  );
}

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <div data-testid="state">loading</div>;
  return <div data-testid="state">{user ? "signed-in" : "signed-out"}</div>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AuthProvider — wedge recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authSubscribers.clear();
    vi.clearAllMocks();
  });

  it("settles to signed-out when a non-JWT access token is in storage", async () => {
    seedWedgedStorage();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(
      () => expect(screen.getByTestId("state").textContent).toBe("signed-out"),
      { timeout: 5000 }
    );

    const remaining = Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k));
    expect(remaining).toHaveLength(0);
  });
});
