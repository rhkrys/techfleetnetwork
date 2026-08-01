import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";

/**
 * BDD 13.2 — Non-admin cannot access the User Admin page.
 *
 * Access control is enforced by the <AdminRoute> route wrapper
 * (UserAdminPage.tsx:84 "Admin check is handled by AdminRoute wrapper";
 * App.tsx routes it as <AdminRoute><UserAdminPage/></AdminRoute>). The
 * redirect/loading behavior for BDD 13.2 is verified in AdminRoute.test.tsx.
 * This suite verifies the page itself renders its admin surface when reached.
 */

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseAdmin = vi.fn();
vi.mock("@/hooks/use-admin", () => ({
  useAdmin: () => mockUseAdmin(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({
        order: () => ({ data: [], error: null }),
        eq: () => ({
          eq: () => ({
            maybeSingle: () => ({ data: null }),
            single: () => ({ data: null }),
          }),
          single: () => ({ data: null }),
        }),
        is: () => ({ data: [], error: null }),
      }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      // cached-session.ts subscribes at module load; without this the dynamic
      // import of UserAdminPage throws "onAuthStateChange is not a function".
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
}));

describe("UserAdminPage (BDD 13.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the User Admin surface for an admin (access control enforced by AdminRoute)", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "user-1" },
      profile: { first_name: "Test" },
      loading: false,
      profileLoaded: true,
    });
    mockUseAdmin.mockReturnValue({ isAdmin: true, loading: false });

    const { default: UserAdminPage } = await import("@/pages/UserAdminPage");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <UserAdminPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText("User Admin")).toBeInTheDocument();
  });
});
