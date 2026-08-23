import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * TAL 9000 terminal — LOG history browser (v1 fast-follow).
 * useFleetyChat is mocked so this isolates the terminal's log UX from Supabase.
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TalTerminal — LOG history browser", () => {
  it("opens the log and loads the selected conversation", () => {
    render(
      <MemoryRouter>
        <TalTerminal />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(loadConversations).toHaveBeenCalled();

    const row = screen.getByRole("button", { name: "My first chat" });
    fireEvent.click(row);
    expect(loadConversation).toHaveBeenCalledWith("c1");
  });
});
