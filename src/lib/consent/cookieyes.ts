/**
 * CookieYes reconciliation layer.
 *
 * The CookieYes banner sets a persistent `cookieyes-consent` cookie and
 * exposes `window.getCkyConsent()` once loaded. Because CookieYes fires its
 * one-time `cookieyes_banner_load` event on the SAME page load that injected
 * the script — and because Accept all triggers a full page reload — the
 * banner-only listener misses most returning visitors.
 *
 * This module reads CookieYes's stored state directly so:
 *   - Returning visitors with a stored consent re-initialize Clarity/GA4 on
 *     first page view of a new session (no banner click required).
 *   - Currently-active sessions reconcile on route change / tab focus.
 *
 * Pure read; safe to call repeatedly.
 */

import type { ConsentState } from "./manager";
import { detectGpc } from "./manager";

type CkyCategory =
  | "necessary"
  | "functional"
  | "analytics"
  | "performance"
  | "advertisement"
  | "other";

interface CkyGetResult {
  categories?: Partial<Record<CkyCategory, boolean>>;
  consentID?: string;
}

declare global {
  interface Window {
    getCkyConsent?: () => CkyGetResult;
  }
}

/** Parse the raw `cookieyes-consent` cookie when the JS API isn't loaded yet. */
function parseCookieFallback(): CkyGetResult | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith("cookieyes-consent="));
  if (!raw) return null;
  const value = decodeURIComponent(raw.split("=").slice(1).join("="));
  // CookieYes cookie format: "consentid:XYZ,consent:yes,action:yes,necessary:yes,functional:yes,analytics:yes,performance:yes,advertisement:no,other:no"
  const parts = value.split(",").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split(":");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const cats = (k: CkyCategory) => parts[k] === "yes";
  if (!parts.consentid && parts.consent !== "yes") return null;
  return {
    consentID: parts.consentid,
    categories: {
      necessary: cats("necessary"),
      functional: cats("functional"),
      analytics: cats("analytics"),
      performance: cats("performance"),
      advertisement: cats("advertisement"),
      other: cats("other"),
    },
  };
}

/**
 * Read CookieYes's persisted consent. Prefers the JS API, falls back to the
 * cookie, returns null when neither is available (first-ever visit).
 */
export function readStoredCookieYesConsent(): {
  consentId: string | null;
  categories: Partial<Record<CkyCategory, boolean>>;
} | null {
  if (typeof window === "undefined") return null;
  let result: CkyGetResult | null = null;
  try {
    if (typeof window.getCkyConsent === "function") {
      result = window.getCkyConsent() || null;
    }
  } catch {
    result = null;
  }
  if (!result || !result.categories) {
    result = parseCookieFallback();
  }
  if (!result || !result.categories) return null;
  return {
    consentId: result.consentID ?? null,
    categories: result.categories,
  };
}

/**
 * Translate a stored CookieYes snapshot into our internal ConsentState.
 * Honors GPC (forces analytics + marketing off).
 */
export function ckyToConsentState(
  prev: ConsentState,
  stored: { categories: Partial<Record<CkyCategory, boolean>> },
): ConsentState {
  const c = stored.categories;
  const gpc = detectGpc();
  const analytics = !gpc && Boolean(c.analytics || c.performance);
  const functional = Boolean(c.functional);
  const marketing = !gpc && Boolean(c.advertisement);
  return {
    ...prev,
    functional,
    analytics,
    marketing,
    gpc,
    decidedAt: prev.decidedAt ?? new Date().toISOString(),
  };
}

/**
 * Stable hash of the consent decision so we can dedupe network writes per
 * session without spamming `record-consent` on every SPA route change.
 */
export function consentFingerprint(state: ConsentState): string {
  return [
    state.functional ? "f1" : "f0",
    state.analytics ? "a1" : "a0",
    state.marketing ? "m1" : "m0",
    state.gpc ? "g1" : "g0",
    state.policyVersion,
  ].join("|");
}
