import { MemoryCache } from "@/lib/memory-cache";

export const APP_CACHE_RESET_VERSION = "2026-05-11-events-tz-and-stale-guard-v1";

const CACHE_RESET_VERSION_KEY = "techfleet.cacheResetVersion";
const CACHE_RESET_RELOAD_KEY = "techfleet.cacheResetReloadedVersion";
const QUERY_CACHE_RESET_PENDING_KEY = "techfleet.queryCacheResetPending";
const SAFE_CACHE_KEY_PATTERNS = [
  /^techfleet\.(?!cacheResetVersion|cacheResetReloadedVersion|queryCacheResetPending)/,
  /^tf-cache:/,
  /^app-cache:/,
  /^workbox-/,
];

function clearSafeStorage(storage: Storage) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && SAFE_CACHE_KEY_PATTERNS.some((pattern) => pattern.test(key)))
      storage.removeItem(key);
  }
}

export async function clearAppCachesForVersion({
  reloadAfterClear = false,
}: { reloadAfterClear?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(CACHE_RESET_VERSION_KEY) === APP_CACHE_RESET_VERSION) return;

  MemoryCache.clear();
  clearSafeStorage(localStorage);
  clearSafeStorage(sessionStorage);

  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }

  // Guard on the VALUE (not `"serviceWorker" in navigator`): the property can be
  // present while undefined (some browsers / graceful-degradation stubs), which
  // made getRegistrations() throw at boot.
  if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function") {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  localStorage.setItem(QUERY_CACHE_RESET_PENDING_KEY, "1");
  localStorage.setItem(CACHE_RESET_VERSION_KEY, APP_CACHE_RESET_VERSION);

  if (
    reloadAfterClear &&
    sessionStorage.getItem(CACHE_RESET_RELOAD_KEY) !== APP_CACHE_RESET_VERSION
  ) {
    sessionStorage.setItem(CACHE_RESET_RELOAD_KEY, APP_CACHE_RESET_VERSION);
    window.location.reload();
  }
}

export function consumeQueryCacheResetPending() {
  if (typeof window === "undefined") return false;
  const pending = localStorage.getItem(QUERY_CACHE_RESET_PENDING_KEY) === "1";
  if (pending) localStorage.removeItem(QUERY_CACHE_RESET_PENDING_KEY);
  return pending;
}
