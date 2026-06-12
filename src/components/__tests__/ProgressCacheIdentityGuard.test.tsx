/**
 * JOURNEY-IDENTITY-002: ProgressCacheIdentityGuard must drop progress caches
 * the instant `auth.user.id` changes, so a stale empty result from a prior
 * identity never sticks around to mask the new identity's true progress.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProgressCacheIdentityGuard } from "@/components/ProgressCacheIdentityGuard";

const authState: { user: { id: string } | null } = { user: null };
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: authState.user }),
}));

function makeClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["journey-progress", "old-user", "first_steps"], [{ task_id: "x", completed: true }]);
  qc.setQueryData(["journey-completed", "old-user", "first_steps", "__all__"], 5);
  qc.setQueryData(["quest-all-journey-progress", "old-user"], { count: 5 });
  qc.setQueryData(["course_completions", "old-user"], [{ course_key: "onboarding" }]);
  qc.setQueryData(["unrelated", "old-user"], "keep me");
  return qc;
}

function Harness({ qc }: { qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <ProgressCacheIdentityGuard />
    </QueryClientProvider>
  );
}

describe("ProgressCacheIdentityGuard (JOURNEY-IDENTITY-002)", () => {
  beforeEach(() => {
    authState.user = null;
  });

  it("removes every progress cache entry when auth identity changes", () => {
    const qc = makeClient();
    authState.user = { id: "old-user" };
    const { rerender } = render(<Harness qc={qc} />);

    // First mount records "old-user" without purging — no transition yet.
    expect(qc.getQueryData(["journey-progress", "old-user", "first_steps"])).toBeTruthy();

    // Identity transition.
    authState.user = { id: "new-user" };
    rerender(<Harness qc={qc} />);

    expect(qc.getQueryData(["journey-progress", "old-user", "first_steps"])).toBeUndefined();
    expect(qc.getQueryData(["journey-completed", "old-user", "first_steps", "__all__"])).toBeUndefined();
    expect(qc.getQueryData(["quest-all-journey-progress", "old-user"])).toBeUndefined();
    expect(qc.getQueryData(["course_completions", "old-user"])).toBeUndefined();
    // Non-progress caches are untouched.
    expect(qc.getQueryData(["unrelated", "old-user"])).toBe("keep me");
  });

  it("does not purge on first mount (no prior identity)", () => {
    const qc = makeClient();
    authState.user = { id: "fresh-user" };
    render(<Harness qc={qc} />);
    expect(qc.getQueryData(["journey-progress", "old-user", "first_steps"])).toBeTruthy();
  });
});
