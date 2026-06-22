/**
 * ADMIN-2FA-TIMEOUT-001 regression: AdminRoute must render its children when
 * the admin_2fa_grace_* RPCs hang, after the rpcWithTimeout helper times out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { rpcMock, hasTotpMock, useAuthMock, useAdminMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  hasTotpMock: vi.fn(),
  useAuthMock: vi.fn(),
  useAdminMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));
vi.mock("@/services/mfa.service", () => ({
  MfaService: { hasVerifiedTotp: () => hasTotpMock() },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/use-admin", () => ({ useAdmin: () => useAdminMock() }));
vi.mock("@/services/error-reporter.service", () => ({ reportError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AdminRoute } from "@/components/AdminRoute";

describe("AdminRoute fail-open on hung grace RPC (ADMIN-2FA-TIMEOUT-001)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    hasTotpMock.mockReset();
    useAuthMock.mockReset();
    useAdminMock.mockReset();
    useAuthMock.mockReturnValue({
      user: { id: "u1" },
      loading: false,
      profileLoaded: true,
    });
    useAdminMock.mockReturnValue({ isAdmin: true, loading: false });
    hasTotpMock.mockResolvedValue(true);
  });

  it("renders admin children after RPC timeout (does not hang on spinner)", async () => {
    // Both grace RPCs hang forever — must not block render past the 8s timeout.
    rpcMock.mockReturnValue(new Promise(() => { /* never resolves */ }));

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AdminRoute>
          <div data-testid="admin-child">admin content</div>
        </AdminRoute>
      </MemoryRouter>,
    );

    // Spinner shown initially.
    expect(screen.getByRole("status")).toBeInTheDocument();

    // After 8s timeout + 8s retry, mfaState resolves and children render.
    await waitFor(
      () => expect(screen.getByTestId("admin-child")).toBeInTheDocument(),
      { timeout: 20_000 },
    );
  }, 25_000);
});
