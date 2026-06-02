import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { clearChunkReloadFlag } from "@/lib/lazy-with-retry";

/**
 * Mounted inside <BrowserRouter>. On every route change scroll to top and
 * clear the one-shot stale-chunk reload flag so future redeploys can
 * recover via lazyWithRetry. Deploy staleness is surfaced by
 * <UpdateAvailableBanner/> — never reload silently here, navigating to a
 * new route should not destroy form state or scroll history.
 */
export function RouteChangeReloader() {
  const location = useLocation();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    clearChunkReloadFlag();
  }, [location.pathname]);

  return null;
}

