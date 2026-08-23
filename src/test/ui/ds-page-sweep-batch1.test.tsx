import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";

/**
 * Smoke coverage for the first design-system page-sweep batch — CookiesPage,
 * PrivacyPage, AccessDeniedPage — migrated from @/components/ui to @/design-system.
 *
 * bdd-gate module coverage (the gate greps changed file paths in src/test/e2e):
 *   src/pages/CookiesPage.tsx
 *   src/pages/PrivacyPage.tsx
 *   src/pages/AccessDeniedPage.tsx
 */
vi.mock("@/hooks/usePolicy", () => ({
  usePolicy: () => ({ data: { body_md: "# Policy body" } }),
}));
vi.mock("@/components/CookieConsentBanner", () => ({ openCookieSettings: vi.fn() }));
vi.mock("@/lib/consent/manager", () => ({
  loadConsent: () => ({ functional: true, analytics: false, marketing: false, gpc: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));

import CookiesPage from "@/pages/CookiesPage";
import PrivacyPage from "@/pages/PrivacyPage";
import AccessDeniedPage from "@/pages/AccessDeniedPage";

describe("CookiesPage (TFDS-migrated)", () => {
  it("renders the heading and the DS link-button", () => {
    renderWithRouter(<CookiesPage />);
    expect(screen.getByRole("heading", { name: "Cookie Policy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Cookie Settings/i })).toBeInTheDocument();
  });
});

describe("PrivacyPage (TFDS-migrated)", () => {
  it("renders the rights center with DS buttons that are links", () => {
    renderWithRouter(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
    // The action buttons are now DS <Button component={Link}> → rendered as links.
    expect(screen.getAllByRole("link", { name: "Open" }).length).toBeGreaterThan(0);
  });
});

describe("AccessDeniedPage (TFDS-migrated)", () => {
  it("renders the message and DS link-buttons", () => {
    renderWithRouter(<AccessDeniedPage />);
    expect(screen.getByRole("heading", { name: /permission to open/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Contact support/i })).toBeInTheDocument();
  });
});
