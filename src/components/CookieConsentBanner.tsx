/**
 * CookieYes integration shim.
 *
 * The visible cookie banner is rendered by CookieYes (script tag injected
 * below). This component renders no UI of its own; it exists to:
 *   1. Reconcile CookieYes's STORED consent (cookie + `getCkyConsent()` API)
 *      on every mount, route change, and tab-visibility return. This is the
 *      retroactive path: returning visitors who accepted on a prior session,
 *      and currently-active visitors whose banner event was missed, will have
 *      Clarity + GA4 initialized without needing to re-interact with the
 *      banner.
 *   2. Listen for live CookieYes events on BOTH `document` and `window`
 *      (CookieYes fires on `document` in newer builds).
 *   3. Translate CookieYes categories → our internal ConsentState.
 *   4. Forward to `applyConsent()` so GA4 / Clarity load only after the user
 *      grants analytics consent (and never when GPC is on).
 *   5. Best-effort POST to the `record-consent` edge function so we keep an
 *      auditable, server-side consent log (GDPR Art. 7(1) requires we can
 *      *prove* consent). Deduped per session by consent fingerprint.
 *   6. Expose `openCookieSettings()` so footer / policy pages can re-open the
 *      preferences modal via CookieYes's `revisitCkyConsent()` API.
 *
 * If CookieYes is blocked (ad-blocker, network failure) we still honour GPC,
 * fall back to our own `tfn.consent.v1` localStorage state, and never load
 * analytics without consent — fail-closed.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { applyConsent } from "@/lib/consent/loadAnalytics";
import {
  bootstrapConsent,
  saveConsent,
  getAnonId,
  detectGpc,
  type ConsentState,
} from "@/lib/consent/manager";
import {
  readStoredCookieYesConsent,
  ckyToConsentState,
  consentFingerprint,
} from "@/lib/consent/cookieyes";

type CkyCategory =
  "necessary" | "functional" | "analytics" | "performance" | "advertisement" | "other";

interface CkyConsentDetail {
  accepted?: CkyCategory[];
  rejected?: CkyCategory[];
  isUserActionCompleted?: boolean;
}

declare global {
  interface Window {
    revisitCkyConsent?: () => void;
  }
}

// Active CookieYes site ID. The prior site (d4f48648…) was paused, which left
// its CDN script.js loading but inert — no banner, no getCkyConsent() API — so
// analytics consent could never be granted. This is the reactivated site.
const COOKIEYES_SRC =
  "https://cdn-cookieyes.com/client_data/99ff3106dea7a5721edfab1d3c457cd7/script.js";
const DEDUP_KEY = "tfn.consent.fp.v1";

function loadCookieYesScript() {
  if (typeof document === "undefined") return;
  if (document.getElementById("cookieyes")) return;

  const script = document.createElement("script");
  script.id = "cookieyes";
  script.type = "text/javascript";
  script.src = COOKIEYES_SRC;
  script.async = true;
  script.defer = true;
  // crossorigin="anonymous" so CookieYes errors carry a real stack trace
  // instead of the opaque cross-origin "Script error." our reporter has
  // to drop wholesale.
  script.crossOrigin = "anonymous";
  script.onerror = () => {
    // eslint-disable-next-line no-console
    console.warn("[consent] CookieYes failed to load — analytics remain disabled");
  };
  document.head.appendChild(script);
}

export function openCookieSettings() {
  if (typeof window === "undefined") return;
  if (typeof window.revisitCkyConsent === "function") {
    window.revisitCkyConsent();
  } else {
    // eslint-disable-next-line no-console
    console.warn("[consent] CookieYes not available — opening fallback /cookies page");
    window.location.assign("/cookies");
  }
}

function fromCkyDetail(detail: CkyConsentDetail, prev: ConsentState): ConsentState {
  const accepted = new Set(detail.accepted ?? []);
  const gpc = detectGpc();
  const analytics = !gpc && (accepted.has("analytics") || accepted.has("performance"));
  const functional = accepted.has("functional");
  const marketing = !gpc && accepted.has("advertisement");
  return {
    ...prev,
    functional,
    analytics,
    marketing,
    gpc,
    decidedAt: new Date().toISOString(),
  };
}

function persist(state: ConsentState, source: "cookieyes" | "gpc" | "reconcile" | "backfill") {
  saveConsent(state);
  applyConsent(state);
  // Dedupe network writes by fingerprint so SPA route changes don't spam rows.
  try {
    const fp = consentFingerprint(state);
    const prev = sessionStorage.getItem(DEDUP_KEY);
    if (prev === fp) return;
    sessionStorage.setItem(DEDUP_KEY, fp);
  } catch {
    /* private mode */
  }
  try {
    void supabase.functions.invoke("record-consent", {
      body: {
        anon_id: getAnonId(),
        categories: {
          strictly_necessary: true,
          functional: state.functional,
          analytics: state.analytics,
          marketing: state.marketing,
        },
        gpc_signal: state.gpc,
        policy_version: state.policyVersion,
        source,
      },
    });
  } catch {
    /* offline ok */
  }
}

/**
 * Reconcile against CookieYes's STORED consent. Idempotent; safe to call on
 * mount, route change, visibility return, and after the CookieYes script
 * finally loads. This is the retroactive recovery path.
 */
function reconcileFromCookieYes(
  prev: ConsentState,
  source: "reconcile" | "backfill" = "reconcile"
) {
  const stored = readStoredCookieYesConsent();
  if (!stored) return;
  const next = ckyToConsentState(prev, stored);
  persist(next, source);
}

export function CookieConsentBanner() {
  const location = useLocation();

  useEffect(() => {
    // 1. Bootstrap with stored consent (or safe defaults). GPC applied
    //    immediately so analytics never fire pre-event even if CookieYes is slow.
    const initial = bootstrapConsent(null);
    applyConsent(initial);
    if (initial.gpc && (initial.analytics || initial.marketing)) {
      persist({ ...initial, analytics: false, marketing: false }, "gpc");
    }

    // 2. Inject CookieYes (async).
    window.setTimeout(loadCookieYesScript, 0);

    // 3. Immediate reconcile in case CookieYes cookie already exists from a
    //    prior session (the retroactive recovery for returning visitors).
    reconcileFromCookieYes(initial, "backfill");

    // 4. Poll briefly for the JS API to come online, then reconcile again
    //    (handles the case where the cookie hasn't been written yet but the
    //    API will report a stored state).
    let attempts = 0;
    const apiPoll = window.setInterval(() => {
      attempts += 1;
      if (typeof window.getCkyConsent === "function") {
        reconcileFromCookieYes(initial, "reconcile");
        window.clearInterval(apiPoll);
      } else if (attempts > 20) {
        window.clearInterval(apiPoll);
      }
    }, 500);

    // 5. Live CookieYes events — on BOTH document and window because
    //    CookieYes builds differ.
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<CkyConsentDetail>).detail || {};
      const next = fromCkyDetail(detail, initial);
      persist(next, "cookieyes");
    };
    const evNames = [
      "cookieyes_consent_update",
      "cookieyes_banner_load",
      "cookieyes_banner_loaded",
    ];
    evNames.forEach((n) => {
      window.addEventListener(n, onConsent as EventListener);
      document.addEventListener(n, onConsent as EventListener);
    });

    // 6. Tab focus return → reconcile (in case consent changed in another tab).
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        reconcileFromCookieYes(initial, "reconcile");
      }
    };
    // reason: tab-switch-safe — reconciles cookie-consent state on tab return; never reloads or redirects.
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(apiPoll);
      evNames.forEach((n) => {
        window.removeEventListener(n, onConsent as EventListener);
        document.removeEventListener(n, onConsent as EventListener);
      });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // 7. SPA route changes — re-reconcile so currently-active users pick up
  //    Clarity on their next navigation, without needing a hard refresh.
  useEffect(() => {
    const initial = bootstrapConsent(null);
    reconcileFromCookieYes(initial, "reconcile");
  }, [location.pathname]);

  return null;
}
