import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within, cleanup } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

/**
 * Navigation refactor coverage:
 *  - The admin "Curriculum" page/link (/admin/curriculum) is fully removed.
 *  - The class-approval queue moved out of the Admin group into the Teaching
 *    group, renamed "All Classes", and stays admin-only.
 *
 * These are behavioral (Gherkin-style) scenarios wired into the Vitest suite so
 * a regression that re-adds Curriculum or leaks All Classes to non-admin
 * teachers fails CI.
 */

// Auth: always a logged-in user (AppSidebar returns null otherwise).
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "t@example.com" } }),
}));

// Role hooks are re-stubbed per scenario.
const adminState = { isAdmin: false };
const teacherState = { isTeacher: false };
vi.mock("@/hooks/use-admin", () => ({ useAdmin: () => adminState }));
vi.mock("@/hooks/use-teacher", () => ({ useTeacher: () => teacherState }));

// Avoid a real PostgREST call for the pending-count badge.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: 0, error: null }) },
}));

function renderSidebar() {
  return renderWithRouter(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>
  );
}

describe("AppSidebar navigation refactor", () => {
  beforeEach(() => {
    adminState.isAdmin = false;
    teacherState.isTeacher = false;
  });
  afterEach(() => cleanup());

  it("never renders the removed admin Curriculum link (any role)", () => {
    adminState.isAdmin = true;
    teacherState.isTeacher = true;
    renderSidebar();
    expect(screen.queryByText("Curriculum")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /curriculum/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/curriculum"]')).toBeNull();
  });

  it("shows 'All Classes' under the Teaching group for admins, pointing at /admin/classes", () => {
    adminState.isAdmin = true;
    renderSidebar();
    const link = screen.getByRole("link", { name: /all classes/i });
    expect(link).toHaveAttribute("href", "/admin/classes");
    // It must live in the Teaching group, not a stray Admin entry.
    const teaching = screen.getByText("Teaching").closest("div[data-sidebar='group']")!;
    expect(within(teaching as HTMLElement).getByText("All Classes")).toBeInTheDocument();
  });

  it("hides 'All Classes' from non-admin teachers (approval queue is admin-only)", () => {
    teacherState.isTeacher = true; // teacher but NOT admin
    renderSidebar();
    // Teaching group still renders "My Classes"...
    expect(screen.getByRole("link", { name: /my classes/i })).toBeInTheDocument();
    // ...but not the admin-only approval queue.
    expect(screen.queryByText("All Classes")).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin/classes"]')).toBeNull();
  });

  it("no longer lists an admin 'Classes' entry in the Admin group", () => {
    adminState.isAdmin = true;
    renderSidebar();
    // Old label was exactly "Classes"; the new label is "All Classes".
    expect(screen.queryByText("Classes")).not.toBeInTheDocument();
  });
});
