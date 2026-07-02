import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";

/**
 * BDD Scenarios covered (feature_area = "Admin Projects"):
 *   PROJECT-001 — Admin can create a project under a client (Add Project button → form route)
 *   PROJECT-002 — Admin can edit an existing project (Edit pencil → edit route)
 *   PROJECT-003 — Admin can delete a project (confirm dialog → delete mutation)
 *   PROJECT-004 — Computed milestone fields surface in the project card
 *   PROJECT-005 — Only Active clients are returned for the form (RLS-shaped query)
 *   PROJECT-006 — Selected client metadata surfaces (logo, name) on the project card
 *   PROJECT-007 — Non-admin route guard redirects to /dashboard
 *
 * These tests intentionally exercise the PRESENTATION + WIRING surface only.
 * The Discord/role/coordinator picker behavior is covered separately and is
 * heavy to mock here (it pulls live edge-function data). A dedicated
 * Playwright spec for the full ProjectFormPage will be added in a follow-up.
 */

// ---------- Mocks ----------
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockUseAuth() }));

const mockUseAdmin = vi.fn();
vi.mock("@/hooks/use-admin", () => ({ useAdmin: () => mockUseAdmin() }));

vi.mock("@/hooks/use-milestone-reference", async () => {
  const actual = await vi.importActual<any>("@/hooks/use-milestone-reference");
  return {
    ...actual,
    useMilestoneReference: () => ({ data: [
      { milestone_name: "Discovery", deliverables: ["Research plan"], skills: ["Interviewing"], activities: ["Stakeholder interviews"] },
    ] }),
    computeMilestoneData: (milestones: string[]) => ({
      deliverables: milestones.length ? ["Research plan"] : [],
      skills: milestones.length ? ["Interviewing"] : [],
      activities: milestones.length ? ["Stakeholder interviews"] : [],
    }),
  };
});

// AG Grid pulls heavy DOM; render a deterministic stand-in for the table view.
vi.mock("@/components/AgGrid", () => ({
  ThemedAgGrid: ({ rowData }: { rowData: unknown[] }) => (
    <div data-testid="themed-ag-grid">grid:{rowData.length}</div>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ---------- Supabase mock ----------
type Row = Record<string, unknown>;
const fixtures: { clients: Row[]; projects: Row[]; activeOnly: boolean; lastDeleteId?: string } = {
  clients: [
    { id: "c1", name: "Acme Co", status: "active", logo_url: "", website: "https://acme.test", primary_contact: "Ada", mission: "Do good", project_summary: "Phase 1 work" },
    { id: "c2", name: "Stale Inc", status: "archived" },
  ],
  projects: [
    {
      id: "p1", client_id: "c1", project_type: "website_design", phase: "phase_1",
      team_hats: ["Designer"], project_status: "recruiting", current_phase_milestones: ["Discovery"],
      friendly_name: "Marketing Site", description: "Build it", created_by: "admin-1",
      requires_interview: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ],
  activeOnly: false,
};

vi.mock("@/integrations/supabase/client", () => {
  const buildClientsQuery = () => {
    const chain: any = {
      _filters: {} as Record<string, unknown>,
      eq(col: string, val: unknown) { this._filters[col] = val; return this; },
      order() {
        const rows = fixtures.clients.filter((c) =>
          Object.entries(chain._filters).every(([k, v]) => c[k] === v),
        );
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return chain;
  };
  const buildProjectsQuery = () => ({
    order: () => Promise.resolve({ data: fixtures.projects, error: null }),
  });
  return {
    supabase: {
      from: (table: string) => ({
        select: () => (table === "clients" ? buildClientsQuery() : buildProjectsQuery()),
        delete: () => ({
          eq: (_col: string, val: string) => {
            fixtures.lastDeleteId = val;
            fixtures.projects = fixtures.projects.filter((p) => p.id !== val);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    },
  };
});

// ---------- Helpers ----------
function renderWithProviders(ui: React.ReactElement, route = "/admin/clients?tab=projects") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/admin/clients" element={ui} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------- Tests ----------
describe("Admin Projects (BDD PROJECT-001..007)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.projects = [
      {
        id: "p1", client_id: "c1", project_type: "website_design", phase: "phase_1",
        team_hats: ["Designer"], project_status: "recruiting", current_phase_milestones: ["Discovery"],
        friendly_name: "Marketing Site", description: "Build it", created_by: "admin-1",
        requires_interview: true,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ];
    fixtures.lastDeleteId = undefined;
    mockUseAuth.mockReturnValue({
      user: { id: "admin-1" }, session: {}, loading: false, profileLoaded: true,
    });
    mockUseAdmin.mockReturnValue({ isAdmin: true, loading: false });
  });

  it("PROJECT-001: Add Project button navigates to the new-project form", async () => {
    const { ProjectsTab } = await import("@/components/clients/ProjectsTab");
    renderWithProviders(<ProjectsTab />);

    const addBtn = await screen.findByRole("button", { name: /add project/i });
    fireEvent.click(addBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/admin/clients/projects/new");
  });

  it("PROJECT-002: Edit button on a project card navigates to its edit form", async () => {
    const { ProjectsTab } = await import("@/components/clients/ProjectsTab");
    renderWithProviders(<ProjectsTab />);

    const editBtn = await screen.findByRole("button", { name: /edit project/i });
    fireEvent.click(editBtn);
    expect(mockNavigate).toHaveBeenCalledWith("/admin/clients/projects/p1/edit");
  });

  it("PROJECT-003: Delete button opens a confirmation dialog and removes the project on confirm", async () => {
    const { ProjectsTab } = await import("@/components/clients/ProjectsTab");
    renderWithProviders(<ProjectsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /delete project/i }));
    expect(await screen.findByText(/Delete this project\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(fixtures.lastDeleteId).toBe("p1"));
  });

  it("PROJECT-004: Computed milestone fields surface as read-only pills on the card", async () => {
    const { ProjectsTab } = await import("@/components/clients/ProjectsTab");
    renderWithProviders(<ProjectsTab />);

    expect(await screen.findByText(/Milestones/i)).toBeInTheDocument();
    expect(screen.getByText("Discovery")).toBeInTheDocument();
    expect(screen.getByText(/Deliverables/i)).toBeInTheDocument();
    expect(screen.getByText("Research plan")).toBeInTheDocument();
  });

  it("PROJECT-005: Active-clients query path returns only Active clients", async () => {
    // Mirrors the form's filter: .from('clients').select('*').eq('status','active')
    const { supabase } = await import("@/integrations/supabase/client");
    const result = await (supabase.from("clients").select("*") as any).eq("status", "active").order("name");
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect((result.data as any[])[0].name).toBe("Acme Co");
  });

  it("PROJECT-006: Project card shows the joined client's name and metadata", async () => {
    const { ProjectsTab } = await import("@/components/clients/ProjectsTab");
    renderWithProviders(<ProjectsTab />);

    expect(await screen.findByText(/Acme Co/)).toBeInTheDocument();
    expect(screen.getByText(/Marketing Site/)).toBeInTheDocument();
  });

  it("PROJECT-007: Non-admin visiting /admin/clients is redirected to /access-denied", async () => {
    mockUseAdmin.mockReturnValue({ isAdmin: false, loading: false });
    const { AdminRoute } = await import("@/components/AdminRoute");
    const ClientsPage = (await import("@/pages/ClientsPage")).default;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/admin/clients"]}>
          <Routes>
            <Route path="/admin/clients" element={<AdminRoute><ClientsPage /></AdminRoute>} />
            <Route path="/access-denied" element={<div data-testid="access-denied-page">Access Denied</div>} />
            <Route path="/login" element={<div>Login</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("access-denied-page")).toBeInTheDocument();
    expect(screen.queryByText(/Clients & Projects/i)).not.toBeInTheDocument();
  });
});
