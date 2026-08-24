import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DesignSystemProvider } from "@/design-system";
import DesignSystemShowcasePage from "@/pages/DesignSystemShowcasePage";

/**
 * Smoke coverage for the TFDS showcase page (Phase 0). Also satisfies the
 * bdd-gate module-coverage check for src/pages/DesignSystemShowcasePage.tsx.
 * The page has no router/auth dependency, so the DS + theme providers suffice.
 */
function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("DesignSystemShowcasePage", () => {
  it("DSR-001: renders the page heading", () => {
    renderDS(<DesignSystemShowcasePage />);
    expect(screen.getByRole("heading", { name: /Tech Fleet Design System/i })).toBeInTheDocument();
  });

  it("DSR-002: renders every button variant sample", () => {
    renderDS(<DesignSystemShowcasePage />);
    for (const variant of ["hero", "success", "destructive", "outline", "ghost", "link"]) {
      expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
    }
  });

  it("DSR-003: renders the typography and section structure", () => {
    renderDS(<DesignSystemShowcasePage />);
    expect(screen.getByRole("heading", { name: "Typography" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Buttons — variants/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Card" })).toBeInTheDocument();
  });
});
