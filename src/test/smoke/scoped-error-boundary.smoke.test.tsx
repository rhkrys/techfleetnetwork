import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScopedErrorBoundary } from "@/components/ScopedErrorBoundary";

function Boom({ msg }: { msg: string }): JSX.Element {
  throw new Error(msg);
}

describe("ScopedErrorBoundary (smoke)", () => {
  it("UI-BOUNDARY-001: catches child crash, logs real error, shows fallback, siblings survive", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <ScopedErrorBoundary label="Get Help">
          <Boom msg="freescout payload malformed" />
        </ScopedErrorBoundary>
        <p>sibling-alive</p>
      </div>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Get Help hit a snag/i)).toBeTruthy();
    expect(screen.getByText("sibling-alive")).toBeTruthy();
    const logged = spy.mock.calls.flat().some(
      (a) => typeof a === "object" && a !== null && (a as Error).message === "freescout payload malformed",
    );
    expect(logged).toBe(true);
    spy.mockRestore();
  });

  it("UI-BOUNDARY-002: Try again resets state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Maybe() {
      if (shouldThrow) throw new Error("data grid blew up");
      return <span>recovered</span>;
    }
    render(
      <ScopedErrorBoundary label="Data grid">
        <Maybe />
      </ScopedErrorBoundary>,
    );
    expect(screen.getByText(/Data grid hit a snag/i)).toBeTruthy();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered")).toBeTruthy();
    spy.mockRestore();
  });
});
