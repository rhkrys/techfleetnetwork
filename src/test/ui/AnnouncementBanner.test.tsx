import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import {
  fetchPublishedBanners,
  fetchDismissedBannerIds,
  dismissBanner,
} from "@/services/banner.service";

// AnnouncementBanner was rewritten: it takes no props, fetches published
// banners + the caller's dismissals via banner.service (banner_dismissals
// table), and dismisses through dismissBanner(). The previous test asserted an
// obsolete props-based API storing dismissals in grid_view_states.

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/useUgcTranslation", () => ({
  useUgcTranslation: ({ sourceText }: { sourceText: string }) => ({ text: sourceText }),
}));

vi.mock("@/services/banner.service", () => ({
  fetchPublishedBanners: vi.fn(),
  fetchDismissedBannerIds: vi.fn(),
  dismissBanner: vi.fn(),
}));

const mockFetchPublished = vi.mocked(fetchPublishedBanners);
const mockFetchDismissed = vi.mocked(fetchDismissedBannerIds);
const mockDismiss = vi.mocked(dismissBanner);

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AnnouncementBanner />
    </QueryClientProvider>
  );
}

describe("AnnouncementBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockFetchPublished.mockResolvedValue([
      {
        id: "banner-1",
        title: "Important",
        body_html: "<p>Message</p>",
        reopen_after_dismiss: false,
      } as never,
    ]);
    mockFetchDismissed.mockResolvedValue([]);
    mockDismiss.mockResolvedValue(undefined as never);
  });

  it("renders a published banner and dismisses it via banner.service", async () => {
    renderBanner();

    expect(await screen.findByText("Important")).toBeInTheDocument();

    const button = await screen.findByRole("button", { name: /dismiss important/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(mockDismiss).toHaveBeenCalledWith("banner-1", "user-1");
    });
  });

  it("does not render banners the member has already dismissed", async () => {
    mockFetchDismissed.mockResolvedValue(["banner-1"]);
    renderBanner();

    await waitFor(() => expect(mockFetchDismissed).toHaveBeenCalled());
    expect(screen.queryByText("Important")).not.toBeInTheDocument();
  });
});
