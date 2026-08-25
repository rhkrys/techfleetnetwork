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

const { maybeSingle, eqUpdate, rpc, invoke } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  eqUpdate: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: () => ({ eq: eqUpdate }),
    }),
    // Email-rearchitecture: the marketing toggle's displayed value comes from the member's own
    // recorded intent (get_my_marketing_subscription); the live EO status (eo-contact-status) is only
    // a fallback when there is no local intent.
    functions: { invoke },
    rpc,
  },
}));

import NotificationSettingsPage from "@/pages/NotificationSettingsPage";

const MARKETING_SWITCH = "Toggle newsletter and marketing emails";

describe("NotificationSettingsPage (TFDS-migrated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({
      data: { notification_prefs: {}, notify_opportunities: true },
      error: null,
    });
    eqUpdate.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: null, error: null });
    invoke.mockResolvedValue({ data: { status: "not_found" }, error: null });
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

  // Regression for the marketing-toggle persistence bug: the displayed state must follow the member's
  // OWN saved intent (desired_status), not Email Octopus's lagging live state. EO syncs on a ~2-min
  // cron and double opt-in leaves EO 'pending'/'not_found', so reading EO on load made a just-saved
  // toggle snap back to EO's stale value on reload — in BOTH directions.

  // MUI Switch puts aria-label on the root span and `id` on the inner <input type="checkbox">, so we
  // wait for the labelled control, then read the input's checked state by id.
  const marketingChecked = () =>
    document.querySelector<HTMLInputElement>("#pref-marketing")?.checked;

  it("NOTIF-PREFS-002: a saved opt-in stays ON even while EO is still 'not_found' (pre-sync)", async () => {
    rpc.mockResolvedValue({ data: "subscribed", error: null });
    invoke.mockResolvedValue({ data: { status: "not_found" }, error: null });
    renderWithRouter(<NotificationSettingsPage />);
    await screen.findByLabelText(MARKETING_SWITCH);
    expect(marketingChecked()).toBe(true);
  });

  it("NOTIF-PREFS-003: a saved opt-out stays OFF even while EO still says 'subscribed' (pre-sync)", async () => {
    rpc.mockResolvedValue({ data: "unsubscribed", error: null });
    invoke.mockResolvedValue({ data: { status: "subscribed" }, error: null });
    renderWithRouter(<NotificationSettingsPage />);
    await screen.findByLabelText(MARKETING_SWITCH);
    expect(marketingChecked()).toBe(false);
  });

  it("NOTIF-PREFS-004: with no local intent, falls back to EO live state (imported contact shows ON)", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    invoke.mockResolvedValue({ data: { status: "subscribed" }, error: null });
    renderWithRouter(<NotificationSettingsPage />);
    await screen.findByLabelText(MARKETING_SWITCH);
    expect(marketingChecked()).toBe(true);
  });
});
