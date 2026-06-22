/**
 * React Query localStorage persister.
 *
 * Why: without this the dashboard (and every other persisted screen) starts
 * from an empty in-memory cache on every hard reload, which renders the
 * "brand-new user" state for ~300–2000 ms before the network catches up
 * (DASHBOARD-HYDRATE-001..003).
 *
 * Safety rails:
 * - Only queries that opt-in via `meta: { persist: true }` are dehydrated.
 *   Sensitive things (auth, MFA, admin grace, role grants, triage) stay
 *   memory-only.
 * - Query keys are already user-scoped (e.g. ["dashboard-overview", userId]),
 *   so the cache cannot serve user A's row to user B.
 * - On SIGNED_OUT the AuthContext calls `queryClient.clear()` AND
 *   `persister.removeClient()` to wipe the on-disk snapshot.
 * - `buster` is tied to APP_CACHE_RESET_VERSION so deploys that change
 *   shapes invalidate the cache automatically.
 */
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";
import type { Query } from "@tanstack/react-query";
import { APP_CACHE_RESET_VERSION } from "@/lib/app-cache-reset";

export const PERSISTER_KEY = "tfn:rq-cache:v1";
export const PERSISTER_BUSTER = APP_CACHE_RESET_VERSION;

function safeStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const k = "__tfn_persist_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function shouldPersistQuery(query: Pick<Query, "meta" | "state">): boolean {
  if (query.meta?.persist !== true) return false;
  if (query.state.status !== "success") return false;
  return true;
}

let cached: Persister | undefined;

export function getQueryPersister(): Persister | undefined {
  if (cached) return cached;
  const storage = safeStorage();
  if (!storage) return undefined;
  cached = createSyncStoragePersister({
    storage,
    key: PERSISTER_KEY,
    throttleTime: 1000,
  });
  return cached;
}

export async function purgePersistedCache(): Promise<void> {
  const p = getQueryPersister();
  if (!p) return;
  try {
    await p.removeClient();
  } catch {
    /* non-fatal */
  }
}
