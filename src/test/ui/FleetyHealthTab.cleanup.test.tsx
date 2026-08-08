import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * FLEETY-008 — Lovable-era admin tabs removed (PRD D-14/15/16).
 * Proves the deletion behaviorally: the Proposed relationships, Drafts, and
 * Prompt Versions tabs are gone, while the retained surfaces still render.
 *
 * The supabase client is stubbed with a Proxy that satisfies ANY query chain
 * (.select().gte().order().limit(), count heads, .or().lte()…) by returning
 * itself and resolving to an empty result — so load() completes without wiring
 * every chain shape by hand.
 */
vi.mock("@/integrations/supabase/client", () => {
  const makeChain = () => {
    const result = Promise.resolve({ data: [], count: 0, error: null });
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return result.then.bind(result);
        if (prop === "catch") return result.catch.bind(result);
        if (prop === "finally") return result.finally.bind(result);
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  };
  return {
    supabase: {
      from: () => makeChain(),
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

vi.mock("@/lib/auth/session-port", () => ({
  getUserSafe: () => Promise.resolve(null),
}));

// Isolate the tab set under test — the child panels fetch their own data.
vi.mock("@/components/admin/FleetyPlaybooksManager", () => ({
  FleetyPlaybooksManager: () => null,
}));
vi.mock("@/components/admin/FleetyCostPanel", () => ({
  FleetyCostPanel: () => null,
}));

import { FleetyHealthTab } from "@/components/admin/FleetyHealthTab";

describe("FleetyHealthTab — Lovable tab cleanup (D-14/15/16)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FLEETY-008: removed tabs are absent; retained tabs render", async () => {
    render(<FleetyHealthTab />);

    // load() resolves → the tab list renders
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Cost$/ })).toBeTruthy());

    // Retained surfaces
    expect(screen.getByRole("tab", { name: /^Recent$/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Practical Content/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /\+ Canned Answer/ })).toBeTruthy();

    // Removed Lovable-era tabs
    expect(screen.queryByRole("tab", { name: /Proposed/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Prompt Versions/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^Drafts/ })).toBeNull();
  });
});
