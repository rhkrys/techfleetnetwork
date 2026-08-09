// Covers: src/services/discord-notify.service.ts (OAuth link methods) via ProfileDiscordConnector
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithRouter } from "./test-utils";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockBeginOAuth, mockRefreshProfile, mockAuthState } = vi.hoisted(() => ({
  mockBeginOAuth: vi.fn(),
  mockRefreshProfile: vi.fn(),
  mockAuthState: {
    user: { id: "user-1", user_metadata: { full_name: "Test Member" } },
    profile: { discord_user_id: "", discord_username: "", display_name: "Test Member" },
    profileLoaded: true,
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ ...mockAuthState, refreshProfile: mockRefreshProfile }),
}));

vi.mock("@/hooks/use-journey-progress", () => ({
  useJourneyProgress: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

// The Discord OAuth kickoff is the unit under test's collaborator: assert the
// connector delegates to it (and never binds an identity itself).
vi.mock("@/lib/discord/oauth-link", () => ({
  DISCORD_LINK_RETURN_KEY: "discord_link_return",
  beginDiscordOAuth: mockBeginOAuth,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ConnectDiscordPage from "@/pages/ConnectDiscordPage";

describe("ConnectDiscordPage — OAuth ownership-proof linking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.user = { id: "user-1", user_metadata: { full_name: "Test Member" } };
    mockAuthState.profile = {
      discord_user_id: "",
      discord_username: "",
      display_name: "Test Member",
    };
    mockAuthState.profileLoaded = true;
  });

  it("starts the Discord OAuth flow when the member chooses to verify", async () => {
    const user = userEvent.setup();
    mockBeginOAuth.mockImplementation(() => new Promise(() => {})); // never resolves (browser would navigate away)

    renderWithRouter(<ConnectDiscordPage />);

    await user.click(screen.getByRole("button", { name: /yes, i'm in discord/i }));
    await user.click(screen.getByRole("button", { name: /continue with discord/i }));

    await waitFor(() => expect(mockBeginOAuth).toHaveBeenCalledTimes(1));
    // While redirecting, the button reflects the in-flight state.
    expect(
      await screen.findByRole("button", { name: /redirecting to discord/i })
    ).toBeInTheDocument();
  });

  it("surfaces a clear error and stays put when linking can't start", async () => {
    const user = userEvent.setup();
    mockBeginOAuth.mockRejectedValue(
      new Error("Discord linking isn't configured yet. Please contact an admin.")
    );

    renderWithRouter(<ConnectDiscordPage />);

    await user.click(screen.getByRole("button", { name: /yes, i'm in discord/i }));
    await user.click(screen.getByRole("button", { name: /continue with discord/i }));

    expect(await screen.findByText(/discord linking isn't configured yet/i)).toBeInTheDocument();
    // Button is re-enabled so the member can retry.
    expect(screen.getByRole("button", { name: /continue with discord/i })).toBeEnabled();
  });

  it("shows the verified/linked state without offering the bind UI", async () => {
    mockAuthState.profile = {
      discord_user_id: "123456789012345678",
      discord_username: "linkedmember",
      display_name: "Test Member",
    };

    renderWithRouter(<ConnectDiscordPage />);

    expect(await screen.findByText(/@linkedmember/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-link a different account/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with discord/i })
    ).not.toBeInTheDocument();
  });
});
