import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";
import { ThemeProvider } from "@/components/ThemeProvider";
import { renderWithRouter } from "../ui/test-utils";
import PublicCoursesPage from "@/pages/public/PublicCoursesPage";
import PublicCourseDetailPage from "@/pages/public/PublicCourseDetailPage";

// The public catalog must render with NO auth context mounted. These specs
// deliberately do NOT wrap in AuthProvider or mock useAuth: if either page ever
// starts calling useAuth(), these tests fail — which is the point.

const COURSE = {
  id: "k1",
  slug: "ux-foundations",
  title: "UX Foundations",
  summary: "Learn the basics of user experience.",
  description: "<p>Long description</p>",
  track: "basic_training",
  hero_image_url: null,
  outcomes: ["Run a usability test"],
  skills: ["Research"],
  prerequisites: ["None"],
  published_at: "2026-01-01T00:00:00Z",
  cohorts: [
    {
      id: "c1",
      label: "Spring 2026",
      start_date: "2026-03-01",
      end_date: "2026-04-30",
      timezone: "America/New_York",
      registration_url: "https://techfleet.gumroad.com/l/course",
    },
  ],
};

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});


/**
 * The detail page reads `:slug` from the route, so it must be mounted on a real
 * route rather than a bare MemoryRouter — otherwise useParams() is empty and the
 * page correctly renders its not-found state.
 */
function renderDetailAtSlug(slug = "ux-foundations") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <ThemeProvider defaultTheme="dark">
          <MemoryRouter initialEntries={[`/classes/${slug}`]}>
            <Routes>
              <Route path="/classes/:slug" element={<PublicCourseDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </HelmetProvider>
    </QueryClientProvider>,
  );
}

describe("PublicCoursesPage (anonymous catalog)", () => {
  it("renders courses without any auth context mounted", async () => {
    mockFetchOnce({ version: 1, generated_at: "", count: 1, classes: [COURSE] });
    renderWithRouter(<PublicCoursesPage />);
    expect(await screen.findByText("UX Foundations")).toBeInTheDocument();
    expect(screen.getByText(/Learn the basics/)).toBeInTheDocument();
  });

  it("calls the public edge function, not a table", async () => {
    mockFetchOnce({ version: 1, generated_at: "", count: 1, classes: [COURSE] });
    renderWithRouter(<PublicCoursesPage />);
    await screen.findByText("UX Foundations");
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/functions/v1/public-classes");
    expect(url).not.toContain("/rest/v1/");
  });

  it("shows an empty state when nothing is published", async () => {
    mockFetchOnce({ version: 1, generated_at: "", count: 0, classes: [] });
    renderWithRouter(<PublicCoursesPage />);
    expect(await screen.findByText(/No courses are open for enrollment/i)).toBeInTheDocument();
  });

  it("shows a recoverable error state when the endpoint fails", async () => {
    mockFetchOnce({ error: "boom" }, 500);
    renderWithRouter(<PublicCoursesPage />);
    expect(await screen.findByText(/couldn't load the courses/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("PublicCourseDetailPage (anonymous detail)", () => {
  it("renders the enroll link with safe rel attributes", async () => {
    mockFetchOnce({ version: 1, generated_at: "", count: 1, classes: [COURSE] });
    renderDetailAtSlug();
    const link = await screen.findByRole("link", { name: /enroll on gumroad/i });
    expect(link).toHaveAttribute("href", "https://techfleet.gumroad.com/l/course");
    expect(link).toHaveAttribute("target", "_blank");
    // Without noopener the destination can reach back via window.opener.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hides enrollment when the serializer dropped a non-allowlisted link", async () => {
    mockFetchOnce({
      version: 1,
      generated_at: "",
      count: 1,
      classes: [{ ...COURSE, cohorts: [{ ...COURSE.cohorts[0], registration_url: null }] }],
    });
    renderDetailAtSlug();
    expect(await screen.findByText(/isn't open yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /enroll on gumroad/i })).not.toBeInTheDocument();
  });

  it("shows a not-found state for an unpublished or unknown slug", async () => {
    mockFetchOnce({ error: "Not found" }, 404);
    renderDetailAtSlug();
    expect(await screen.findByText(/course not found/i)).toBeInTheDocument();
  });

  it("never renders the member discount link", async () => {
    mockFetchOnce({ version: 1, generated_at: "", count: 1, classes: [COURSE] });
    const { container } = renderDetailAtSlug();
    await screen.findByRole("link", { name: /enroll on gumroad/i });
    expect(container.innerHTML).not.toContain("tfmember");
  });
});
