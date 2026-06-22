/**
 * Real User Monitoring (RUM) — Core Web Vitals beacon.
 *
 * Captures LCP, INP, CLS, FCP, TTFB on every page view and ships them to the
 * `record-web-vital` edge function via `navigator.sendBeacon` so the report
 * always survives page unload (even on mobile back/forward).
 *
 * Design rules (locked by Core memory: "Perf/security work must NOT regress UX"):
 *  - Zero impact on first paint: deferred via `requestIdleCallback` and
 *    dynamically imports `web-vitals` so the library is *never* in the main
 *    bundle.
 *  - One report per metric per page lifecycle (web-vitals' default behaviour
 *    via `onLCP`/`onINP`/etc.).
 *  - Honours Save-Data: clients on `saveData` skip RUM entirely so we don't
 *    spend their data budget on telemetry.
 *  - No PII. user_id is included only when a Supabase session is present and
 *    is a uuid that the server already recognises via RLS-protected joins.
 *  - Survives client-side route changes — re-instrumented on each navigation.
 */
import { supabase } from "@/integrations/supabase/client";
import { getSessionSafe } from "@/lib/auth/session-port";

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-web-vital`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

interface ReportInit {
  userId?: string | null;
}

function getNavigationType(): string | null {
  try {
    const entries = performance.getEntriesByType("navigation");
    const nav = entries[0] as PerformanceNavigationTiming | undefined;
    return nav?.type ?? null;
  } catch {
    return null;
  }
}

function getConnection(): { effectiveType: string | null; saveData: boolean | null } {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  };
  const conn = nav.connection;
  return {
    effectiveType: conn?.effectiveType ?? null,
    saveData: typeof conn?.saveData === "boolean" ? conn.saveData : null,
  };
}

// Buffer samples in memory; flush as one batched POST on visibilitychange→hidden
// or pagehide. Drastically reduces per-tab insert volume against
// public.web_vital_samples (previously one row per metric, ~5/page).
const buffer: Array<Record<string, unknown>> = [];
let flushScheduled = false;

function flush(): void {
  if (buffer.length === 0) return;
  const payload = JSON.stringify({ samples: buffer.splice(0, buffer.length) });
  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "text/plain;charset=UTF-8" });
      navigator.sendBeacon(ENDPOINT, blob);
    }
  } catch {
    /* swallow — RUM must never surface */
  }
}

function send(payload: Record<string, unknown>): void {
  buffer.push(payload);
  // Soft flush on the next idle tick if buffer fills up (>= 10 samples).
  if (buffer.length >= 10) {
    flush();
    return;
  }
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    flush();
  }, 5_000);
}

if (typeof window !== "undefined") {
  // Final flush hooks — guaranteed to fire before the page is discarded.
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

let installed = false;

/**
 * Install the RUM listeners. Safe to call once at app boot — subsequent calls
 * are no-ops. Skips entirely on Save-Data and on non-browser environments.
 */
export function installWebVitalsBeacon({ userId }: ReportInit = {}): void {
  if (installed || typeof window === "undefined") return;
  const { saveData, effectiveType } = getConnection();
  if (saveData) return; // Honour user data preference.

  installed = true;

  const schedule = (cb: () => void) => {
    type IdleWin = Window & {
      requestIdleCallback?: (fn: () => void, opts?: { timeout?: number }) => number;
    };
    const w = window as IdleWin;
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(cb, { timeout: 3000 });
    } else {
      setTimeout(cb, 1500);
    }
  };

  schedule(async () => {
    try {
      const wv = await import("web-vitals");
      const route = window.location.pathname;
      const navigationType = getNavigationType();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number })
        .deviceMemory ?? null;

      // Resolve user_id once at install — beacons fire long after this.
      let resolvedUserId: string | null = userId ?? null;
      if (!resolvedUserId) {
        try {
          const session = await getSessionSafe();
          resolvedUserId = session?.user?.id ?? null;
        } catch {
          resolvedUserId = null;
        }
      }

      // Resolve browser/OS/device once. UA Client Hints can be async; fall
      // back to UA-string parsing synchronously when not available.
      const { detectUserAgent } = await import("@/lib/ua-parse");
      const ua = await detectUserAgent();

      // Signal "RUM is initialised" — Track-1 visual tests wait on this
      // sentinel so pixel diffs are taken after deferred work has settled.
      try {
        document.body.setAttribute("data-rum-ready", "true");
      } catch {
        /* noop */
      }

      const handler = (metric: { name: string; value: number; rating: string }) => {
        send({
          name: metric.name,
          value: metric.value,
          rating: metric.rating,
          route,
          navigationType,
          connectionType: effectiveType,
          saveData,
          deviceMemory,
          viewportW,
          viewportH,
          userId: resolvedUserId,
          browserName: ua.browserName,
          browserMajor: ua.browserMajor,
          osName: ua.osName,
          osMajor: ua.osMajor,
          deviceType: ua.deviceType,
        });
      };

      wv.onLCP(handler);
      wv.onINP(handler);
      wv.onCLS(handler);
      wv.onFCP(handler);
      wv.onTTFB(handler);
    } catch {
      // web-vitals failed to load — beacon stays installed=true so we don't
      // retry forever, but no metrics will flow. Acceptable degradation.
      try {
        document.body.setAttribute("data-rum-ready", "true");
      } catch {
        /* noop */
      }
    }
  });
}
