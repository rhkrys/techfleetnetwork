import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";

/**
 * Singleton ARIA live region. Mounted once near the root (AppLayout) so any
 * component can announce status messages without forcing focus changes.
 *
 * Two regions:
 *  - polite (default) for status updates, route changes, async loads.
 *  - assertive for errors and critical alerts (announce immediately).
 *
 * The text is briefly cleared and re-set so identical successive messages
 * still fire — most screen readers de-duplicate adjacent identical strings.
 */
const POLITE_EVENT = "tf:announce:polite";
const ASSERTIVE_EVENT = "tf:announce:assertive";

export function announce(message: string, priority: "polite" | "assertive" = "polite") {
  if (!message || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(priority === "assertive" ? ASSERTIVE_EVENT : POLITE_EVENT, {
      detail: { message },
    }),
  );
}

export function useAnnounce() {
  return useCallback((message: string, priority?: "polite" | "assertive") => {
    announce(message, priority);
  }, []);
}

/** Announces every route transition for screen-reader users (WCAG 4.1.3). */
export function useRouteAnnouncer() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Defer one tick so the new <title> has updated.
    const t = setTimeout(() => {
      const title = document.title || pathname;
      announce(title, "polite");
    }, 50);
    return () => clearTimeout(t);
  }, [pathname]);
}

export function LiveAnnouncer() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    const onPolite = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message ?? "";
      setPolite("");
      // Force re-set on next tick so repeats announce.
      requestAnimationFrame(() => setPolite(msg));
    };
    const onAssertive = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message ?? "";
      setAssertive("");
      requestAnimationFrame(() => setAssertive(msg));
    };
    window.addEventListener(POLITE_EVENT, onPolite);
    window.addEventListener(ASSERTIVE_EVENT, onAssertive);
    return () => {
      window.removeEventListener(POLITE_EVENT, onPolite);
      window.removeEventListener(ASSERTIVE_EVENT, onAssertive);
    };
  }, []);

  return (
    <>
      {/*
        translate="no" + data-no-translate guards against Google Translate,
        Transover, and DeepL extensions wrapping these text nodes — the wrap
        moves the original Text out from under React, and the next update
        throws "Failed to execute 'insertBefore' on 'Node'" (root cause of
        the 2026-06-07 ui_render_error pair). The bridge layer
        `installDomTranslator()` already respects [data-no-translate].
      */}
      <div
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className="sr-only"
        translate="no"
        data-no-translate
      >
        {polite}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        className="sr-only"
        translate="no"
        data-no-translate
      >
        {assertive}
      </div>
    </>
  );
}
