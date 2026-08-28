import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
// Brand Visual Guide §3 — Poppins body + Jost display (Futura PT free equivalent).
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/jost/600.css";
import "@fontsource/jost/700.css";
import "./index.css";
// AUTH-OAUTH-APEX-EDGE-301-001 — apex→www canonicalization lives in Lovable
// hosting (302 at the edge). No client-side boot guard needed; the SPA only
// ever boots on www.techfleet.network in production.

import { installGlobalErrorReporter } from "@/services/error-reporter.service";
import { installLoggerReporting } from "@/lib/observability/logger-report-bridge";
import { startDeployWatcher } from "@/lib/deploy-watcher";
import { installClientRequestThrottle } from "@/lib/client-request-throttle";
import { clearAppCachesForVersion } from "@/lib/app-cache-reset";
import { installLoginCaptchaCrossTabSync } from "@/lib/auth-captcha";
import { installWebVitalsBeacon } from "@/lib/web-vitals";
import { installForceNewTab } from "@/lib/force-new-tab";
import { installAuthFetchGuard } from "@/lib/auth/fetch-guard";
import "@/i18n"; // initialize i18next + apply <html lang>/<html dir>
import { installDomTranslator } from "@/lib/i18n/dom-translator";

// AUTH-WEDGE Phase 3: install the global fetch guard BEFORE any module
// imports the Supabase client. One bad_jwt response → clean recovery,
// no auto-refresh storm.
installAuthFetchGuard();

// Unregister any existing service workers and clear caches so users always get fresh content.
// Guard on the VALUE, not `"serviceWorker" in navigator`: a browser (or a test
// stubbing graceful degradation) can expose the property while its value is
// undefined, which made `navigator.serviceWorker.getRegistrations()` throw at boot.
if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function") {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
  if ("caches" in window) {
    caches.keys().then((names) => names.forEach((name) => caches.delete(name)));
  }
}

installGlobalErrorReporter();
// ADR-0021: route error-level logs to the reporter (no-op until the
// logger_error_reporting flag is ramped). Must follow installGlobalErrorReporter.
installLoggerReporting();
installLoginCaptchaCrossTabSync();
installClientRequestThrottle();
void clearAppCachesForVersion({ reloadAfterClear: false });
// Detect new deploys while the tab is open and refresh BEFORE a stale chunk
// fetch can fail. Pairs with lazyWithRetry as the safety net.
startDeployWatcher();
// Real User Monitoring — Core Web Vitals beacon. Deferred internally; honours
// Save-Data; library is dynamically imported so it's not in the main bundle.
installWebVitalsBeacon();
// Force-new-tab: Alt+Click, Alt+Enter (focused link), Alt+Shift+O (hovered link).
installForceNewTab();
// Runtime DOM translator — translates visible UI into the user's chosen
// language (no-op for English). Bridges the gap until every component uses t().
installDomTranslator();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);

// Beacon read by the inline pre-mount chunk-404 reloader in index.html.
// Once set, that handler becomes a no-op so Firefox's bubbled error
// events from in-flight dynamic imports cannot reload the page to a
// stale pre-navigation URL (the "every click goes back to /dashboard"
// Firefox bug). lazyWithRetry + ErrorBoundary take over from here.
try {
  (window as unknown as { __tfnAppMounted?: boolean }).__tfnAppMounted = true;
  document.documentElement.setAttribute("data-tfn-mounted", "1");
} catch {
  /* non-fatal */
}
