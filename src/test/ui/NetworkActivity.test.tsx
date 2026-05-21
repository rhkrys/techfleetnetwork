import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";

const { mockGetNetworkStats } = vi.hoisted(() => ({
  mockGetNetworkStats: vi.fn(),
}));

vi.mock("@/services/stats.service", () => ({
  StatsService: { getNetworkStats: mockGetNetworkStats, getCachedNetworkStats: vi.fn(() => null) },
}));

import { NetworkActivity } from "@/components/NetworkActivity";

describe("NetworkActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows real aggregate stats when the public stats request succeeds", async () => {
    mockGetNetworkStats.mockResolvedValue({
      total_signups: 190,
      course_completions_total: 111,
      core_courses_active: 49,
      onboarding_courses_active: 62,
      discord_links_count: 0,
      beginner_courses_active: 0,
      advanced_courses_active: 0,
      applications_completed: 10,
      badges_earned: 122,
      prev_week_start: "2026-04-22",
      prev_week_end: "2026-04-28",
      prev_week_signups: 71,
      prev_week_course_completions_total: 111,
      prev_week_core_active: 49,
      prev_week_onboarding_active: 62,
      prev_week_discord_links_count: 0,
      prev_week_beginner_active: 0,
      prev_week_advanced_active: 0,
      prev_week_applications: 11,
      prev_week_badges: 122,
      projects_open_applications: 1,
      projects_coming_soon: 3,
      projects_live: 0,
      projects_previously_completed: 120,
    });

    renderWithRouter(<NetworkActivity showMap={false} />);

    expect(await screen.findByText("190")).toBeInTheDocument();
    expect(screen.getAllByText("Course Completions")).toHaveLength(2);
    expect(screen.queryByText("Core Course Completions")).not.toBeInTheDocument();
    expect(screen.getAllByText("49 core · 62 onboarding")).toHaveLength(2);
    expect(screen.getAllByText("111")).toHaveLength(2);
    expect(screen.getAllByText("122")).toHaveLength(2);
    expect(screen.getByText("120")).toBeInTheDocument();

    fireEvent.focus(screen.getAllByRole("button", { name: "Badges Earned details" })[0]);
    expect(await screen.findAllByText("One badge per course completion, application submission, and Discord link.")).not.toHaveLength(0);
  });

  it("shows an unavailable state instead of rendering every stat as zero when stats fail", async () => {
    mockGetNetworkStats.mockRejectedValue(new Error("permission denied for function get_network_stats"));

    renderWithRouter(<NetworkActivity showMap={false} />);

    expect(await screen.findByText(/could not load community activity/i)).toBeInTheDocument();
    expect(screen.queryByText("All Time")).not.toBeInTheDocument();
    expect(screen.queryByText("Project Training")).not.toBeInTheDocument();
  });
});
