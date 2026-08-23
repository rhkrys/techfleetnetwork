import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * TAL 9000 terminal — power-on boot + LOG history browser.
 * useFleetyChat is mocked so this isolates the terminal UX from Supabase. Reduced-motion is
 * forced so the boot sequence completes instantly (no requestAnimationFrame in the test).
 */
const { loadConversation, loadConversations } = vi.hoisted(() => ({
  loadConversation: vi.fn(),
  loadConversations: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useFleetyAttachment", () => ({
  useFleetyAttachment: () => ({
    attachment: null,
    status: "idle",
    attach: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFleetyChat", () => ({
  useFleetyChat: () => ({
    messages: [],
    isLoading: false,
    error: null,
    conversations: [{ id: "c1", title: "My first chat", updated_at: new Date().toISOString() }],
    sendMessage: vi.fn(),
    loadConversations,
    loadConversation,
    reset: vi.fn(),
  }),
}));

import TalTerminal from "@/features/tal-9000/TalTerminal";

beforeEach(() => {
  // Force reduced-motion so the boot sequence completes synchronously.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TalTerminal — boot + history browser", () => {
  it("starts OFF, powers on to the main screen", async () => {
    render(
      <MemoryRouter>
        <TalTerminal />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /press to power on/i }));
    expect(await screen.findByText("TAL 9000 ONLINE")).toBeInTheDocument();
  });

  it("browses history and loads a selected conversation", async () => {
    render(
      <MemoryRouter>
        <TalTerminal />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /press to power on/i }));
    await screen.findByText("TAL 9000 ONLINE");

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(loadConversations).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "My first chat" }));
    expect(loadConversation).toHaveBeenCalledWith("c1");
  });
});
