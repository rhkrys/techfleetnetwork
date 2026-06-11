/**
 * useSignInEngine — single source of truth for the /login screen.
 *
 * Replaces the 568-line LoginPage state explosion with one hook so the
 * screen layer becomes pure presentation. All proven helpers are kept
 * (Vichea invariant, AUTH-WEDGE, captcha lifecycle, MFA gate, OAuth
 * identity probe, autofill guard) — they just stop bleeding into JSX.
 *
 * Contract locked by docs/runbooks/auth-rebuild-soak.md.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@/lib/react-query";
import { sessionPort } from "@/features/auth/ports/session.port";
import { signInWithPassword } from "@/features/auth/flows/sign-in-password.flow";
import type { AuthErr } from "@/features/auth/domain/auth-result";
import { decideFailureActions } from "@/features/auth/services/auth-failure-policy";
import { RateLimitService } from "@/services/rate-limit.service";
import { MfaService } from "@/services/mfa.service";
import { loginSchema } from "@/lib/validators/auth";
import { reportValidationRejection } from "@/services/error-reporter.service";
import { normalizeSafeRedirectTarget } from "@/lib/security";
import { clearLoginCaptcha, getLoginCaptchaState, recordFailedLoginAttempt, refreshLoginCaptcha } from "@/features/auth/ports/captcha-state.port";
import {
  clearAuthLockout,
  formatAuthLockoutMessage,
  getAuthLockoutState,
  maybeAutoHealAuthLockout,
  recordInvalidAuthAttempt,
  resetAuthLockoutForEmailChange,
} from "@/features/auth/ports/lockout.port";
import { telemetryPort } from "@/features/auth/ports/telemetry.port";
import { flushPendingStaleChunkEvent, newAttemptId, recordLoginEvent } from "@/lib/login-telemetry";

export interface SignInEngine {
  // form state
  email: string;
  password: string;
  showPassword: boolean;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  setShowPassword: (v: boolean) => void;
  markTouched: (field: string) => void;
  // refs for autofill guard
  emailRef: React.MutableRefObject<HTMLInputElement | null>;
  passwordRef: React.MutableRefObject<HTMLInputElement | null>;
  // captcha
  captchaToken: string;
  setCaptchaToken: (t: string) => void;
  captchaFailureCount: number;
  captchaSoftResetCount: number;
  turnstileReady: boolean;
  armTurnstile: () => void;
  // status
  loading: boolean;
  authError: string;
  typedAuthError: AuthErr | null;
  captchaNotice: string;
  oauthHint: null | { has_google: boolean; has_password: boolean };
  lockoutState: ReturnType<typeof getAuthLockoutState>;
  formatLockoutMessage: (secs: number) => string;
  // mfa
  mfaOpen: boolean;
  onMfaSuccess: () => void;
  onMfaCancel: () => void;
  // routing
  redirectTarget: string;
  // submit
  handleSubmit: (e: FormEvent) => Promise<void>;
  // resets
  refreshCaptcha: () => void;
}

export function useSignInEngine(): SignInEngine {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [authError, setAuthError] = useState("");
  const [typedAuthError, setTypedAuthError] = useState<AuthErr | null>(null);
  const [captchaNotice, setCaptchaNotice] = useState("");
  const [oauthHint, setOauthHint] = useState<null | { has_google: boolean; has_password: boolean }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [captchaState, setCaptchaState] = useState(() => getLoginCaptchaState());
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaFailureCount, setCaptchaFailureCount] = useState(0);
  const [captchaSoftResetCount, setCaptchaSoftResetCount] = useState(0);
  const [lockoutState, setLockoutState] = useState(() => getAuthLockoutState());
  const [loading, setLoading] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get("redirect");
  const fromLoc = (location.state as { from?: { pathname?: string; search?: string; hash?: string } })?.from;
  const fromState = fromLoc?.pathname
    ? `${fromLoc.pathname}${fromLoc.search ?? ""}${fromLoc.hash ?? ""}`
    : undefined;
  const redirectTarget = normalizeSafeRedirectTarget(fromState || redirectParam || "/dashboard");

  const markTouched = useCallback((field: string) => setTouched((p) => ({ ...p, [field]: true })), []);
  const armTurnstile = useCallback(() => setTurnstileReady(true), []);

  // Eager-mount Turnstile on password-reset bounce / ?reason, otherwise idle.
  useEffect(() => {
    if (turnstileReady) return;
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

  // Real-time field validation
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
      for (const [k, v] of Object.entries(fieldErrors)) if (touched[k]) touchedErrors[k] = v;
      setErrors(touchedErrors);
    } else {
      setErrors({});
    }
  }, [email, password, touched]);

  // admin_confirmed toast (one-shot)
  const adminConfirmedRef = useRef(false);
  useEffect(() => {
    if (adminConfirmedRef.current) return;
    const params = new URLSearchParams(location.search);
    const v = params.get("admin_confirmed");
    if (!v) return;
    adminConfirmedRef.current = true;
    queryClient.removeQueries({ queryKey: ["admin-role"] });
    if (v === "true") toast.success("Admin role confirmed — welcome aboard.");
    else if (v === "already") toast.info("Your admin role was already confirmed.");
    else if (v === "error") toast.error("We couldn't confirm your admin role. Try again, or contact support if the problem continues.");
    params.delete("admin_confirmed");
    const next = params.toString();
    navigate({ pathname: location.pathname, search: next ? `?${next}` : "" }, { replace: true });
  }, [queryClient, location.search, location.pathname, navigate]);

  // session_expired toast (one-shot, from fetch-guard bounce)
  const sessionExpiredRef = useRef(false);
  useEffect(() => {
    if (sessionExpiredRef.current) return;
    const params = new URLSearchParams(location.search);
    if (params.get("reason") !== "session_expired") return;
    sessionExpiredRef.current = true;
    toast.info("Your session ended. Please sign in again.", { duration: 30000, position: "top-center" });
    params.delete("reason");
    const next = params.toString();
    navigate({ pathname: location.pathname, search: next ? `?${next}` : "" }, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // auto-heal lockout / clear after reset
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("from") === "password-reset") clearAuthLockout();
    else maybeAutoHealAuthLockout();
    setLockoutState(getAuthLockoutState());
    flushPendingStaleChunkEvent();
  }, [location.search]);

  // clear device counter on account switch
  const lastFailedEmailRef = useRef("");
  useEffect(() => {
    const trimmed = email.trim().toLowerCase();
    if (lastFailedEmailRef.current && trimmed && trimmed !== lastFailedEmailRef.current) {
      resetAuthLockoutForEmailChange();
      lastFailedEmailRef.current = "";
      setLockoutState(getAuthLockoutState());
    }
  }, [email]);

  // tick lockout countdown
  useEffect(() => {
    if (!lockoutState.locked) return;
    const t = window.setInterval(() => setLockoutState(getAuthLockoutState()), 1000);
    return () => window.clearInterval(t);
  }, [lockoutState.locked]);

  const checkOauthIdentityForEmail = useCallback(async (emailValue: string, token?: string) => {
    try {
      const body: Record<string, string> = { email: emailValue };
      if (token) body.captchaToken = token;
      const { data, error: fnErr } = await sessionPort.invokeEdge("check-account-identity", { body });
      if (fnErr || !data) return;
      const r = data as { has_password?: boolean; has_google?: boolean };
      if (r.has_google === true && r.has_password === false) {
        setOauthHint({ has_google: true, has_password: false });
      }
    } catch { /* non-blocking */ }
  }, []);

  // deferred OAuth probe
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { email?: string } | undefined;
      if (!detail?.email) return;
      const fire = (tok?: string) => { void checkOauthIdentityForEmail(detail.email!, tok); };
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
  }, [captchaToken, checkOauthIdentityForEmail]);

  const refreshCaptcha = useCallback(() => {
    setAuthError("");
    setTypedAuthError(null);
    setCaptchaNotice("");
    setCaptchaToken("");
    setCaptchaSoftResetCount((c) => c + 1);
  }, []);

  const onMfaSuccess = useCallback(() => { setMfaOpen(false); navigate(redirectTarget, { replace: true }); }, [navigate, redirectTarget]);
  const onMfaCancel = useCallback(() => { setMfaOpen(false); setAuthError("Sign-in cancelled. Please try again."); }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const currentLockout = getAuthLockoutState();
    setLockoutState(currentLockout);
    if (currentLockout.locked) {
      setTypedAuthError(null);
      setAuthError(formatAuthLockoutMessage(currentLockout.remainingSeconds));
      return;
    }
    setTouched({ email: true, password: true });

    // Autofill DOM guard
    const domEmail = emailRef.current?.value ?? "";
    const domPassword = passwordRef.current?.value ?? "";
    const effEmail = domEmail.length > email.length ? domEmail : email;
    const effPassword = domPassword.length > password.length ? domPassword : password;
    if (effEmail !== email) setEmail(effEmail);
    if (effPassword !== password) setPassword(effPassword);

    const result = loginSchema.safeParse({ email: effEmail, password: effPassword });
    if (!result.success) {
      reportValidationRejection("loginSchema", result.error.issues, "SignInScreen.handleSubmit");
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = err.message;
      });
      setErrors(fieldErrors);
      setAuthError(""); setTypedAuthError(null); setCaptchaNotice("");
      return;
    }
    if (!captchaToken.trim()) {
      telemetryPort.captcha("auth_captcha_failed", { surface: "login", failedAttempts: captchaState.failedAttempts + 1 });
      setCaptchaNotice("Complete the human verification below before signing in.");
      setAuthError(""); setTypedAuthError(null);
      return;
    }
    setErrors({}); setAuthError(""); setTypedAuthError(null); setCaptchaNotice(""); setOauthHint(null); setLoading(true);

    const attemptId = newAttemptId();
    const attemptStarted = Date.now();
    recordLoginEvent(attemptId, "started", { email: result.data.email });
    telemetryPort.record("auth_engine.sign_in_started", { email: result.data.email, attempt_id: attemptId });

    const rateCheck = await RateLimitService.peek(result.data.email, "login_attempt").catch(() => ({
      allowed: true, remaining: 5, retry_after: 0,
    }));
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

    if (flowResult.ok === true) {
      recordLoginEvent(attemptId, "session_set", {
        email: result.data.email,
        durationMs: Date.now() - attemptStarted,
        userId: flowResult.value.kind === "signed_in" ? flowResult.value.userId : null,
      });
      const { needsChallenge } = await MfaService.getMfaGateDecision();
      if (needsChallenge) {
        recordLoginEvent(attemptId, "mfa_required", { email: result.data.email });
        setMfaOpen(true); setLoading(false);
        return;
      }
      clearAuthLockout();
      clearLoginCaptcha();
      recordLoginEvent(attemptId, "redirected", { email: result.data.email, durationMs: Date.now() - attemptStarted });
      telemetryPort.record("auth_engine.sign_in_succeeded", { email: result.data.email, attempt_id: attemptId, duration_ms: Date.now() - attemptStarted });
      navigate(redirectTarget, { replace: true });
      return;
    }

    const flowError = flowResult.error;
    const actions = decideFailureActions(flowError.code);
    recordLoginEvent(attemptId, flowError.code === "invalid_credentials" ? "invalid_credentials"
      : flowError.code === "captcha_required" || flowError.code === "captcha_failed" ? "captcha_failed"
      : flowError.code === "rate_limited" || flowError.code === "account_locked" ? "auth_throttle"
      : flowError.code === "client_session_write_failed" ? "client_session_write_failed"
      : flowError.code === "network_error" ? "network_error"
      : flowError.code === "service_unavailable" ? "server_error"
      : "unknown", { email: result.data.email, durationMs: Date.now() - attemptStarted });

    // Vichea invariant: client_session_write_failed must be reported but
    // never punish — verified by docs/runbooks/auth-rebuild-soak.md query 1.
    if (flowError.code === "client_session_write_failed") {
      telemetryPort.record("auth_engine.client_session_write_failed", { email: result.data.email, attempt_id: attemptId });
    } else if (flowError.code === "captcha_required" || flowError.code === "captcha_failed") {
      telemetryPort.record("auth_engine.captcha_failed", { email: result.data.email, attempt_id: attemptId, code: flowError.code });
      telemetryPort.record("auth_engine.captcha_reset", { attempt_id: attemptId });
    } else if (flowError.code === "rate_limited" || flowError.code === "account_locked") {
      telemetryPort.record("auth_engine.sign_in_blocked", { email: result.data.email, reason: flowError.code });
    } else {
      telemetryPort.record("auth_engine.sign_in_failed", { email: result.data.email, code: flowError.code, attempt_id: attemptId });
    }

    setCaptchaToken("");
    if (actions.incrementDeviceLockout) {
      setCaptchaFailureCount((c) => c + 1);
      setCaptchaState(recordFailedLoginAttempt());
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      lastFailedEmailRef.current = result.data.email.trim().toLowerCase();
      if (actions.recordCredentialFailureRpc) {
        void (async () => {
          await sessionPort.rpc("record_failed_login", {
            _email: result.data.email,
            _ip: null,
            _user_agent: navigator.userAgent.substring(0, 200),
          });
        })().catch(() => undefined);
      }
      if (actions.recordServerRateLimitFailure) {
        void RateLimitService.recordFailure(result.data.email, "login_attempt").catch(() => undefined);
      }
      if (nextLockout.locked) {
        setTypedAuthError(null);
        setAuthError(formatAuthLockoutMessage(nextLockout.remainingSeconds));
      } else {
        setAuthError(""); setTypedAuthError(flowError);
      }
      const probeEmail = result.data.email;
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("tfn:probe-oauth-identity", { detail: { email: probeEmail } }));
      }, 0);
    } else {
      if (flowError.code === "rate_limited") {
        telemetryPort.captcha("auth_captcha_fetch_blocked", { surface: "login", reason: "client_auth_throttle_429" });
        setCaptchaState(refreshLoginCaptcha());
      }
      setCaptchaSoftResetCount((c) => c + 1);
      setAuthError(""); setTypedAuthError(flowError);
    }
    setLoading(false);
  }, [captchaState.failedAttempts, captchaToken, email, navigate, password, queryClient, redirectTarget]);

  return {
    email, password, showPassword, errors, touched,
    setEmail, setPassword, setShowPassword, markTouched,
    emailRef, passwordRef,
    captchaToken, setCaptchaToken, captchaFailureCount, captchaSoftResetCount,
    turnstileReady, armTurnstile,
    loading, authError, typedAuthError, captchaNotice, oauthHint,
    lockoutState, formatLockoutMessage: formatAuthLockoutMessage,
    mfaOpen, onMfaSuccess, onMfaCancel,
    redirectTarget,
    handleSubmit, refreshCaptcha,
  };
}
