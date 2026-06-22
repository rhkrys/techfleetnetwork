/**
 * Closes Phase 3 gap: prove that N components mounting `useMfaGate` in the
 * same tick fan out to exactly ONE call of MfaService.getMfaGateDecision —
 * the regression that produced the GoTrue Web Locks AbortError storm on
 * 2026-06-22.
 *
 * BDD: AUTH-MFA-GATE-DEDUPE-001
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getMfaGateDecision = vi.fn();

vi.mock("@/services/mfa.service", () => ({
  MfaService: { getMfaGateDecision: (...a: unknown[]) => getMfaGateDecision(...a) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-abc" } }),
}));

import { useMfaGate } from "@/hooks/use-mfa-gate";

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useMfaGate — single-flight dedupe (AUTH-MFA-GATE-DEDUPE-001)", () => {
  beforeEach(() => {
    getMfaGateDecision.mockReset();
    getMfaGateDecision.mockResolvedValue({ required: false, gracePeriod: false });
  });

  it("N concurrent mounts produce exactly ONE RPC call", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = wrapper(client);

    // 5 components mount the same hook in the same tick
    const a = renderHook(() => useMfaGate(), { wrapper: w });
    const b = renderHook(() => useMfaGate(), { wrapper: w });
    const c = renderHook(() => useMfaGate(), { wrapper: w });
    const d = renderHook(() => useMfaGate(), { wrapper: w });
    const e = renderHook(() => useMfaGate(), { wrapper: w });

    await waitFor(() => {
      expect(a.result.current.isSuccess).toBe(true);
      expect(e.result.current.isSuccess).toBe(true);
    });

    expect(getMfaGateDecision).toHaveBeenCalledTimes(1);
    [a, b, c, d, e].forEach((h) => h.unmount());
  });

  it("re-mount within staleTime does NOT re-fetch", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = wrapper(client);

    const first = renderHook(() => useMfaGate(), { wrapper: w });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useMfaGate(), { wrapper: w });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(getMfaGateDecision).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});
