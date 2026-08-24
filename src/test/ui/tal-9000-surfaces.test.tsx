import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";

/**
 * Behavioral coverage for the two Classic Fleety surfaces this PR changes:
 *   - src/pages/ResourcesPage.tsx — the Fleety "Guidance" tab is removed.
 *   - src/pages/ChatPage.tsx      — the Classic/Future mode switch is added.
 */

// --- ResourcesPage deps: stub the tab bodies + data loaders so the page renders fast. ---
vi.mock("@/components/resources/ExploreTab", () => ({ default: () => <div>explore-body</div> }));
vi.mock("@/components/resources/SkillsPracticesTab", () => ({
  default: () => <div>skills-body</div>,
}));
vi.mock("@/data/handbooks", () => ({
  fetchHandbooks: () => Promise.resolve([]),
  handbookCategoryColors: {},
}));
vi.mock("@/data/workshops", () => ({
  fetchWorkshops: () => Promise.resolve([]),
  workshopCategoryColors: {},
}));

// --- ChatPage deps: logged-in user, empty conversation list, idle attachment. ---
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "t@example.com" } }),
}));
vi.mock("@/hooks/useFleetyAttachment", () => ({
  useFleetyAttachment: () => ({
    attachment: null,
    status: "idle",
    error: null,
    attach: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.order = () => Promise.resolve({ data: [], error: null });
    q.insert = () => q;
    q.update = () => q;
    q.single = () => Promise.resolve({ data: null, error: null });
    return q;
  };
  return {
    supabase: {
      from: () => makeQuery(),
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      },
    },
  };
});

import ResourcesPage from "@/pages/ResourcesPage";
import ChatPage from "@/pages/ChatPage";

// jsdom has no Web Speech API; ChatPage's unmount cleanup calls speechSynthesis.cancel().
vi.stubGlobal("speechSynthesis", { cancel: () => {}, speak: () => {} });

afterEach(() => cleanup());

describe("ResourcesPage — Fleety removed", () => {
  it("no longer shows the Fleety Guidance tab", async () => {
    renderWithRouter(<ResourcesPage />);
    // Explore is the new default tab; wait for the async data load to finish.
    expect(await screen.findByText("Explore")).toBeInTheDocument();
    expect(screen.queryByText("Guidance")).not.toBeInTheDocument();
  });
});

describe("ChatPage — Classic/Future switch", () => {
  it("renders the Future mode switch", async () => {
    renderWithRouter(<ChatPage />);
    expect(await screen.findByRole("button", { name: "Future" })).toBeInTheDocument();
  });
});
