/**
 * Persister allow-list + smoke (DASHBOARD-HYDRATE-001..003).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { shouldPersistQuery, getQueryPersister, purgePersistedCache, PERSISTER_KEY } from "@/lib/query/persister";

function makeQuery(meta: Record<string, unknown> | undefined, status: "success" | "pending" | "error") {
  return { meta, state: { status } } as Parameters<typeof shouldPersistQuery>[0];
}

describe("query persister allow-list", () => {
  it("opts in only when meta.persist === true AND the query has resolved", () => {
    expect(shouldPersistQuery(makeQuery({ persist: true }, "success"))).toBe(true);
    expect(shouldPersistQuery(makeQuery({ persist: true }, "pending"))).toBe(false);
    expect(shouldPersistQuery(makeQuery({ persist: true }, "error"))).toBe(false);
    expect(shouldPersistQuery(makeQuery({ persist: false }, "success"))).toBe(false);
    expect(shouldPersistQuery(makeQuery({}, "success"))).toBe(false);
    expect(shouldPersistQuery(makeQuery(undefined, "success"))).toBe(false);
  });
});

describe("persister storage lifecycle", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("purgePersistedCache removes the on-disk snapshot key", async () => {
    const persister = getQueryPersister();
    expect(persister).toBeDefined();
    window.localStorage.setItem(PERSISTER_KEY, JSON.stringify({ buster: "x", timestamp: Date.now(), clientState: {} }));
    expect(window.localStorage.getItem(PERSISTER_KEY)).not.toBeNull();
    await purgePersistedCache();
    expect(window.localStorage.getItem(PERSISTER_KEY)).toBeNull();
  });
});
