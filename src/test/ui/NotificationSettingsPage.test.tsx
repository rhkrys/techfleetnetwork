import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";

/**
 * Smoke coverage for NotificationSettingsPage after its migration from
 * @/components/ui to @/design-system (TFDS first page migration). Also satisfies
 * the bdd-gate module-coverage check for src/pages/NotificationSettingsPage.tsx.
 */
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "test-user-id" } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { maybeSingle, eqUpdate } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  eqUpdate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: () => ({ eq: eqUpdate }),
    }),
  },
}));

import NotificationSettingsPage from "@/pages/NotificationSettingsPage";

describe("NotificationSettingsPage (TFDS-migrated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: { notification_prefs: {} }, error: null });
    eqUpdate.mockResolvedValue({ error: null });
  });

  it("NOTIF-PREFS-001: renders heading, kinds, and toggles once prefs load", async () => {
    renderWithRouter(<NotificationSettingsPage />);
    expect(
      await screen.findByRole("heading", { name: /Notification preferences/i })
    ).toBeInTheDocument();
    // A notification kind label from the design-system <Label> renders.
    expect(await screen.findByText("Announcements")).toBeInTheDocument();
    // The design-system <Switch> renders with its accessible label.
    expect(screen.getByLabelText("Toggle Announcements")).toBeInTheDocument();
  });
});
