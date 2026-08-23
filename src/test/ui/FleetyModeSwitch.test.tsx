import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FleetyModeSwitch } from "@/components/fleety/FleetyModeSwitch";

/**
 * The Classic ⇄ Future switch is shown on every Classic Fleety surface. Behavioral coverage:
 *  - Classic is marked as the current mode.
 *  - Pressing "Future" launches the TAL 9000 terminal at /tal-9000?mode=future.
 * A regression that breaks the Future entry point (wrong path / missing param) fails CI.
 */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

afterEach(() => cleanup());

describe("FleetyModeSwitch", () => {
  it("marks Classic as the current mode and offers a Future control", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <FleetyModeSwitch />
      </MemoryRouter>
    );
    expect(screen.getByText("Classic")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Future" })).toBeInTheDocument();
  });

  it("navigates to the Future terminal (/tal-9000?mode=future) when Future is pressed", () => {
    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <FleetyModeSwitch />
        <LocationProbe />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "Future" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/tal-9000?mode=future");
  });
});
