// Resilient React.lazy wrapper — Part 1 §1.5 of the comprehensive refactor.
//
// Retries chunk loads up to 3 times (250 / 500 / 1000 ms) before giving up.
// On exhaustion we throw — the caller's <ScopedErrorBoundary> shows the
// global <UpdateAvailableBanner/> instead of triggering an auto-reload
// (memory: No Auto-Reload On Deploy).
//
// Use this in place of React.lazy() everywhere. Enforced by the
// `lazy/requires-retry` ESLint rule.

import { ComponentType, lazy, LazyExoticComponent } from "react";

const DELAYS_MS = [250, 500, 1000];

function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "ChunkLoadError") return true;
  const msg = String(e.message ?? "");
  return (
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= DELAYS_MS.length; attempt += 1) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (!isChunkLoadError(err) || attempt === DELAYS_MS.length) break;
        await sleep(DELAYS_MS[attempt]);
      }
    }
    // Surface a stale-deploy signal for the global UpdateAvailableBanner
    // to pick up without forcing a reload.
    try {
      window.dispatchEvent(new CustomEvent("app:chunk-load-failed"));
    } catch {
      /* SSR / non-DOM context */
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("Failed to load module after retries");
  });
}

export default lazyWithRetry;
