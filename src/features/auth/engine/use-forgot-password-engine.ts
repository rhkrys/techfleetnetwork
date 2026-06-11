/**
 * useForgotPasswordEngine — single source of truth for /forgot-password.
 * Mirrors useSignInEngine: hook owns state, Screen is pure presentation.
 * Behavior preserved 1:1 from legacy ForgotPasswordPage (LCL-RL fairness,
 * captcha lifecycle, lockout invariants, email-enumeration guard).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AuthService, GOOGLE_ONLY_ACCOUNT_CODE, GOOGLE_ONLY_ACCOUNT_MESSAGE } from "@/services/auth.service";
import { RateLimitService } from "@/services/rate-limit.service";
import { emailInputSchema } from "@/lib/validators/auth";
import { getLoginCaptchaState, refreshLoginCaptcha } from "@/lib/auth-captcha";
import {
  clearAuthLockout,
  formatAuthLockoutMessage,
  getAuthLockoutState,
  recordInvalidAuthAttempt,
} from "@/lib/auth-lockout";
import { logCaptchaTelemetry } from "@/lib/auth-captcha-telemetry";
import { isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";
import { getCanonicalAppOrigin } from "@/lib/canonical-origin";
import { reportValidationRejection } from "@/services/error-reporter.service";

export interface ForgotPasswordEngine {
  email: string;
  setEmail: (v: string) => void;
  error: string;
  loading: boolean;
  submitted: boolean;
  captchaToken: string;
  setCaptchaToken: (t: string) => void;
  captchaFailureCount: number;
  captchaSoftResetCount: number;
  lockoutState: ReturnType<typeof getAuthLockoutState>;
  formatLockoutMessage: (s: number) => string;
  handleSubmit: (e: FormEvent) => Promise<void>;
}

export function useForgotPasswordEngine(): ForgotPasswordEngine {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [captchaState, setCaptchaState] = useState(() => getLoginCaptchaState());
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaFailureCount, setCaptchaFailureCount] = useState(0);
  const [captchaSoftResetCount, setCaptchaSoftResetCount] = useState(0);
  const [lockoutState, setLockoutState] = useState(() => getAuthLockoutState());
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lockoutState.locked) return;
    const t = window.setInterval(() => setLockoutState(getAuthLockoutState()), 1_000);
    return () => window.clearInterval(t);
  }, [lockoutState.locked]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const currentLockout = getAuthLockoutState();
    setLockoutState(currentLockout);
    if (currentLockout.locked) {
      setError(formatAuthLockoutMessage(currentLockout.remainingSeconds));
      return;
    }
    const result = emailInputSchema.safeParse(email);
    if (!result.success) {
      reportValidationRejection("emailInputSchema", result.error.issues, "ForgotPasswordScreen.handleSubmit");
      setError(result.error.issues[0].message);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      if (nextLockout.locked) setError(formatAuthLockoutMessage(nextLockout.remainingSeconds));
      return;
    }
    const domainCheck = await validateEmailDomainExists(result.data);
    if (!domainCheck.valid) {
      setError(domainCheck.message ?? "Use an email address with a real domain.");
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      if (nextLockout.locked) setError(formatAuthLockoutMessage(nextLockout.remainingSeconds));
      return;
    }
    if (!captchaToken.trim()) {
      logCaptchaTelemetry("auth_captcha_failed", { surface: "forgot_password", failedAttempts: captchaState.failedAttempts + 1 });
      setCaptchaState(refreshLoginCaptcha());
      setCaptchaToken("");
      setCaptchaFailureCount((c) => c + 1);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      setError(nextLockout.locked ? formatAuthLockoutMessage(nextLockout.remainingSeconds) : "Complete the human verification before trying again.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const rateCheck = await RateLimitService.peek(result.data, "password_reset");
      if (!rateCheck.allowed) {
        const minutes = Math.ceil(rateCheck.retry_after / 60);
        setError(`Too many requests. Please try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`);
        setLoading(false);
        return;
      }
      await AuthService.resetPassword(result.data, `${getCanonicalAppOrigin()}/reset-password`, captchaToken);
      clearAuthLockout();
      setSubmitted(true);
    } catch (err) {
      const code = (err as { code?: string } | null | undefined)?.code;
      const status = (err as { status?: number } | null | undefined)?.status;
      const message = (err as { message?: string } | null | undefined)?.message ?? "";
      setCaptchaToken("");
      setCaptchaSoftResetCount((c) => c + 1);
      if (code === GOOGLE_ONLY_ACCOUNT_CODE) {
        setError(GOOGLE_ONLY_ACCOUNT_MESSAGE);
        return;
      }
      if (isAuthThrottleCaptchaError(err)) {
        logCaptchaTelemetry("auth_captcha_fetch_blocked", { surface: "forgot_password", reason: "client_auth_throttle_429" });
        setCaptchaState(refreshLoginCaptcha());
        setError(err.message);
        return;
      }
      const isBackendRateLimit = status === 429 || /too many|rate limit/i.test(message);
      if (isBackendRateLimit) {
        void RateLimitService.recordFailure(result.data, "password_reset");
      }
      // Email-enumeration guard: always show success.
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }, [captchaState.failedAttempts, captchaToken, email]);

  return {
    email, setEmail, error, loading, submitted,
    captchaToken, setCaptchaToken, captchaFailureCount, captchaSoftResetCount,
    lockoutState, formatLockoutMessage: formatAuthLockoutMessage,
    handleSubmit,
  };
}
