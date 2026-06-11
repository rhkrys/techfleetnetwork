/**
 * useRegisterEngine — single source of truth for /register.
 * Mirrors useSignInEngine + useForgotPasswordEngine pattern: hook owns
 * state, RegisterScreen is pure presentation. Behavior preserved 1:1
 * from legacy RegisterPage (sanctions screen, domain validation, captcha
 * lifecycle, lockout invariants, ACCOUNT_EXISTS friendly path, resend
 * confirmation flow with its own bucket).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { sessionPort } from "@/features/auth/ports/session.port";
import { RateLimitService } from "@/services/rate-limit.service";
import { registerSchema, ageInYears, GUARDIAN_MIN_AGE } from "@/lib/validators/auth";
import { sessionPort } from "@/features/auth/ports/session.port";
import { logAccountActivity } from "@/lib/account-activity";
import { getLoginCaptchaState, refreshLoginCaptcha } from "@/features/auth/ports/captcha-state.port";
import {
  clearAuthLockout,
  formatAuthLockoutMessage,
  getAuthLockoutState,
  maybeAutoHealAuthLockout,
  recordInvalidAuthAttempt,
  resetAuthLockoutForEmailChange,
} from "@/features/auth/ports/lockout.port";
import { telemetryPort } from "@/features/auth/ports/telemetry.port";
import { isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";
import { getCanonicalAppOrigin } from "@/lib/canonical-origin";
import { recordPolicyAcknowledgment } from "@/lib/policies";
import { loadConsent } from "@/lib/consent/manager";
import { showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import { reportValidationRejection } from "@/services/error-reporter.service";

export interface RegisterEngine {
  // form
  firstName: string; setFirstName: (v: string) => void;
  lastName: string; setLastName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  confirmPassword: string; setConfirmPassword: (v: string) => void;
  dob: string; setDob: (v: string) => void;
  guardianEmail: string; setGuardianEmail: (v: string) => void;
  agreedToTerms: boolean; setAgreedToTerms: (v: boolean) => void;
  electronicCommsConsent: boolean; setElectronicCommsConsent: (v: boolean) => void;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  markTouched: (field: string) => void;
  // captcha / lockout
  captchaToken: string; setCaptchaToken: (t: string) => void;
  captchaFailureCount: number;
  resendCaptchaToken: string; setResendCaptchaToken: (t: string) => void;
  resendCaptchaFailureCount: number;
  lockoutState: ReturnType<typeof getAuthLockoutState>;
  formatLockoutMessage: (s: number) => string;
  // status
  loading: boolean;
  authError: string;
  submitted: boolean;
  existingAccountEmail: string | null;
  clearExistingAccount: () => void;
  // resend confirmation
  resending: boolean;
  resendStatus: "idle" | "success" | "error";
  resendMessage: string;
  handleResendConfirmation: () => Promise<void>;
  // derived
  dobParts: { birthYear: number; birthMonth: number; birthDay: number } | null;
  countryCode: string | null;
  redirectParam: string | null;
  // submit
  handleSubmit: (e: FormEvent) => Promise<void>;
}

export function useRegisterEngine(): RegisterEngine {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get("redirect");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dob, setDob] = useState("");
  const countryCode = loadConsent()?.countryCode ?? null;
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [electronicCommsConsent, setElectronicCommsConsent] = useState(false);
  const [guardianEmail, setGuardianEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [captchaState, setCaptchaState] = useState(() => getLoginCaptchaState());
  const [captchaToken, setCaptchaToken] = useState("");
  const [resendCaptchaToken, setResendCaptchaToken] = useState("");
  const [captchaFailureCount, setCaptchaFailureCount] = useState(0);
  const [resendCaptchaFailureCount, setResendCaptchaFailureCount] = useState(0);
  const [lockoutState, setLockoutState] = useState(() => getAuthLockoutState());
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [existingAccountEmail, setExistingAccountEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "success" | "error">("idle");
  const [resendMessage, setResendMessage] = useState("");

  const markTouched = useCallback((field: string) => setTouched((p) => ({ ...p, [field]: true })), []);
  const clearExistingAccount = useCallback(() => { setExistingAccountEmail(null); setEmail(""); }, []);

  const dobParts = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    if (!m) return null;
    return { birthYear: Number(m[1]), birthMonth: Number(m[2]), birthDay: Number(m[3]) };
  })();

  // Real-time validation
  useEffect(() => {
    if (Object.keys(touched).length === 0) return;
    const payload = {
      firstName, lastName, email, password, confirmPassword,
      birthYear: dobParts?.birthYear ?? 1900,
      birthMonth: dobParts?.birthMonth ?? 1,
      birthDay: dobParts?.birthDay ?? 1,
      countryCode, guardianEmail, electronicCommsConsent, agreedToTerms,
    };
    const result = registerSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        const key = (field === "birthYear" || field === "birthMonth" || field === "birthDay") ? "dob" : field;
        if (!fieldErrors[key]) fieldErrors[key] = err.message;
      });
      const touchedErrors: Record<string, string> = {};
      for (const [k, v] of Object.entries(fieldErrors)) if (touched[k]) touchedErrors[k] = v;
      setErrors(touchedErrors);
    } else {
      setErrors({});
    }
  }, [firstName, lastName, email, password, confirmPassword, dob, agreedToTerms, electronicCommsConsent, guardianEmail, touched, countryCode, dobParts]);

  useEffect(() => {
    maybeAutoHealAuthLockout();
    setLockoutState(getAuthLockoutState());
  }, []);

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
    const t = window.setInterval(() => setLockoutState(getAuthLockoutState()), 1_000);
    return () => window.clearInterval(t);
  }, [lockoutState.locked]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const currentLockout = getAuthLockoutState();
    setLockoutState(currentLockout);
    if (currentLockout.locked) { setAuthError(formatAuthLockoutMessage(currentLockout.remainingSeconds)); return; }
    setTouched({
      firstName: true, lastName: true, email: true,
      password: true, confirmPassword: true, dob: true,
      agreedToTerms: true, electronicCommsConsent: true, guardianEmail: true,
    });

    const payload = {
      firstName, lastName, email, password, confirmPassword,
      birthYear: dobParts?.birthYear ?? 1900,
      birthMonth: dobParts?.birthMonth ?? 1,
      birthDay: dobParts?.birthDay ?? 1,
      countryCode, guardianEmail, electronicCommsConsent, agreedToTerms,
    };
    const result = registerSchema.safeParse(payload);
    if (!result.success) {
      reportValidationRejection("registerSchema", result.error.issues, "RegisterScreen.handleSubmit");
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as string;
        const key = (field === "birthYear" || field === "birthMonth" || field === "birthDay") ? "dob" : field;
        if (!fieldErrors[key]) fieldErrors[key] = err.message;
      });
      setErrors(fieldErrors);
      void logAccountActivity("signup_validation_failed", {
        email: email || null,
        details: { failedFields: Object.keys(fieldErrors).join(",") },
      });
      showFormErrors(fieldErrors, {
        firstName: "First name", lastName: "Last name", email: "Email",
        password: "Password", confirmPassword: "Confirm password",
        dob: "Date of birth", agreedToTerms: "Terms agreement",
        electronicCommsConsent: "Electronic communications consent",
        guardianEmail: "Parent or guardian email",
      });
      scrollToFirstError();
      return;
    }

    if (countryCode) {
      try {
        const { data: sanctionsResult } = await sessionPort.invokeEdge("screen-sanctions", {
          body: { email: result.data.email, country_code: countryCode },
        });
        if (sanctionsResult?.decision === "deny") {
          setAuthError("We're sorry — Tech Fleet cannot create accounts for users in this country due to U.S. export-control and sanctions laws.");
          return;
        }
      } catch { /* fail-open */ }
    }

    const domainCheck = await validateEmailDomainExists(result.data.email);
    if (!domainCheck.valid) {
      const fieldErrors = { email: domainCheck.message ?? "Use an email address with a real domain." };
      setErrors(fieldErrors);
      showFormErrors(fieldErrors, { email: "Email" });
      scrollToFirstError();
      return;
    }

    if (!captchaToken.trim()) {
      telemetryPort.captcha("auth_captcha_failed", { surface: "register", failedAttempts: captchaState.failedAttempts + 1 });
      setCaptchaState(refreshLoginCaptcha());
      setCaptchaToken("");
      setCaptchaFailureCount((c) => c + 1);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      setAuthError(nextLockout.locked ? formatAuthLockoutMessage(nextLockout.remainingSeconds) : "Complete the human verification before trying again.");
      return;
    }

    setErrors({});
    setLoading(true);
    setAuthError("");
    telemetryPort.record("auth_engine.sign_up_started", { email: result.data.email });


    try {
      const rateCheck = await RateLimitService.peek(result.data.email, "signup_attempt");
      if (!rateCheck.allowed) {
        const minutes = Math.max(1, Math.ceil(rateCheck.retry_after / 60));
        void logAccountActivity("signup_rate_limited", { email: result.data.email, details: { retryAfterSec: rateCheck.retry_after } });
        setAuthError(`Too many signup attempts for this email. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}, or sign in if you already have an account.`);
        setLoading(false);
        return;
      }

      await sessionPort.signUp(
        result.data.email,
        result.data.password,
        result.data.firstName,
        result.data.lastName,
        getCanonicalAppOrigin() + (redirectParam ? redirectParam : "/profile-setup"),
        captchaToken,
        result.data.birthYear,
      );
      await recordPolicyAcknowledgment("registration", { electronicCommsConsent: true });
      clearAuthLockout();
      telemetryPort.record("auth_engine.sign_up_succeeded", { email: result.data.email });
      setSubmitted(true);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      telemetryPort.record("auth_engine.sign_up_failed", { email: result.data.email, code: e?.code ?? "unknown" });
      if (isAuthThrottleCaptchaError(err)) {
        telemetryPort.captcha("auth_captcha_fetch_blocked", { surface: "register", reason: "client_auth_throttle_429" });
        setCaptchaState(refreshLoginCaptcha());
        setCaptchaToken("");
        setCaptchaFailureCount((c) => c + 1);
        setAuthError(e.message ?? "Sign-up is briefly throttled. Try again shortly.");
        setLoading(false);
        return;
      }
      if (e?.code === "ACCOUNT_EXISTS") {
        setAuthError("");
        setExistingAccountEmail(result.data.email);
        setLoading(false);
        return;
      }
      void RateLimitService.recordFailure(result.data.email, "signup_attempt").catch(() => undefined);
      setAuthError(e.message ?? "We couldn't create your account. Try again in a moment.");
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      lastFailedEmailRef.current = result.data.email.trim().toLowerCase();
      if (nextLockout.locked) setAuthError(formatAuthLockoutMessage(nextLockout.remainingSeconds));
    } finally {
      setLoading(false);
    }
  }, [agreedToTerms, captchaState.failedAttempts, captchaToken, confirmPassword, countryCode, dobParts, electronicCommsConsent, email, firstName, guardianEmail, lastName, password, redirectParam]);

  const handleResendConfirmation = useCallback(async () => {
    setResending(true);
    setResendStatus("idle");
    setResendMessage("");
    try {
      if (!resendCaptchaToken.trim()) {
        telemetryPort.captcha("auth_captcha_failed", { surface: "signup_confirmation_resend", failedAttempts: captchaState.failedAttempts + 1 });
        setResendCaptchaToken("");
        setResendCaptchaFailureCount((c) => c + 1);
        setResendStatus("error");
        setResendMessage("Complete the human verification before requesting another verification email.");
        return;
      }
      const rateCheck = await RateLimitService.check(email, "signup_resend");
      if (!rateCheck.allowed) {
        const minutes = Math.ceil(rateCheck.retry_after / 60);
        setResendStatus("error");
        setResendMessage(`Please wait ${minutes} minute${minutes > 1 ? "s" : ""} before requesting another verification email.`);
        return;
      }
      await sessionPort.resendSignupConfirmation(
        email,
        getCanonicalAppOrigin() + (redirectParam ? redirectParam : "/profile-setup"),
        resendCaptchaToken,
      );
      setResendStatus("success");
      setResendMessage("If this email is still waiting for verification, a fresh link has been sent. Check your inbox and spam folder.");
    } catch (err) {
      const e = err as { message?: string };
      setResendStatus("error");
      setResendMessage(e?.message ?? "We could not resend the verification email right now. Please try again in a minute.");
    } finally {
      setResending(false);
    }
  }, [captchaState.failedAttempts, email, redirectParam, resendCaptchaToken]);

  return {
    firstName, setFirstName, lastName, setLastName,
    email, setEmail, password, setPassword, confirmPassword, setConfirmPassword,
    dob, setDob, guardianEmail, setGuardianEmail,
    agreedToTerms, setAgreedToTerms, electronicCommsConsent, setElectronicCommsConsent,
    errors, touched, markTouched,
    captchaToken, setCaptchaToken, captchaFailureCount,
    resendCaptchaToken, setResendCaptchaToken, resendCaptchaFailureCount,
    lockoutState, formatLockoutMessage: formatAuthLockoutMessage,
    loading, authError, submitted,
    existingAccountEmail, clearExistingAccount,
    resending, resendStatus, resendMessage, handleResendConfirmation,
    dobParts, countryCode, redirectParam,
    handleSubmit,
  };
}

export { ageInYears, GUARDIAN_MIN_AGE };
