// Coverage for src/pages/admin/HandoffAdminPage.tsx — the admin surface that lets an admin open
// the Hand-Off Center for any project. Kept light: the real produce/gate behavior is covered by the
// edge-function + pgTAP suites; this asserts the page module loads and the picker renders.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";

// The panel pulls in the whole hand-off stack; stub it — this page's job is just project selection.
vi.mock("@/components/HandoffPanel", () => ({ HandoffPanel: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
    }),
  },
}));

import HandoffAdminPage from "@/pages/admin/HandoffAdminPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HandoffAdminPage />
    </QueryClientProvider>
  );
}

describe("HandoffAdminPage", () => {
  it("renders the admin hand-off surface with a project picker", () => {
    renderPage();
    expect(screen.getByText(/Hand-Off Production/i)).toBeInTheDocument();
    expect(screen.getByText(/Select a project above/i)).toBeInTheDocument();
  });
});
