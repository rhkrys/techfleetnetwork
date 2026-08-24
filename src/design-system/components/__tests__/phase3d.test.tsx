import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  SaveStatus,
  ValidatedField,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  Button,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("SaveStatus (molecule)", () => {
  it("announces saved state via a status live region", () => {
    renderDS(<SaveStatus state="saved" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved");
    expect(status).toHaveAttribute("translate", "no");
  });

  it("offers Retry on error", async () => {
    const onRetry = vi.fn();
    renderDS(<SaveStatus state="error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ValidatedField (molecule)", () => {
  it("renders label + error via the accessible Field", () => {
    renderDS(
      <ValidatedField id="x" label="Name" error="Required">
        <input id="x" aria-label="Name" />
      </ValidatedField>
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});

describe("HoverCard (molecule)", () => {
  it("reveals content on hover", async () => {
    renderDS(
      <HoverCard>
        <HoverCardTrigger>
          <Button>Profile</Button>
        </HoverCardTrigger>
        <HoverCardContent>Card details</HoverCardContent>
      </HoverCard>
    );
    expect(screen.queryByText("Card details")).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole("button", { name: "Profile" }));
    expect(screen.getByText("Card details")).toBeInTheDocument();
  });
});
