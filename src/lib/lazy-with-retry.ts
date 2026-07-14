import { lazy, type ComponentType } from "react";
import { report } from "@/lib/observability/report";

/**
 * Wraps React.lazy with multi-stage recovery from stale-chunk errors that occur
 * after a redeploy invalidates previously cached JS chunk hashes.
 *
 * Recovery stages (in order):
 *  1. Transient retry: re-run the import factory with a short backoff in case
 *     the failure was a flaky network blip or CDN propagation race.
 *  2. Hard reload: if retries also fail with a chunk-load error, force a single
 *     full-page reload (tracked via sessionStorage) so the browser fetches the
 *     latest deploy manifest.
 *  3. Re-throw: any non-chunk error or a second failure after reload bubbles
 *     up to ErrorBoundary for normal handling.
 *
 * Combined with the proactive deploy-watcher (src/lib/deploy-watcher.ts),
 * stale-chunk errors should virtually never surface to a user.
 */

const RELOAD_FLAG = "__lovable_chunk_reload__";
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_DELAY_MS = [400, 1200] as const;

/**
 * Single source of truth for "is this a stale-bundle / chunk-load failure?"
 * Used by lazyWithRetry, ErrorBoundary, and the global window error reporter
 * so all three paths classify identically.
 */
export function isChunkLoadMessage(msg: string): boolean {
  if (!msg) return false;
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("Unable to preload CSS") ||
    // Stale chunk 404 → the SPA server returns index.html (text/html) in place
    // of the missing JS chunk. Browsers surface this as a MIME-type / module-
    // script load failure, NOT a network error, so it must classify as a
    // chunk-load failure here too — otherwise it crashes the route as a generic
    // ui_render_error instead of triggering the one-shot reload. Observed on
    // /login after deploys: "'text/html' is not a valid JavaScript MIME type".
    msg.includes("is not a valid JavaScript MIME type") ||
    msg.includes("Expected a JavaScript module script") ||
    msg.includes("Failed to load module script") ||
    // Firefox / Safari wording variants — same root cause (stale chunk URL
    // 404s after a new deploy invalidated the previous hash). Matching by
    // structure (NetworkError + a JS asset URL) keeps us future-proof.
    /NetworkError.*(dynamically imported module|\/assets\/.+\.js)/i.test(msg) ||
    /TypeError:\s*Failed to fetch.*\/assets\/.+\.(js|css)(\?|$)/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  );
}

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return isChunkLoadMessage(error.message || "") || /ChunkLoadError/i.test(error.name);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      try {
        const mod = await factory();
        // Successful load — clear the one-shot reload flag so a future
        // stale-chunk on the same tab can recover via reload again.
        // Without this, a single recovery reload "uses up" the budget for
        // the entire tab lifetime, and the next failed chunk bubbles to
        // ErrorBoundary even though a reload would fix it.
        if (typeof window !== "undefined") {
          try {
            window.sessionStorage.removeItem(RELOAD_FLAG);
          } catch {
            /* ignore */
          }
        }
        return mod;
      } catch (error) {
        lastError = error;
        if (!isChunkLoadError(error)) throw error;
        if (attempt < MAX_TRANSIENT_RETRIES) {
          await sleep(RETRY_DELAY_MS[attempt] ?? 1000);
          continue;
        }
      }
    }

    // All retries exhausted — fall back to a one-time hard reload.
    // Stale-chunk errors are routed to a dedicated `chunk_stale` event_type
    // that the DB trigger keeps OUT of agent_fix_queue (defense-in-depth).
    // We still report once so System Health can graph deploy churn.
    report(lastError ?? new Error("ChunkLoadError"), {
      source: "lazy-with-retry",
      eventType: "chunk_stale",
      severity: "info",
    });
    if (typeof window !== "undefined") {
      const alreadyReloaded = window.sessionStorage.getItem(RELOAD_FLAG);
      if (!alreadyReloaded) {
        window.sessionStorage.setItem(RELOAD_FLAG, "1");
        // Cache-bust the reload — append a query param so the browser
        // bypasses any intermediate cache and fetches the latest index.html.
        const url = new URL(window.location.href);
        url.searchParams.set("__r", Date.now().toString(36));
        window.location.replace(url.toString());
        // Return a placeholder component so React doesn't error before reload.
        return { default: (() => null) as unknown as T };
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to load module after retries");
  });
}

/** Call after a successful navigation to allow future stale-chunk recoveries. */
export function clearChunkReloadFlag() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  }
}
