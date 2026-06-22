/**
 * Persister allow-list + smoke (DASHBOARD-HYDRATE-001..003).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldPersistQuery,
  getQueryPersister,
  purgePersistedCache,
  getPersisterKeyForUser,
  getActiveQueryPersisterKey,
  runWithoutPersistingQueryCache,
  setActiveQueryPersisterUser,
  PERSISTER_KEY_PREFIX,
} from "@/lib/query/persister";

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
    setActiveQueryPersisterUser(null);
  });

  it("namespaces snapshots per user so switching users cannot read the old key", async () => {
    const userAKey = getPersisterKeyForUser("user-a");
    const userBKey = getPersisterKeyForUser("user-b");

    expect(userAKey).toBe(`${PERSISTER_KEY_PREFIX}:user-a`);
    expect(userBKey).toBe(`${PERSISTER_KEY_PREFIX}:user-b`);

    setActiveQueryPersisterUser("user-a");
    expect(getActiveQueryPersisterKey()).toBe(userAKey);
    window.localStorage.setItem(userAKey, JSON.stringify({ buster: "x", timestamp: Date.now(), clientState: {} }));

    setActiveQueryPersisterUser("user-b");
    expect(getActiveQueryPersisterKey()).toBe(userBKey);
    expect(window.localStorage.getItem(userBKey)).toBeNull();
    expect(window.localStorage.getItem(userAKey)).not.toBeNull();
  });

  it("purgePersistedCache removes only the active user's on-disk snapshot key", async () => {
    const persister = getQueryPersister();
    expect(persister).toBeDefined();

    const userAKey = getPersisterKeyForUser("user-a");
    const userBKey = getPersisterKeyForUser("user-b");
    setActiveQueryPersisterUser("user-a");
    window.localStorage.setItem(userAKey, JSON.stringify({ buster: "x", timestamp: Date.now(), clientState: {} }));
    window.localStorage.setItem(userBKey, JSON.stringify({ buster: "x", timestamp: Date.now(), clientState: {} }));

    await purgePersistedCache();
    expect(window.localStorage.getItem(userAKey)).toBeNull();
    expect(window.localStorage.getItem(userBKey)).not.toBeNull();
  });

  it("can suppress one cache clear so user switching does not overwrite the next user's snapshot", async () => {
    const persister = getQueryPersister();
    expect(persister).toBeDefined();
    setActiveQueryPersisterUser("user-b");
    const userBKey = getPersisterKeyForUser("user-b");
    const snapshot = { buster: "x", timestamp: Date.now(), clientState: { queries: [{ queryKey: ["dashboard-overview", "user-b"] }] } };
    window.localStorage.setItem(userBKey, JSON.stringify(snapshot));

    runWithoutPersistingQueryCache(() => {
      void persister?.persistClient({ buster: "x", timestamp: Date.now(), clientState: { queries: [] } });
    });

    expect(JSON.parse(window.localStorage.getItem(userBKey) ?? "{}")).toEqual(snapshot);
  });
});
