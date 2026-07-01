import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/* ── Mocks ──────────────────────────────────────────────── */

// Mock useAuth
const mockUser = { id: "user-1", email: "admin@test.com", user_metadata: { full_name: "Admin User" } };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: mockUser, session: {}, profile: null, loading: false, profileLoaded: true })),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock useAdmin — toggled per test
let mockIsAdmin = false;
vi.mock("@/hooks/use-admin", () => ({
  useAdmin: vi.fn(() => ({ isAdmin: mockIsAdmin, loading: false })),
}));

// Mock GeneralApplicationService
vi.mock("@/services/general-application.service", () => ({
  GeneralApplicationService: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            data: [],
            error: null,
          }),
          single: () => ({ data: null, error: null }),
          maybeSingle: () => ({ data: null, error: null }),
        }),
        in: () => ({ data: [], error: null }),
        order: () => ({ data: [], error: null }),
      }),
    }),
  },
}));

// Mock react-query to avoid real fetches
vi.mock("@/lib/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
    useMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  };
});

import ApplicationsPage from "@/pages/ApplicationsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/applications"]}>
      <ApplicationsPage />
    </MemoryRouter>
  );
}

/* ── BDD Scenarios ──────────────────────────────────────── */

describe("Admin Application Review (ADMIN-APPS-001 to ADMIN-APPS-005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAdmin = false;
  });

  /**
   * ADMIN-APPS-001: Admin sees the "Your Applications" and "All Applications" tabs,
   * both enabled.
   */
  it("ADMIN-APPS-001: admin sees both tabs enabled on the Applications page", () => {
    mockIsAdmin = true;
    renderPage();

    expect(screen.getByRole("tab", { name: /Your Applications/i })).toBeInTheDocument();
    const allTab = screen.getByRole("tab", { name: /All Applications/i });
    expect(allTab).toBeInTheDocument();
    expect(allTab).not.toBeDisabled();
  });

  /**
   * ADMIN-APPS-001 (cont): The default "Your Applications" tab shows the
   * "My General Application" card.
   */
  it("ADMIN-APPS-001: Your Applications tab shows the My General Application card", () => {
    mockIsAdmin = true;
    renderPage();

    expect(screen.getByText("My General Application")).toBeInTheDocument();
  });

  /**
   * ADMIN-APPS-005: Non-admin users see the "All Applications" tab but it is
   * disabled — only "Your Applications" is usable.
   */
  it("ADMIN-APPS-005: non-admin user cannot use the All Applications tab", () => {
    mockIsAdmin = false;
    renderPage();

    expect(screen.getByRole("tab", { name: /Your Applications/i })).not.toBeDisabled();
    expect(screen.getByRole("tab", { name: /All Applications/i })).toBeDisabled();
  });

  /**
   * ADMIN-APPS-005 (cont): Non-admin sees their own application cards on the
   * default tab.
   */
  it("ADMIN-APPS-005: non-admin sees their own application cards", () => {
    mockIsAdmin = false;
    renderPage();

    expect(screen.getByText("My General Application")).toBeInTheDocument();
    expect(screen.getByText("My Project Applications")).toBeInTheDocument();
    expect(screen.getByText("My Volunteer Applications")).toBeInTheDocument();
  });
});
