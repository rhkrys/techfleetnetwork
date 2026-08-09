// Covers: src/pages/DiscordOAuthCallbackPage.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";

const { mockComplete, mockFinalize, mockNavigate, mockRefreshProfile, mockAuthState } = vi.hoisted(
  () => ({
    mockComplete: vi.fn(),
    mockFinalize: vi.fn(),
    mockNavigate: vi.fn(),
    mockRefreshProfile: vi.fn(),
    mockAuthState: {
      user: { id: "user-1", user_metadata: { full_name: "Test Member" } },
      profile: { discord_user_id: "", discord_username: "", display_name: "Test Member" },
    },
  })
);

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ ...mockAuthState, refreshProfile: mockRefreshProfile }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/services/discord-notify.service", () => ({
  DiscordNotifyService: { completeDiscordOAuth: mockComplete },
}));

vi.mock("@/lib/discord/finalize-link", () => ({ finalizeDiscordLink: mockFinalize }));

vi.mock("@/lib/discord/oauth-link", () => ({ DISCORD_LINK_RETURN_KEY: "discord_link_return" }));

import DiscordOAuthCallbackPage from "@/pages/DiscordOAuthCallbackPage";

function renderAt(url: string): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <DiscordOAuthCallbackPage />
      </MemoryRouter>
    </QueryClientProvider>
  ) as unknown as ReactElement;
}

const CALLBACK = "/courses/connect-discord/callback";

describe("DiscordOAuthCallbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.user = { id: "user-1", user_metadata: { full_name: "Test Member" } };
    mockFinalize.mockResolvedValue({ communityRoleAssigned: true });
  });

  it("verifies + finalizes on a valid code/state and shows success", async () => {
    mockComplete.mockResolvedValue({
      discord_user_id: "123456789012345678",
      discord_username: "verified",
      avatar: null,
    });

    renderAt(`${CALLBACK}?code=the-code&state=the-state-1234567890`);

    expect(await screen.findByText(/discord account linked/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(mockComplete).toHaveBeenCalledWith("the-code", "the-state-1234567890")
    );
    expect(mockFinalize).toHaveBeenCalledTimes(1);
    expect(mockFinalize).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        discordUserId: "123456789012345678",
        discordUsername: "verified",
      })
    );
  });

  it("does not attempt a bind when the user cancels at Discord", async () => {
    renderAt(`${CALLBACK}?error=access_denied&state=the-state-1234567890`);

    expect(await screen.findByText(/linking was cancelled/i)).toBeInTheDocument();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it("surfaces the server's rejection message on a failed verification", async () => {
    mockComplete.mockRejectedValue(
      new Error("This Discord account is already linked to another Tech Fleet profile.")
    );

    renderAt(`${CALLBACK}?code=the-code&state=the-state-1234567890`);

    expect(
      await screen.findByText(/already linked to another tech fleet profile/i)
    ).toBeInTheDocument();
    expect(mockFinalize).not.toHaveBeenCalled();
  });
});
