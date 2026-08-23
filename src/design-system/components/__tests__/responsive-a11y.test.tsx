import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  Grid,
  Container,
  Stack,
  Field,
  createAppTheme,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("4px grid theme", () => {
  it("theme.spacing steps in 4px units", () => {
    const theme = createAppTheme("light");
    expect(theme.spacing(1)).toBe("4px");
    expect(theme.spacing(6)).toBe("24px");
  });

  it("exposes the standard 12-column responsive breakpoints", () => {
    const theme = createAppTheme("light");
    expect(theme.breakpoints.values).toMatchObject({ xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 });
  });
});

describe("Layout components", () => {
  it("Grid/Container/Stack render their children responsively", () => {
    renderDS(
      <Container>
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              cell
            </Stack>
          </Grid>
        </Grid>
      </Container>
    );
    expect(screen.getByText("cell")).toBeInTheDocument();
  });
});

describe("Field accessibility", () => {
  it("links the error to the control via aria-describedby and announces it (role=alert)", () => {
    renderDS(
      <Field label="Email" htmlFor="e" error="Enter a valid email">
        <input id="e" aria-label="Email" />
      </Field>
    );
    const input = screen.getByLabelText("Email");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid email");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("marks required with text, not color alone", () => {
    renderDS(
      <Field label="Name" htmlFor="n" required>
        <input id="n" aria-label="Name" />
      </Field>
    );
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });
});
