/**
 * useSyncedTableState — reload-safe state for admin grids.
 *
 * ACTIVITY-LOG-STATE-001 (2026-06-16): admin tables (Activity Log, etc.) keep
 * page index, search text, filter selections, and scroll position in
 * `useState` only, so ANY remount — a browser refresh, an
 * UpdateAvailableBanner "Refresh now" click, an MfaEnforcementGuard redirect,
 * a Suspense re-mount after a chunk retry — destroyed the admin's place.
 *
 * This hook layers two reload-safe stores on top of useState:
 *   1. URL query string (via history.replaceState) — shareable + survives
 *      hard reload, page navigation, and back/forward.
 *   2. sessionStorage["tfn:<key>:state"] — survives reload when the URL is
 *      stripped (e.g. by a fetch-guard recovery redirect).
 *
 * Hydration order on mount: URL → sessionStorage → defaults. Writes go to
 * both, debounced 200 ms, so heavy typing in a search box doesn't thrash
 * the history stack.
 *
 * Scroll position is restored separately by `useSyncedScrollPosition`.
 *
 * Generic-shaped: callers pass a flat `Record<string, string | number>` so
 * URL serialization stays trivial. Non-string values (numbers) round-trip
 * via Number(); empty strings round-trip as "".
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Primitive = string | number;
type StateShape = Record<string, Primitive>;

const STORAGE_PREFIX = "tfn:";
const STATE_SUFFIX = ":state";
const SCROLL_SUFFIX = ":scroll";
const WRITE_DEBOUNCE_MS = 200;

function readFromUrl<T extends StateShape>(defaults: T): Partial<T> {
  if (typeof window === "undefined") return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const out: Partial<T> = {};
    for (const key of Object.keys(defaults)) {
      if (!params.has(key)) continue;
      const raw = params.get(key) ?? "";
      const def = defaults[key];
      (out as Record<string, Primitive>)[key] =
        typeof def === "number" ? (Number.isFinite(Number(raw)) ? Number(raw) : def) : raw;
    }
    return out;
  } catch {
    return {};
  }
}

function readFromSession<T extends StateShape>(key: string, defaults: T): Partial<T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${key}${STATE_SUFFIX}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<T>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function mergeHydration<T extends StateShape>(defaults: T): T {
  return { ...defaults, ...readFromSession(arguments[1] as unknown as string, defaults), ...readFromUrl(defaults) } as T;
}

/**
 * Reload-safe state hook for a small bag of primitives.
 *
 * @param key   stable identifier (e.g. "activity-log"); namespaces the URL +
 *              storage writes for this surface.
 * @param defaults  default values; the SHAPE of this object defines which
 *              keys are persisted (extra URL params are ignored).
 */
export function useSyncedTableState<T extends StateShape>(key: string, defaults: T) {
  const [state, setStateInternal] = useState<T>(() => {
    const fromSession = readFromSession(key, defaults);
    const fromUrl = readFromUrl(defaults);
    return { ...defaults, ...fromSession, ...fromUrl } as T;
  });

  const writeTimer = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const flushWrite = useCallback(() => {
    if (typeof window === "undefined") return;
    const current = stateRef.current;

    // 1. sessionStorage (full snapshot, durable across reload).
    try {
      window.sessionStorage.setItem(
        `${STORAGE_PREFIX}${key}${STATE_SUFFIX}`,
        JSON.stringify(current),
      );
    } catch {
      /* storage unavailable — URL fallback still works */
    }

    // 2. URL (shareable). Only write non-default values to keep URLs tidy.
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      for (const k of Object.keys(defaults)) {
        const v = (current as Record<string, Primitive>)[k];
        const d = (defaults as Record<string, Primitive>)[k];
        // Treat empty string + default-equal values as "absent" in the URL.
        if (v === d || v === "" || v === undefined || v === null) {
          params.delete(k);
        } else {
          params.set(k, String(v));
        }
      }
      const next = `${url.pathname}${params.toString() ? `?${params.toString()}` : ""}${url.hash}`;
      window.history.replaceState(window.history.state, "", next);
    } catch {
      /* non-fatal — sessionStorage covers reload */
    }
  }, [key, defaults]);

  const scheduleWrite = useCallback(() => {
    if (typeof window === "undefined") return;
    if (writeTimer.current) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      writeTimer.current = null;
      flushWrite();
    }, WRITE_DEBOUNCE_MS);
  }, [flushWrite]);

  const setState = useCallback(
    (patch: Partial<T> | ((prev: T) => Partial<T>)) => {
      setStateInternal((prev) => {
        const delta = typeof patch === "function" ? patch(prev) : patch;
        const next = { ...prev, ...delta };
        return next;
      });
      scheduleWrite();
    },
    [scheduleWrite],
  );

  // Flush on hide/unmount so a tab-close or visibility hide can't lose a
  // pending debounced write. This listener never navigates and never calls
  // setState — it only persists, so it's tab-switch-safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // reason: tab-switch-safe — flushes pending debounce on hide; no nav, no setState.
    const onHide = () => {
      if (document.visibilityState === "hidden") flushWrite();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (writeTimer.current) {
        window.clearTimeout(writeTimer.current);
        flushWrite();
      }
    };
  }, [flushWrite]);

  return [state, setState] as const;
}

/**
 * Reload-safe scroll-position restorer. Saves `window.scrollY` on
 * visibilitychange:hidden + beforeunload + unmount, restores on mount.
 *
 * Call once per page; the hook is keyed by the same `key` you pass to
 * `useSyncedTableState` so admins on different grids don't collide.
 */
export function useSyncedScrollPosition(key: string, readyToRestore: boolean) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!readyToRestore) return;
    const storageKey = `${STORAGE_PREFIX}${key}${SCROLL_SUFFIX}`;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        const y = Number(raw);
        if (Number.isFinite(y) && y > 0) {
          // Defer to next frame so AG Grid / Suspense content has a chance to
          // render; otherwise the scroll target doesn't exist yet.
          window.requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: "auto" }));
        }
      }
    } catch {
      /* non-fatal */
    }
  }, [key, readyToRestore]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `${STORAGE_PREFIX}${key}${SCROLL_SUFFIX}`;
    const save = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(window.scrollY));
      } catch {
        /* non-fatal */
      }
    };
    // reason: tab-switch-safe — persists scrollY only; no nav, no setState, no reload.
    const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
    const onBeforeUnload = () => save();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      save();
    };
  }, [key]);
}

// Silence lint for the unused mergeHydration helper — kept as a doc example
// for future call sites that prefer eager hydration over the in-hook merge.
void mergeHydration;
