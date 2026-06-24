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

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <div data-testid="state">loading</div>;
  return <div data-testid="state">{user ? "signed-in" : "signed-out"}</div>;
}

function seedWedgedStorage() {
  const url = (import.meta.env.VITE_SUPABASE_URL as string) || "https://pzvqxdgoztbfikfuifix.supabase.co";
  const ref = new URL(url).hostname.split(".")[0];
  localStorage.setItem(
    `sb-${ref}-auth-token`,
    JSON.stringify({
      access_token: "not-a-jwt-just-garbage",
      refresh_token: "rt-garbage",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: { id: "00000000-0000-0000-0000-000000000000", email: "wedge@test" },
    })
  );
}

describe("AuthProvider — wedge recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
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
