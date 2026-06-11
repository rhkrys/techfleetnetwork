import { useState, useEffect, useRef, lazy, Suspense, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";
import { signInWithPassword } from "@/features/auth/flows/sign-in-password.flow";
import type { AuthErr } from "@/features/auth/domain/auth-result";
import { decideFailureActions } from "@/features/auth/services/auth-failure-policy";
import { AuthErrorMessage } from "@/features/auth/ui/AuthErrorMessage";
import { RateLimitService } from "@/services/rate-limit.service";
import { loginSchema } from "@/lib/validators/auth";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { PolicyLinksInline } from "@/components/PolicyLinksInline";
import { recordPolicyAcknowledgment } from "@/lib/policies";
import { toast } from "sonner";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { ValidatedField } from "@/components/ui/validated-field";
import { validationBorderClass, getFieldValidationState, showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import { useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MfaService } from "@/services/mfa.service";
import { MfaChallengeDialog } from "@/components/MfaChallengeDialog";
import { clearLoginCaptcha, getLoginCaptchaState, recordFailedLoginAttempt, refreshLoginCaptcha } from "@/lib/auth-captcha";
// Turnstile is deferred — Cloudflare's API.js + iframe is ~50KB and blocks
// LCP on /login. We mount it lazily after the user focuses the form OR after
// idle, whichever comes first. Until then we reserve a fixed-height shell
// (matches Turnstile's 65px compact size) so swapping in the widget does
// not shift layout (CLS guard).
const TurnstileChallenge = lazy(() =>
  import("@/components/auth/TurnstileChallenge").then(m => ({ default: m.TurnstileChallenge }))
);
import { clearAuthLockout, formatAuthLockoutMessage, getAuthLockoutState, maybeAutoHealAuthLockout, recordInvalidAuthAttempt, resetAuthLockoutForEmailChange } from "@/lib/auth-lockout";
import { logCaptchaTelemetry } from "@/lib/auth-captcha-telemetry";
import { reportValidationRejection } from "@/services/error-reporter.service";
import { normalizeSafeRedirectTarget } from "@/lib/security";
import { recordLoginEvent, newAttemptId, flushPendingStaleChunkEvent } from "@/lib/login-telemetry";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Refs let us read the live DOM value at submit-time. Browser autofill
  // (Chrome, Safari, 1Password) often writes input.value without dispatching
  // a React-compatible input event, leaving controlled state empty and
  // tripping "Email address is required" on submit.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Split error channels (NN/g #9 — Help users recognize, diagnose, recover):
  //  - authError: red banner, only for true server auth rejections
  //  - captchaNotice: inline note next to the widget for missing/expired tokens
  //  - oauthHint: friendly "this account uses Google" callout after a failed pw login
  // Field-level Zod errors continue to render via ValidatedField (`errors` map).
  const [authError, setAuthError] = useState("");
  const [typedAuthError, setTypedAuthError] = useState<AuthErr | null>(null);
  const [captchaNotice, setCaptchaNotice] = useState("");
  const [oauthHint, setOauthHint] = useState<null | { has_google: boolean; has_password: boolean }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [captchaState, setCaptchaState] = useState(() => getLoginCaptchaState());
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaFailureCount, setCaptchaFailureCount] = useState(0);
  // Non-punitive widget refresh (no 30s lockout). Bumped after any
  // client/network/server failure that consumed the single-use Turnstile
  // token but is NOT the user's fault.
  const [captchaSoftResetCount, setCaptchaSoftResetCount] = useState(0);
  const [lockoutState, setLockoutState] = useState(() => getAuthLockoutState());
  const [loading, setLoading] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  // CWV pass 3: defer Turnstile mount until the user interacts with the form
  // OR the browser is idle. The reserved-height shell below keeps layout
  // stable when the widget pops in. Email focus is the canonical trigger
  // since it's the first form field and users tab/click here first.
  const [turnstileReady, setTurnstileReady] = useState(false);
  useEffect(() => {
    if (turnstileReady) return;
    // Eager mount after a password reset, session-expired bounce, or any
    // ?reason= handoff so the widget is interactive before the member
    // clicks "Sign in" with autofilled credentials.
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") === "password-reset" || params.has("reason")) {
      setTurnstileReady(true);
      return;
    }
    const arm = () => setTurnstileReady(true);
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const idleId = typeof ric === "function" ? ric(arm, { timeout: 2000 }) : window.setTimeout(arm, 1200);
    return () => {
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (typeof ric === "function" && typeof cic === "function") cic(idleId as number);
      else window.clearTimeout(idleId as number);
    };
  }, [turnstileReady]);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get("redirect");
  const fromLoc = (location.state as { from?: { pathname?: string; search?: string; hash?: string } })?.from;
  const fromState = fromLoc?.pathname
    ? `${fromLoc.pathname}${fromLoc.search ?? ""}${fromLoc.hash ?? ""}`
    : undefined;
  const from = normalizeSafeRedirectTarget(fromState || redirectParam || "/dashboard");

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  // Real-time validation
  useEffect(() => {
    if (Object.keys(touched).length === 0) return;
    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = err.message;
      });
      const touchedErrors: Record<string, string> = {};
      for (const [k, v] of Object.entries(fieldErrors)) {
        if (touched[k]) touchedErrors[k] = v;
      }
      setErrors(touchedErrors);
    } else {
      setErrors({});
    }
  }, [email, password, touched]);

  // Show toast for admin confirmation redirect (fires at most once per page load)
  const adminConfirmedHandledRef = useRef(false);
  useEffect(() => {
    if (adminConfirmedHandledRef.current) return;
    const params = new URLSearchParams(location.search);
    const adminConfirmed = params.get("admin_confirmed");
    if (!adminConfirmed) return;

    adminConfirmedHandledRef.current = true;
    queryClient.removeQueries({ queryKey: ["admin-role"] });

    if (adminConfirmed === "true") {
      toast.success("Admin role confirmed — welcome aboard.");
    } else if (adminConfirmed === "already") {
      toast.info("Your admin role was already confirmed.");
    } else if (adminConfirmed === "error") {
      toast.error("We couldn't confirm your admin role. Try again, or contact support if the problem continues.");
    }

    // Strip the param from the URL via the navigation API so router state stays in sync
    params.delete("admin_confirmed");
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );
  }, [queryClient, location.search, location.pathname, navigate]);

  // AUTH-WEDGE Phase 3: surface a friendly message when the fetch-guard
  // redirected us here after a corrupt-JWT recovery. One-shot — strips the
  // query param so refresh doesn't re-fire the toast.
  const sessionExpiredHandledRef = useRef(false);
  useEffect(() => {
    if (sessionExpiredHandledRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get("reason") !== "session_expired") return;
    sessionExpiredHandledRef.current = true;
    toast.info("Your session ended. Please sign in again.", {
      duration: 30000,
      position: "top-center",
    });
    params.delete("reason");
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );
  }, [location.search, location.pathname, navigate]);


  // Auto-heal stale device-side lockouts on mount. Users should never have
  // to clear sessionStorage by hand — see auth-lockout.ts for the security
  // rationale (server bucket is the real brute-force defense). If the user
  // just completed a password reset, drop ANY remaining lockout — they
  // proved identity via the recovery email.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("from") === "password-reset") {
      clearAuthLockout();
    } else {
      maybeAutoHealAuthLockout();
    }
    setLockoutState(getAuthLockoutState());
    flushPendingStaleChunkEvent();
  }, [location.search]);


  // Track which email the device counter is currently associated with.
  // Switching accounts = different rate-limit context, so clear silently.
  const lastFailedEmailRef = useRef<string>("");
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (lastFailedEmailRef.current && trimmed && trimmed !== lastFailedEmailRef.current) {
      resetAuthLockoutForEmailChange();
      lastFailedEmailRef.current = "";
      setLockoutState(getAuthLockoutState());
    }
  }, [email]);

  useEffect(() => {
    if (!lockoutState.locked) return;
    const timer = window.setInterval(() => setLockoutState(getAuthLockoutState()), 1_000);
    return () => window.clearInterval(timer);
  }, [lockoutState.locked]);

  const checkOauthIdentityForEmail = async (emailValue: string, token?: string) => {
    try {
      const body: Record<string, string> = { email: emailValue };
      if (token) body.captchaToken = token;
      const { data, error: fnErr } = await supabase.functions.invoke("check-account-identity", { body });
      if (fnErr || !data) return;
      const r = data as { has_password?: boolean; has_google?: boolean };
      if (r.has_google === true && r.has_password === false) {
        setOauthHint({ has_google: true, has_password: false });
      }
    } catch { /* non-blocking; the regular auth error still shows */ }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const currentLockout = getAuthLockoutState();
    setLockoutState(currentLockout);
    if (currentLockout.locked) {
      setTypedAuthError(null);
      setAuthError(formatAuthLockoutMessage(currentLockout.remainingSeconds));
      return;
    }
    setTouched({ email: true, password: true });

    // Autofill guard: read live DOM values. If the browser autofilled but
    // never fired onChange, React state is stale (empty) and validation
    // would falsely reject as "required". Prefer the DOM value when it's
    // longer than state.
    const domEmail = emailRef.current?.value ?? "";
    const domPassword = passwordRef.current?.value ?? "";
    const effectiveEmail = domEmail.length > email.length ? domEmail : email;
    const effectivePassword = domPassword.length > password.length ? domPassword : password;
    if (effectiveEmail !== email) setEmail(effectiveEmail);
    if (effectivePassword !== password) setPassword(effectivePassword);

    const result = loginSchema.safeParse({ email: effectiveEmail, password: effectivePassword });
    if (!result.success) {
      reportValidationRejection("loginSchema", result.error.issues, "LoginPage.handleSubmit");
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = err.message;
      });
      setErrors(fieldErrors);
      // Validation errors render inline only — no red banner, no lockout increment.
      setAuthError("");
      setTypedAuthError(null);
      setCaptchaNotice("");
      scrollToFirstError();
      return;
    }
    if (!captchaToken.trim()) {
      logCaptchaTelemetry("auth_captcha_failed", { surface: "login", failedAttempts: captchaState.failedAttempts + 1 });
      // Do NOT remount the widget here — that's what produced the false "captcha
      // passed → too many attempts" flicker. Just nudge the user inline.
      setCaptchaNotice("Complete the human verification below before signing in.");
      setAuthError("");
      setTypedAuthError(null);
      return;
    }
    setErrors({});
    setAuthError("");
    setTypedAuthError(null);
    setCaptchaNotice("");
    setOauthHint(null);
    setLoading(true);

    const attemptId = newAttemptId();
    const attemptStarted = Date.now();
    recordLoginEvent(attemptId, "started", { email: result.data.email });


    // PEEK only — never increment on the way in. The bucket now counts only
    // confirmed credential rejections (recordFailure below). This prevents
    // successful logins earlier in the same 15-minute window from triggering
    // a "too many attempts" error on a legitimate user's first retry.
    const rateCheck = await RateLimitService.peek(result.data.email, "login_attempt");
    if (!rateCheck.allowed) {
      const minutes = Math.max(1, Math.ceil(rateCheck.retry_after / 60));
      setTypedAuthError(null);
      setAuthError(`This account is temporarily locked after multiple failed sign-ins. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}, or reset your password.`);
      setLoading(false);
      return;
    }

    queryClient.removeQueries({ queryKey: ["admin-role"] });
    const flowResult = await signInWithPassword({
      email: result.data.email,
      password: result.data.password,
      captchaToken,
      attemptId,
    });

    if (flowResult.ok) {
      recordLoginEvent(attemptId, "session_set", {
        email: result.data.email,
        durationMs: Date.now() - attemptStarted,
        userId: flowResult.value.userId || null,
      });
      const { needsChallenge } = await MfaService.getMfaGateDecision();
      if (needsChallenge) {
        recordLoginEvent(attemptId, "mfa_required", { email: result.data.email });
        setMfaOpen(true);
        setLoading(false);
        return;
      }
      clearAuthLockout();
      clearLoginCaptcha();
      recordLoginEvent(attemptId, "redirected", {
        email: result.data.email,
        durationMs: Date.now() - attemptStarted,
      });
      navigate(from, { replace: true });
      return;
    }

    const actions = decideFailureActions(flowResult.error.code);
    const outcomeMap: Record<AuthErr["code"], "invalid_credentials" | "auth_throttle" | "captcha_failed" | "network_error" | "server_error" | "client_session_write_failed" | "unknown"> = {
      invalid_credentials: "invalid_credentials",
      account_locked: "auth_throttle",
      captcha_required: "captcha_failed",
      captcha_failed: "captcha_failed",
      rate_limited: "auth_throttle",
      google_only_account: "unknown",
      email_not_confirmed: "unknown",
      email_provider_unverified: "unknown",
      weak_password: "unknown",
      same_password: "unknown",
      recovery_session_expired: "unknown",
      recovery_link_consumed: "unknown",
      client_session_write_failed: "client_session_write_failed",
      mfa_required: "unknown",
      mfa_invalid_code: "unknown",
      network_error: "network_error",
      service_unavailable: "server_error",
      unexpected: "unknown",
    };
    recordLoginEvent(attemptId, outcomeMap[flowResult.error.code] ?? "unknown", {
      email: result.data.email,
      durationMs: Date.now() - attemptStarted,
    });

    setCaptchaToken("");
    if (actions.incrementDeviceLockout) {
      setCaptchaFailureCount((count) => count + 1);
      const nextCaptcha = recordFailedLoginAttempt();
      setCaptchaState(nextCaptcha);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      lastFailedEmailRef.current = result.data.email.trim().toLowerCase();
      if (actions.recordCredentialFailureRpc) {
        void supabase.rpc("record_failed_login", {
          _email: result.data.email,
          _ip: null,
          _user_agent: navigator.userAgent.substring(0, 200),
        }).catch(() => undefined);
      }
      if (actions.recordServerRateLimitFailure) {
        void RateLimitService.recordFailure(result.data.email, "login_attempt").catch(() => undefined);
      }
      if (nextLockout.locked) {
        setTypedAuthError(null);
        setAuthError(formatAuthLockoutMessage(nextLockout.remainingSeconds));
      } else {
        setAuthError("");
        setTypedAuthError(flowResult.error);
      }
      const probeEmail = result.data.email;
      setTimeout(() => {
        void checkOauthIdentityForEmail(probeEmail, captchaToken || undefined);
        window.dispatchEvent(new CustomEvent("tfn:probe-oauth-identity", { detail: { email: probeEmail } }));
      }, 0);
    } else {
      if (flowResult.error.code === "rate_limited") {
        logCaptchaTelemetry("auth_captcha_fetch_blocked", { surface: "login", reason: "client_auth_throttle_429" });
        setCaptchaState(refreshLoginCaptcha());
      }
      setCaptchaSoftResetCount((count) => count + 1);
      setAuthError("");
      setTypedAuthError(flowResult.error);
    }
    setLoading(false);
  };


  // Listen for the deferred OAuth-identity probe and run it once a fresh
  // CAPTCHA token is available. Avoids extra renders and stale closures.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { email?: string } | undefined;
      if (!detail?.email) return;
      const fire = (tok?: string) => {
        void checkOauthIdentityForEmail(detail.email!, tok);
      };
      // First probe right away with whatever token we have (may be empty —
      // endpoint allows it). If still no hint after the captcha refreshes,
      // re-probe once with the fresh token to cover edge cases where the
      // first call was blocked by rate-limit.
      fire(captchaToken || undefined);
      if (!captchaToken) {
        let elapsed = 0;
        const id = window.setInterval(() => {
          elapsed += 250;
          if (captchaToken) { fire(captchaToken); window.clearInterval(id); }
          else if (elapsed >= 8_000) window.clearInterval(id);
        }, 250);
      }
    };
    window.addEventListener("tfn:probe-oauth-identity", handler);
    return () => window.removeEventListener("tfn:probe-oauth-identity", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captchaToken]);

  const bc = (field: string, value: string) =>
    validationBorderClass(getFieldValidationState(errors[field], value, !!touched[field]));

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <img src={techFleetLogo} alt="" width={48} height={48} decoding="async" fetchPriority="high" className="h-12 w-12 mx-auto mb-4 dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-1">Sign in to your Tech Fleet account</p>
        </div>

        <div className="card-elevated p-6 sm:p-8">
          {authError && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">
              <p>{authError}</p>
              <p className="mt-2 text-xs text-destructive/80">
                <Link to="/forgot-password" className="underline hover:no-underline">Reset password</Link>
                <span className="mx-2" aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setAuthError("");
                    setCaptchaNotice("");
                    setCaptchaToken("");
                    setCaptchaSoftResetCount((c) => c + 1);
                  }}
                  className="underline hover:no-underline"
                >
                  Refresh verification
                </button>
                <span className="mx-2" aria-hidden="true">·</span>
                <span>Signed up with Google? Use the button above.</span>
              </p>
            </div>
          )}

          {oauthHint?.has_google && !oauthHint.has_password && (
            <div className="mb-4 p-3 rounded-md border border-primary/30 bg-primary/10 text-sm" role="status" aria-live="polite">
              <p className="font-semibold text-foreground">This account uses Google sign-in</p>
              <p className="mt-1 text-muted-foreground">Use <strong>Continue with Google</strong> above to sign in. Your password attempt won't be counted.</p>
            </div>
          )}

          {from !== "/dashboard" && (
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-foreground" role="status" aria-live="polite">
              <p className="font-semibold">Sign in to continue</p>
              <p className="mt-1 text-muted-foreground">After sign-in, we'll take you back to the page you were trying to open.</p>
            </div>
          )}

          <GoogleSignInButton
            redirectTo={from}
            onBeforeSubmit={() => {
              recordPolicyAcknowledgment("google-oauth");
              return true;
            }}
          />
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            By continuing with Google, you confirm that you have read and agree to the <PolicyLinksInline />.
          </p>

          <div className="mt-4 relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 mt-4" noValidate>
            <ValidatedField id="email" label="Email address" required error={errors.email} value={email} touched={touched.email}>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input ref={emailRef} id="email" type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onAnimationStart={(e) => { if ((e as unknown as { animationName: string }).animationName === "onAutoFillStart" && emailRef.current && emailRef.current.value !== email) setEmail(emailRef.current.value); }} onFocus={() => setTurnstileReady(true)} onBlur={() => markTouched("email")} className={`pl-10 ${bc("email", email)}`} autoComplete="email" required aria-required="true" aria-invalid={!!errors.email} />
              </div>
            </ValidatedField>

            <ValidatedField id="password" label="Password" required error={errors.password} value={password} touched={touched.password}>
              <div className="flex items-center justify-between mb-1.5">
                <span /> {/* spacer since label is in ValidatedField */}
                <Link to="/forgot-password" className="text-xs text-primary-text hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input ref={passwordRef} id="password" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} onAnimationStart={(e) => { if ((e as unknown as { animationName: string }).animationName === "onAutoFillStart" && passwordRef.current && passwordRef.current.value !== password) setPassword(passwordRef.current.value); }} onBlur={() => markTouched("password")} className={`pl-10 pr-10 ${bc("password", password)}`} autoComplete="current-password" required aria-required="true" aria-invalid={!!errors.password} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </ValidatedField>

            {/* CLS guard: reserve 78px (Turnstile compact widget height + margin)
                so the form does not shift when the lazy widget mounts. */}
            <div style={{ minHeight: 78 }} onFocusCapture={() => setTurnstileReady(true)}>
              {turnstileReady ? (
                <Suspense fallback={<div style={{ height: 78 }} aria-hidden="true" />}>
                  <TurnstileChallenge action="login" onTokenChange={setCaptchaToken} failureCount={captchaFailureCount} softResetCount={captchaSoftResetCount} email={email} />
                </Suspense>
              ) : (
                <div style={{ height: 78 }} aria-hidden="true" />
              )}
            </div>
            {captchaNotice && !authError && (
              <p className="-mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">{captchaNotice}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading || lockoutState.locked} aria-describedby={lockoutState.locked ? "login-lockout-status" : undefined}>
              {loading ? "Signing in…" : lockoutState.locked ? `Try again in ${lockoutState.remainingSeconds}s` : "Sign in"}
            </Button>
            {lockoutState.locked && <p id="login-lockout-status" className="text-sm text-muted-foreground text-center" aria-live="polite">{formatAuthLockoutMessage(lockoutState.remainingSeconds)}</p>}
            {from !== "/dashboard" && (
              <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground" aria-live="polite">
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> Your destination is saved.
              </p>
            )}
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          New member?{" "}
          <Link to={from !== "/dashboard" ? `/register?redirect=${encodeURIComponent(from)}` : "/register"} className="text-primary-text font-medium hover:underline">Sign up</Link>
        </p>
      </div>

      <MfaChallengeDialog
        open={mfaOpen}
        onSuccess={() => { setMfaOpen(false); navigate(from, { replace: true }); }}
        onCancel={() => { setMfaOpen(false); setAuthError("Sign-in cancelled. Please try again."); }}
      />
    </div>
  );
}
