import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import DashboardPage from "@/pages/DashboardPage";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", user_metadata: { full_name: "Test User" } },
    profile: { first_name: "Test", display_name: "Test User" },
  }),
}));

vi.mock("@/hooks/use-dashboard-preferences", () => ({
  useDashboardPreferences: () => ({
    // useDashboardPreferences always returns arrays (it sanitizes malformed
    // persisted prefs internally — see its own tests); DashboardPage relies on
    // that contract ("Hook guarantees arrays — no runtime guards needed").
    visibleWidgets: ["core_courses"],
    widgetOrder: ["core_courses"],
    isVisible: () => true,
    toggleWidget: vi.fn(),
    reorderWidgets: vi.fn(),
    isNewUser: false,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-journey-progress", () => ({
  useCompletedCount: () => ({ data: 0 }),
}));

vi.mock("@/hooks/use-announcements", () => ({
  useLatestAnnouncements: () => ({ data: [] }),
}));

vi.mock("@/lib/react-query", () => ({
  // renderWithRouter (test-utils) needs QueryClient + QueryClientProvider from
  // this module; the component's data hooks below are mocked separately.
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children?: unknown }) => children,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryFn, enabled = true }: { queryFn?: () => unknown; enabled?: boolean }) => {
    if (!enabled) return { data: undefined };
    return { data: queryFn ? queryFn() : undefined };
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  // Fully-chainable, thenable stub so any supabase.from(...).select().eq()...
  // chain a dashboard widget issues resolves to empty data instead of throwing
  // "…eq is not a function" for this render-without-crashing smoke test.
  // cached-session.ts also subscribes to auth at module load.
  const chain: any = new Proxy(
    {
      then: (resolve: (v: { data: never[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    },
    {
      get: (target, prop) =>
        prop in target ? (target as Record<string, unknown>)[prop as string] : () => chain,
    }
  );
  return {
    supabase: {
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: vi.fn(),
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock("@/services/stats.service", () => ({
  StatsService: { getNetworkStats: vi.fn(async () => ({ badges_earned: 0 })) },
}));

vi.mock("@/components/BadgesDisplay", () => ({
  BadgesDisplay: () => <div>Badges</div>,
}));

vi.mock("@/components/DashboardCustomizer", () => ({
  DashboardCustomizer: () => <button type="button">Customize</button>,
}));

vi.mock("@/components/DiscordInviteBanner", () => ({
  DiscordInviteBanner: () => <div>Discord banner</div>,
}));

vi.mock("@/components/DashboardEmptyState", () => ({
  DashboardEmptyState: () => <div>Empty state</div>,
}));

vi.mock("@/components/SectionEmptyState", () => ({
  SectionEmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/NetworkActivity", () => ({
  NetworkActivity: () => <div>Network Activity</div>,
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the dashboard for a returning member", async () => {
    renderWithRouter(<DashboardPage />);

    // The dashboard renders its personalized header; the old "course completion"
    // section was removed in the redesign (core_courses is now the Observer
    // Course / onboarding section).
    expect(await screen.findByText(/welcome back, test/i)).toBeInTheDocument();
  });
});
