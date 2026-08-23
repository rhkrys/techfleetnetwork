import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DesignSystemProvider, Button } from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Button asChild (Radix-slot compat)", () => {
  it("renders AS the child anchor with button styling, not a button wrapping it", () => {
    renderDS(
      <Button asChild variant="hero">
        <a href="/x">Go</a>
      </Button>
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/x");
    // The migration bug this guards: asChild must NOT produce a <button> wrapping
    // the <a> (invalid nested interactive elements).
    expect(link.querySelector("button")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // Button styling still applied (MUI root class on the rendered anchor).
    expect(link.className).toMatch(/MuiButton-root/);
  });
});
