import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * /tal-9000 opens Fleety in Classic chat by default; ?mode=future switches to the CRT terminal.
 * ChatPage and TalTerminal are mocked so this isolates the mode-routing decision (no Supabase /
 * streaming / heavy deps). A regression that flips the default or ignores the param fails CI.
 * Module under test: src/pages/TAL9000Page.tsx
 */
vi.mock("@/pages/ChatPage", () => ({
  default: () => <div data-testid="classic-chat">CLASSIC</div>,
}));
vi.mock("@/features/tal-9000/TalTerminal", () => ({
  default: () => <div data-testid="future-terminal">FUTURE</div>,
}));

import TAL9000Page from "@/pages/TAL9000Page";

afterEach(() => cleanup());

describe("TAL9000Page mode routing", () => {
  it("renders Classic Fleety chat by default", () => {
    render(
      <MemoryRouter initialEntries={["/tal-9000"]}>
        <TAL9000Page />
      </MemoryRouter>
    );
    expect(screen.getByTestId("classic-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("future-terminal")).not.toBeInTheDocument();
  });

  it("renders the Future CRT terminal when ?mode=future", () => {
    render(
      <MemoryRouter initialEntries={["/tal-9000?mode=future"]}>
        <TAL9000Page />
      </MemoryRouter>
    );
    expect(screen.getByTestId("future-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("classic-chat")).not.toBeInTheDocument();
  });
});
