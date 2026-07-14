import { useEffect, useRef, useState, useCallback } from "react";
import { markLoginCaptchaVerified } from "@/lib/auth-captcha";
import { isProductionHostname, warnOnUnknownAuthHost } from "@/lib/auth/production-hosts";
import { supabase } from "@/integrations/supabase/client";
import { recordLoginEvent, newAttemptId } from "@/lib/login-telemetry";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const PRODUCTION_SITE_KEY = "0x4AAAAAADEF72dWIkFxiGOU";
// Cloudflare-published "always passes" test site key. Used ONLY on non-production
// hostnames (Lovable preview/sandbox/localhost) where the production site key is
// not allowlisted in Cloudflare and would render an "invalid domain" error.
// Reference: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TEST_SITE_KEY = "1x00000000000000000000AA";

// LCL-FIX-003: how long we wait for the Turnstile script to fully load and
// produce a widget before showing the recovery UI. 6s is long enough to
// avoid false-positives on slow connections but short enough that a
// blocked extension / proxy doesn't leave the user staring at a spinner.
const LOAD_WATCHDOG_MS = 6_000;

function resolveSiteKey(): string {
  if (typeof window === "undefined") return PRODUCTION_SITE_KEY;
  const host = window.location.hostname.toLowerCase();
  warnOnUnknownAuthHost(host);
  return isProductionHostname(host) ? PRODUCTION_SITE_KEY : TEST_SITE_KEY;
}

const TURNSTILE_SITE_KEY = resolveSiteKey();

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

type TurnstileErrorKind = "expired" | "network" | "challenge" | "unknown";

type TurnstileChallengeProps = {
  action: "login" | "register" | "forgot_password" | "signup_confirmation_resend";
  onTokenChange: (token: string) => void;
  /**
   * Punitive failure counter. Incrementing this advances the consecutive-failure
   * counter and, after 2 strikes, enters a 30s retry countdown. Use ONLY for
   * confirmed user-attributable failures (invalid credentials, real CAPTCHA
   * rejection). Never for client_session_write_failed / network / server.
   */
  failureCount?: number;
  /**
   * Non-punitive soft-reset counter. Incrementing this remounts a fresh
   * Turnstile token without bumping the consecutive-failure counter or
   * triggering the 30s lockout. Use for client session-write failures,
   * network errors, and any flow where the user is not at fault but the
   * single-use token has been consumed and a fresh one is needed.
   */
  softResetCount?: number;
  /** Email to use for the magic-link fallback. Login surfaces this. */
  email?: string;
};

// Cloudflare error code prefixes — see https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/
function classifyTurnstileError(code?: string): TurnstileErrorKind {
  if (!code) return "unknown";
  if (code.startsWith("11") || code === "300010" || code === "300020") return "expired";
  if (code.startsWith("2") || code.startsWith("6")) return "network";
  if (code.startsWith("3") || code.startsWith("4") || code.startsWith("5")) return "challenge";
  return "unknown";
}

function injectScript(onReady: () => void): HTMLScriptElement {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
  if (existing) {
    if (window.turnstile) {
      onReady();
      return existing;
    }
    existing.addEventListener("load", onReady, { once: true });
    return existing;
  }
  const script = document.createElement("script");
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true;
  script.defer = true;
  script.addEventListener("load", onReady, { once: true });
  document.head.appendChild(script);
  return script;
}

export function TurnstileChallenge({ action, onTokenChange, failureCount = 0, softResetCount = 0, email }: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(Boolean(window.turnstile));
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [transientError, setTransientError] = useState<TurnstileErrorKind | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [magicLinkState, setMagicLinkState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const consecutiveFailuresRef = useRef(0);
  const lastFailureCountRef = useRef(failureCount);
  const lastSoftResetCountRef = useRef(softResetCount);
  const retryCountRef = useRef(0);

  const resetWidget = () => {
    if (widgetIdRef.current && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current); } catch { /* ignore */ }
    }
  };

  const beginRetryCountdown = () => {
    onTokenChange("");
    if (consecutiveFailuresRef.current >= 2) setRetrySeconds(30);
    else resetWidget();
  };

  // Script injection (kicks off on mount; widget render still defers until
  // scriptReady fires and the container is mounted).
  useEffect(() => {
    if (window.turnstile) { setScriptReady(true); return; }
    injectScript(() => setScriptReady(true));
  }, []);

  // LCL-FIX-003: load-failure watchdog. If after 6s the widget hasn't
  // produced a token AND we don't have a widget id, surface the recovery UI.
  useEffect(() => {
    if (loadFailed) return;
    const t = window.setTimeout(() => {
      if (!widgetIdRef.current) {
        setLoadFailed(true);
        if (action === "login") {
          recordLoginEvent(newAttemptId(), "captcha_blocked", { branch: "widget_load_watchdog" });
        }
      }
    }, LOAD_WATCHDOG_MS);
    return () => window.clearTimeout(t);
  }, [loadFailed, action]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      action,
      theme: "auto",
      "refresh-expired": "auto",
      "retry": "auto",
      callback: (token: string) => {
        consecutiveFailuresRef.current = 0;
        setTransientError(null);
        setRetrySeconds(0);
        setLoadFailed(false);
        // Any successful Turnstile solve satisfies the client-side auth
        // throttle gate (client-request-throttle), which applies to every
        // auth-attempt path — signup/recover/resend, not just login. Gating
        // this on action==="login" left register/forgot-password permanently
        // blocked with a local 403 ("Complete the human verification") since
        // hasFreshLoginCaptchaVerification never became true. The server still
        // independently verifies the real token, so this is throttle state,
        // not a security boundary.
        markLoginCaptchaVerified();
        if (action === "login") recordLoginEvent(newAttemptId(), "captcha_loaded");
        onTokenChange(token);
      },
      "expired-callback": () => {
        setTransientError("expired");
        onTokenChange("");
        resetWidget();
      },
      "error-callback": (code?: string) => {
        consecutiveFailuresRef.current += 1;
        const kind = classifyTurnstileError(code);
        setTransientError(kind);
        if (action === "login") {
          recordLoginEvent(newAttemptId(), "captcha_failed", { branch: kind, requestId: code ?? null });
        }
        beginRetryCountdown();
      },
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
      onTokenChange("");
    };
  }, [action, onTokenChange, scriptReady]);

  useEffect(() => {
    if (failureCount > lastFailureCountRef.current) {
      consecutiveFailuresRef.current += 1;
      setTransientError("challenge");
      beginRetryCountdown();
    }
    lastFailureCountRef.current = failureCount;
  }, [failureCount]);

  // Non-punitive soft reset: clears the current token and forces Cloudflare
  // to issue a fresh one without incrementing the consecutive-failure
  // counter (so no 30s lockout). Used after client_session_write_failed,
  // network errors, and other errors the user is not responsible for.
  useEffect(() => {
    if (softResetCount > lastSoftResetCountRef.current) {
      onTokenChange("");
      setTransientError(null);
      setRetrySeconds(0);
      resetWidget();
    }
    lastSoftResetCountRef.current = softResetCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softResetCount]);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setInterval(() => {
      setRetrySeconds((current) => {
        if (current <= 1) { resetWidget(); return 0; }
        return current - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [retrySeconds]);

  const handleRetryLoad = useCallback(() => {
    retryCountRef.current += 1;
    setLoadFailed(false);
    setMagicLinkState("idle");
    // Remove any stale script tag + global so the next inject is a clean slate.
    document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_SRC}"]`).forEach((s) => s.remove());
    try { delete (window as { turnstile?: unknown }).turnstile; } catch { /* ignore */ }
    if (widgetIdRef.current && window.turnstile) {
      try { window.turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
    }
    widgetIdRef.current = null;
    setScriptReady(false);
    injectScript(() => setScriptReady(true));
  }, []);

  const handleSendMagicLink = useCallback(async () => {
    if (!email || magicLinkState === "sending" || magicLinkState === "sent") return;
    setMagicLinkState("sending");
    const magicAttemptId = newAttemptId();
    try {
      const { error } = await supabase.functions.invoke("send-magic-link", {
        body: { email, redirectTo: `${window.location.origin}/dashboard`, attemptId: magicAttemptId },
      });
      if (error) throw error;
      setMagicLinkState("sent");
      recordLoginEvent(magicAttemptId, "magic_link_sent", { email });
    } catch {
      setMagicLinkState("error");
      recordLoginEvent(magicAttemptId, "magic_link_failed", { email });
    }
  }, [email, magicLinkState]);

  const errorMessage = (() => {
    if (retrySeconds > 0) {
      const base = transientError === "network"
        ? "Verification couldn't reach Cloudflare."
        : "Human verification didn't go through.";
      return `${base} Please retry in ${retrySeconds} second${retrySeconds === 1 ? "" : "s"}.`;
    }
    if (transientError === "expired") return "Verification refreshed — please wait a moment.";
    if (transientError === "network") return "Verification is having trouble reaching Cloudflare. Retrying…";
    return null;
  })();

  // PERMANENT FIX (captcha-fallback): the magic-link escape hatch used to
  // render only when the Turnstile script never loaded (loadFailed). In
  // practice the dominant failure mode is the script loading but the
  // challenge erroring out repeatedly (1,128 `network`-class failures in
  // the last 7 days). Surface the recovery UI for persistent network/unknown
  // errors too, so a real member is never stranded on "Retrying…" without a
  // way to sign in.
  const showFallback =
    loadFailed ||
    (action === "login" &&
      (transientError === "network" || transientError === "unknown") &&
      consecutiveFailuresRef.current >= 2);

  if (showFallback) {
    return (
      <div data-no-card className="rounded-md border border-destructive/40 bg-destructive/5 p-3" role="group" aria-label="Human verification">
        <p className="text-sm text-foreground font-medium">
          {loadFailed ? "Verification didn't load." : "Verification keeps failing."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This usually means a browser extension, ad-blocker, privacy browser (e.g. Brave Shields), or your network is blocking <span className="font-mono">challenges.cloudflare.com</span>. You can email yourself a one-time sign-in link instead.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRetryLoad}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry verification
          </button>
          {email && (
            <button
              type="button"
              onClick={handleSendMagicLink}
              disabled={magicLinkState === "sending" || magicLinkState === "sent"}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {magicLinkState === "sending" ? "Sending…"
                : magicLinkState === "sent" ? "Link sent — check your inbox"
                : "Email me a sign-in link"}
            </button>
          )}
        </div>
        {!email && (
          <p className="mt-2 text-xs text-muted-foreground">
            Enter your email above to enable the sign-in-link option.
          </p>
        )}
        {magicLinkState === "sent" && (
          <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            If an account exists for that email, we've sent a sign-in link. Please check your inbox (and spam folder).
          </p>
        )}
        {magicLinkState === "error" && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            We couldn't send a sign-in link. Please try again in a minute.
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-no-card className="rounded-md border border-border bg-muted/40 p-3" role="group" aria-label="Human verification">
      <div ref={containerRef} className={retrySeconds > 0 ? "min-h-[65px] pointer-events-none opacity-60" : "min-h-[65px]"} />
      {!scriptReady && <p className="text-sm text-muted-foreground" aria-live="polite">Loading verification…</p>}
      {errorMessage && (
        <p
          className={`mt-2 rounded-md px-3 py-2 text-sm ${retrySeconds > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
          role={retrySeconds > 0 ? "alert" : "status"}
          aria-live={retrySeconds > 0 ? "assertive" : "polite"}
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
