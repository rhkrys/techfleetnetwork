import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import DashboardPage from "@/pages/DashboardPage";

const overviewState = vi.hoisted(() => ({
  data: undefined as
    | undefined
    | {
        phase_counts: Record<string, number>;
        general_application: null;
        project_applications: never[];
      },
}));

const completedCounts = vi.hoisted(() => ({
  connect: undefined as number | undefined,
  firstSteps: undefined as number | undefined,
  observer: undefined as number | undefined,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", user_metadata: { full_name: "Test User" } },
    profile: { first_name: "Test", display_name: "Test User", discord_user_id: null },
  }),
}));

vi.mock("@/hooks/use-admin", () => ({
  useAdmin: () => ({ isAdmin: false, loading: false }),
}));

vi.mock("@/hooks/use-dashboard-preferences", () => ({
  useDashboardPreferences: () => ({
    visibleWidgets: ["core_courses"],
    widgetOrder: ["core_courses"],
    isVisible: (id: string) => id === "core_courses",
    toggleWidget: vi.fn(),
    reorderWidgets: vi.fn(),
    isNewUser: false,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-dashboard-overview", () => ({
  useDashboardOverview: () => ({ data: overviewState.data }),
}));

vi.mock("@/hooks/use-journey-progress", () => ({
  useCompletedCount: (_userId: string, _phase: string, taskIds?: readonly string[]) => {
    if (taskIds?.includes("connect-discord")) return { data: completedCounts.connect };
    if (taskIds?.includes("profile")) return { data: completedCounts.firstSteps };
    return { data: completedCounts.observer };
  },
}));

vi.mock("@/hooks/use-announcements", () => ({
  useLatestAnnouncements: () => ({ data: [] }),
}));

vi.mock("@/components/DashboardCustomizer", () => ({
  DashboardCustomizer: () => <button type="button">Customize dashboard</button>,
}));

vi.mock("@/components/DiscordInviteBanner", () => ({
  DiscordInviteBanner: () => null,
}));

vi.mock("@/components/ResumeApplicationBanner", () => ({
  ResumeApplicationBanner: () => null,
}));

vi.mock("@/components/WelcomeDialog", () => ({
  WelcomeDialog: () => null,
}));

vi.mock("@/services/stats.service", () => ({
  StatsService: { getNetworkStats: vi.fn(async () => ({ badges_earned: 0 })) },
}));

describe("Dashboard hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewState.data = undefined;
    completedCounts.connect = undefined;
    completedCounts.firstSteps = undefined;
    completedCounts.observer = undefined;
  });

  it("renders the progress skeleton when no snapshot has hydrated yet", () => {
    renderWithRouter(<DashboardPage />);

    expect(screen.getByLabelText(/loading your progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 5 complete/i)).not.toBeInTheDocument();
  });

  it("renders hydrated last-known checklist progress without the zero-state flash", () => {
    overviewState.data = {
      phase_counts: {
        second_steps: 0,
        discord_learning: 0,
        third_steps: 0,
        project_training: 0,
        volunteer: 0,
      },
      general_application: null,
      project_applications: [],
    };
    completedCounts.connect = 1;
    completedCounts.firstSteps = 8;
    completedCounts.observer = 0;

    renderWithRouter(<DashboardPage />);

    expect(screen.queryByLabelText(/loading your progress/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2 of 5 complete/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 5 complete/i)).not.toBeInTheDocument();
  });
});