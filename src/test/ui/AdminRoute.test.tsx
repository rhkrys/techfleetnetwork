import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminRoute } from "@/components/AdminRoute";

// Mock useAuth
const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock useAdmin
const mockUseAdmin = vi.fn();
vi.mock("@/hooks/use-admin", () => ({
  useAdmin: () => mockUseAdmin(),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

// AdminRoute now enforces an admin-2FA gate after the auth+admin checks: it
// resolves MFA state via MfaService + two grace RPCs before rendering children.
// A fully-set-up admin (hasVerifiedTotp = true) skips the setup/grace screens.
vi.mock("@/services/mfa.service", () => ({
  MfaService: { hasVerifiedTotp: vi.fn().mockResolvedValue(true) },
}));
vi.mock("@/lib/db/rpc-with-timeout", () => ({
  rpcWithTimeout: vi.fn().mockResolvedValue({ data: null, error: null }),
}));
vi.mock("@/services/error-reporter.service", () => ({
  reportError: vi.fn(),
}));

function renderWithRouter(initialEntry: string = "/admin/test") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/admin/test"
          element={
            <AdminRoute>
              <div data-testid="admin-content">Admin Content</div>
            </AdminRoute>
          }
        />
        <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        <Route
          path="/access-denied"
          element={<div data-testid="access-denied-page">Access Denied</div>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner while auth is loading", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, profileLoaded: false });
    mockUseAdmin.mockReturnValue({ isAdmin: false, loading: true });
    renderWithRouter();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("redirects to /login when user is not authenticated", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, profileLoaded: true });
    mockUseAdmin.mockReturnValue({ isAdmin: false, loading: false });
    renderWithRouter();
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
  });

  it("redirects to /access-denied when user is not admin", () => {
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
      profileLoaded: true,
    });
    mockUseAdmin.mockReturnValue({ isAdmin: false, loading: false });
    renderWithRouter();
    expect(screen.getByTestId("access-denied-page")).toBeInTheDocument();
  });

  it("renders children when user is admin (2FA satisfied)", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" },
      loading: false,
      profileLoaded: true,
    });
    mockUseAdmin.mockReturnValue({ isAdmin: true, loading: false });
    renderWithRouter();
    // mfaState resolves asynchronously (MfaService + grace RPCs) before children render.
    expect(await screen.findByTestId("admin-content")).toBeInTheDocument();
  });
});
