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
 * - The localStorage key is namespaced by the active auth user so one member's
 *   snapshot is never hydrated into another member's session.
 * - On SIGNED_OUT the AuthContext calls `queryClient.clear()` AND
 *   `persister.removeClient()` to wipe the on-disk snapshot.
 * - `buster` is tied to APP_CACHE_RESET_VERSION so deploys that change
 *   shapes invalidate the cache automatically.
 */
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { PersistedClient, Persister } from "@tanstack/query-persist-client-core";
import type { Query } from "@tanstack/react-query";
import { APP_CACHE_RESET_VERSION } from "@/lib/app-cache-reset";

export const PERSISTER_KEY_PREFIX = "tfn:rq-cache:v1";
function getBuildCacheBuster(): string {
  try {
    return typeof __BUILD_ID__ !== "undefined" && __BUILD_ID__ ? __BUILD_ID__ : "dev";
  } catch {
    return "dev";
  }
}

export const PERSISTER_BUSTER = `${APP_CACHE_RESET_VERSION}:${getBuildCacheBuster()}`;
export const ANONYMOUS_PERSISTER_SCOPE = "anonymous";

export function getPersisterKeyForUser(userId: string | null | undefined): string {
  const scope = userId && userId.trim().length > 0 ? userId : ANONYMOUS_PERSISTER_SCOPE;
  return `${PERSISTER_KEY_PREFIX}:${scope}`;
}

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

function readInitialUserIdFromAuthStorage(storage: Storage | undefined): string | null {
  if (!storage) return null;
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { user?: { id?: unknown }; currentSession?: { user?: { id?: unknown } } };
      const userId = parsed.user?.id ?? parsed.currentSession?.user?.id;
      if (typeof userId === "string" && userId.length > 0) return userId;
    }
  } catch {
    return null;
  }
  return null;
}

let activeUserId: string | null = readInitialUserIdFromAuthStorage(safeStorage());
let cachedKey: string | undefined;
let cachedInner: Persister | undefined;
let cachedDynamic: Persister | undefined;
let suppressNextPersistWrites = false;

function getInnerPersister(): Persister | undefined {
  const storage = safeStorage();
  if (!storage) return undefined;
  const key = getPersisterKeyForUser(activeUserId);
  if (cachedInner && cachedKey === key) return cachedInner;
  cachedKey = key;
  cachedInner = createSyncStoragePersister({ storage, key, throttleTime: 1000 });
  return cachedInner;
}

export function setActiveQueryPersisterUser(userId: string | null | undefined): boolean {
  const next = userId ?? null;
  if (next === activeUserId) return false;
  activeUserId = next;
  cachedKey = undefined;
  cachedInner = undefined;
  return true;
}

export function getActiveQueryPersisterKey(): string {
  return getPersisterKeyForUser(activeUserId);
}

export function runWithoutPersistingQueryCache<T>(fn: () => T): T {
  const previous = suppressNextPersistWrites;
  suppressNextPersistWrites = true;
  try {
    return fn();
  } finally {
    suppressNextPersistWrites = previous;
  }
}

export function getQueryPersister(): Persister | undefined {
  if (cachedDynamic) return cachedDynamic;
  if (!safeStorage()) return undefined;
  cachedDynamic = {
    persistClient: (client: PersistedClient) => {
      if (suppressNextPersistWrites) return;
      return getInnerPersister()?.persistClient(client);
    },
    restoreClient: () => getInnerPersister()?.restoreClient(),
    removeClient: () => getInnerPersister()?.removeClient(),
  };
  return cachedDynamic;
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
