/**
 * Deploy watcher — detects new deployments while a tab is open and exposes
 * a `stale` signal that the UI surfaces via <UpdateAvailableBanner/>.
 *
 * IMPORTANT: this module never auto-reloads the page. Silent reloads (even
 * on hidden tabs) destroy in-flight UI state — scroll position, modal
 * state, un-autosaved input, expanded panels — and surprise the member
 * when they return to the tab. The only reloads happen when:
 *   1. The member clicks "Refresh now" in the banner (reloadIfStale()).
 *   2. lazyWithRetry catches an actual stale-chunk error on a route load.
 */

declare const __BUILD_ID__: string;

const VERSION_URL = "/version.json";
const POLL_INTERVAL_MS = 60_000; // 1 minute
const RELOAD_FLAG = "__lovable_chunk_reload__";

let currentBuildId = "";
let serverBuildId = "";
let pollTimer: number | null = null;
let started = false;
let stale = false;
const listeners = new Set<(stale: boolean) => void>();

function readCurrentBuildId(): string {
  try {
    return typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "";
  } catch {
    return "";
  }
}

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { buildId?: string };
    return typeof json.buildId === "string" ? json.buildId : null;
  } catch {
    return null;
  }
}

function notify() {
  for (const cb of listeners) {
    try {
      cb(stale);
    } catch {
      /* ignore listener errors */
    }
  }
}

function safeReload() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

async function checkVersion() {
  if (!currentBuildId) return;
  const next = await fetchServerBuildId();
  if (!next) return;
  serverBuildId = next;
  if (next !== currentBuildId && !stale) {
    stale = true;
    notify();
    // No auto-reload. The banner asks the member to refresh on their terms.
  }
}

/**
 * Start the watcher. Idempotent — safe to call multiple times.
 */
export function startDeployWatcher(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  currentBuildId = readCurrentBuildId();
  if (!currentBuildId) return; // no build id available (dev mode) — skip

  window.setTimeout(() => {
    void checkVersion();
  }, 5_000);

  pollTimer = window.setInterval(() => {
    void checkVersion();
  }, POLL_INTERVAL_MS);

  window.addEventListener("focus", () => void checkVersion());
  window.addEventListener("online", () => void checkVersion());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkVersion();
  });
}

/**
 * Subscribe to staleness changes. Returns an unsubscribe fn.
 */
export function onDeployStale(cb: (stale: boolean) => void): () => void {
  listeners.add(cb);
  cb(stale);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Returns true once the server has shipped a newer build than this tab.
 */
export function isAppStale(): boolean {
  return stale;
}

/**
 * Reload now if the app is stale. Only invoked by explicit member action
 * (Refresh now button in <UpdateAvailableBanner/>).
 */
export function reloadIfStale(): boolean {
  if (stale) {
    safeReload();
    return true;
  }
  return false;
}

/**
 * Trigger an out-of-band version check immediately. Used by the error
 * reporter when a symptom suggests a stale bundle so the banner can
 * appear without waiting for the 60s poll cycle.
 *
 * Throttled so spammy callers cannot DoS /version.json.
 */
let lastForcedCheckAt = 0;
const FORCED_CHECK_MIN_INTERVAL_MS = 10_000;
export function checkNow(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastForcedCheckAt < FORCED_CHECK_MIN_INTERVAL_MS) return;
  lastForcedCheckAt = now;
  void checkVersion();
}

/** Internal helper for tests/debug. */
export function __debug() {
  return { currentBuildId, serverBuildId, stale, pollTimer };
}
