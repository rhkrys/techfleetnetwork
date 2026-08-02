import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";
import { AppLayout } from "@/components/AppLayout";
import { ThemeProvider } from "@/components/ThemeProvider";

// Mock auth context to logged-out state
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    loading: false,
    profileLoaded: true,
    signOut: vi.fn(),
  }),
}));

function renderLayout() {
  return renderWithRouter(
    <ThemeProvider defaultTheme="dark">
      <AppLayout>
        <div data-testid="child">Content</div>
      </AppLayout>
    </ThemeProvider>
  );
}

describe("AppLayout / Navigation UI (BDD 22.1–22.4)", () => {
  beforeEach(() => {
    renderLayout();
  });

  it("22.1: renders Tech Fleet logo", () => {
    const logos = screen.getAllByAltText(/tech fleet/i);
    expect(logos.length).toBeGreaterThan(0);
  });

  it("22.1: renders theme toggle", () => {
    expect(screen.getByLabelText(/toggle theme/i)).toBeInTheDocument();
  });

  it("22.2: Connect button visible when logged out", () => {
    expect(screen.getByText("Connect")).toBeInTheDocument();
  });

  it("22.3: footer renders copyright text", () => {
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(`© ${year}`))).toBeInTheDocument();
  });

  it("22.3: footer has techfleet.org link", () => {
    expect(screen.getByRole("link", { name: "techfleet.org" })).toHaveAttribute(
      "href",
      "https://techfleet.org"
    );
  });

  it("22.3: footer has external techfleet.org link", () => {
    const websiteLinks = screen.getAllByRole("link", { name: "techfleet.org" });
    expect(websiteLinks.some((l) => l.getAttribute("href") === "https://techfleet.org")).toBe(true);
  });

  it("22.4: skip to main content link exists", () => {
    expect(screen.getByText(/skip to main content/i)).toBeInTheDocument();
  });

  it("renders children in main area", () => {
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
