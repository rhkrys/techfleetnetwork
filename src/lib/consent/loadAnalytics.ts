/**
 * Consent-gated analytics loaders. NOTHING in this file may run unless the
 * user has consented to the relevant category. Imports outside
 * src/lib/consent/ are blocked by ESLint.
 */

import type { ConsentState } from "./manager";

const GA4_ID = "G-WYQKEKXSRR";
const CLARITY_ID = "we82xfqcup";

let ga4Loaded = false;
let clarityLoaded = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

function ensureGtagStub() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
  }
}

function loadGa4() {
  if (ga4Loaded || typeof document === "undefined") return;
  ga4Loaded = true;
  ensureGtagStub();
  // Consent Mode v2 — denied by default; we update below
  window.gtag!("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    functionality_storage: "denied",
    personalization_storage: "denied",
    security_storage: "granted",
    wait_for_update: 500,
  });
  window.gtag!("js", new Date());
  window.gtag!("config", GA4_ID, { send_page_view: false, anonymize_ip: true });
  const s = document.createElement("script");
  s.async = true;
  // crossorigin="anonymous" lets the browser surface real stack frames from
  // GTM/GA scripts to window.onerror instead of the opaque "Script error.".
  s.crossOrigin = "anonymous";
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(s);
}

function loadClarity() {
  if (clarityLoaded || typeof document === "undefined") return;
  clarityLoaded = true;
  (function (c: Record<string, unknown>, l: Document, a: string, r: string, i: string) {
    const fn: { (...args: unknown[]): void; q?: unknown[] } = function (...args: unknown[]) {
      (fn.q = fn.q || []).push(args);
    };
    c[a] = c[a] || fn;
    const t = l.createElement(r) as HTMLScriptElement;
    t.async = true;
    // crossorigin="anonymous" → real Clarity stack frames reach our reporter
    // instead of an opaque cross-origin "Script error.".
    t.crossOrigin = "anonymous";
    t.src = "https://www.clarity.ms/tag/" + i;
    const y = l.getElementsByTagName(r)[0];
    y.parentNode!.insertBefore(t, y);
  })(window as unknown as Record<string, unknown>, document, "clarity", "script", CLARITY_ID);
}

/**
 * Apply the current consent state to all loaded trackers. Safe to call
 * repeatedly; each loader is idempotent. Driven by CookieYes events via
 * src/components/CookieConsentBanner.tsx.
 */
export function applyConsent(state: ConsentState) {
  ensureGtagStub();
  // GPC always wins, regardless of what CookieYes reported.
  if (state.analytics && !state.gpc) {
    loadGa4();
    loadClarity();
    window.gtag?.("consent", "update", {
      analytics_storage: "granted",
      functionality_storage: state.functional ? "granted" : "denied",
      personalization_storage: state.functional ? "granted" : "denied",
      ad_storage: state.marketing ? "granted" : "denied",
      ad_user_data: state.marketing ? "granted" : "denied",
      ad_personalization: state.marketing ? "granted" : "denied",
    });
    window.clarity?.("consent", true);
    // Microsoft Clarity Consent Mode v2 — required for reliable session
    // recording on returning visitors. We send both signals for compatibility.
    window.clarity?.("consentv2", {
      ad_Storage: state.marketing ? "granted" : "denied",
      analytics_Storage: "granted",
    });
  } else {
    window.gtag?.("consent", "update", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    window.clarity?.("consent", false);
    window.clarity?.("consentv2", {
      ad_Storage: "denied",
      analytics_Storage: "denied",
    });
  }
}

export function trackPageView(path: string) {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "page_view", { page_path: path });
}
