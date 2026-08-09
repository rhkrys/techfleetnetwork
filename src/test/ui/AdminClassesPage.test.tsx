import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";

/**
 * Coverage for the admin class-approval queue (AdminClassesPage.tsx).
 * Locks in the "All Classes" heading (renamed from "Classes (Admin)" when the
 * nav entry moved under Teaching) and the "New Class" call-to-action target.
 */

// AdminClassesPage reads its data via useAllClasses; return an empty, settled
// list so the page renders its header/filters without a real PostgREST call.
vi.mock("@/hooks/use-classes", () => ({
  useAllClasses: () => ({ data: [], isLoading: false }),
}));

// AG Grid pulls heavy DOM; render a deterministic stand-in for the table view.
vi.mock("@/components/AgGrid", () => ({
  ThemedAgGrid: ({ rowData }: { rowData: unknown[] }) => (
    <div data-testid="themed-ag-grid">grid:{rowData.length}</div>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function renderPage() {
  const { default: AdminClassesPage } = await import("@/pages/AdminClassesPage");
  return renderWithRouter(<AdminClassesPage />);
}

describe("AdminClassesPage (All Classes approval queue)", () => {
  it("renders the 'All Classes' heading", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "All Classes" })).toBeInTheDocument();
  });

  it("exposes the status filter tabs (defaults to Pending review)", async () => {
    await renderPage();
    const pending = screen.getByRole("tab", { name: /pending review/i });
    expect(pending).toBeInTheDocument();
    expect(pending).toHaveAttribute("aria-selected", "true");
  });

  it("links 'New Class' to the teacher class-creation route", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /new class/i })).toHaveAttribute(
      "href",
      "/teach/classes/new"
    );
  });
});
