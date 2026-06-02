import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminAllTicketsGrid from "@/pages/community/AdminAllTicketsGrid";

const invokeMock = vi.fn();
vi.mock("@/lib/support/freescoutInvoke", () => ({
  invokeFreescout: (...args: unknown[]) => invokeMock(...args),
}));

// AG Grid is heavy and not needed for this contract test — stub it to render the cellRenderer output.
vi.mock("@/components/AgGrid", () => ({
  ThemedAgGrid: ({ rowData, columnDefs }: { rowData: any[]; columnDefs: any[] }) => {
    const actions = columnDefs.find((c) => c.headerName === "Actions");
    return (
      <div>
        {rowData.map((r) => (
          <div key={r.id} data-testid={`row-${r.id}`}>
            {actions?.cellRenderer ? actions.cellRenderer({ data: r }) : null}
          </div>
        ))}
      </div>
    );
  },
}));

function renderWithQuery(ui: React.ReactNode, initialData: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["support", "admin-all", "open-unassigned"], initialData);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AdminAllTicketsGrid — Assign me", () => {
  beforeEach(() => invokeMock.mockReset());

  it("sends assigneeUserId='self' (NOT 0)", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    renderWithQuery(<AdminAllTicketsGrid />, [{ id: 42, status: "active" }]);

    const btn = await screen.findByRole("button", { name: /assign me/i });
    fireEvent.click(btn);

    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const call = invokeMock.mock.calls[0][0];
    expect(call).toMatchObject({ action: "assign", conversationId: 42, assigneeUserId: "self" });
    expect(call.assigneeUserId).not.toBe(0);
  });
});
