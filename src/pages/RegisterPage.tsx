import { useState, useEffect, useRef, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, User, Cake, ShieldAlert } from "lucide-react";
import { AuthService } from "@/services/auth.service";
import { RateLimitService } from "@/services/rate-limit.service";
import { registerSchema, ageInYears, GUARDIAN_MIN_AGE } from "@/lib/validators/auth";
import { supabase } from "@/integrations/supabase/client";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { PasswordSetFields } from "@/components/auth/PasswordSetFields";
import { ValidatedField } from "@/components/ui/validated-field";
import { validationBorderClass, getFieldValidationState, showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import { logAccountActivity } from "@/lib/account-activity";
import { getLoginCaptchaState, refreshLoginCaptcha } from "@/lib/auth-captcha";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { clearAuthLockout, formatAuthLockoutMessage, getAuthLockoutState, maybeAutoHealAuthLockout, recordInvalidAuthAttempt, resetAuthLockoutForEmailChange } from "@/lib/auth-lockout";
import { logCaptchaTelemetry } from "@/lib/auth-captcha-telemetry";
import { isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";
import { getCanonicalAppOrigin } from "@/lib/canonical-origin";
import { PolicyLinksInline } from "@/components/PolicyLinksInline";
import { recordPolicyAcknowledgment } from "@/lib/policies";
import { loadConsent } from "@/lib/consent/manager";
import { reportValidationRejection } from "@/services/error-reporter.service";

export default function RegisterPage() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const redirectParam = searchParams.get("redirect");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dob, setDob] = useState(""); // ISO yyyy-mm-dd
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

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  // Parse DOB string for schema
  const dobParts = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    if (!m) return null;
    return { birthYear: Number(m[1]), birthMonth: Number(m[2]), birthDay: Number(m[3]) };
  })();

  // Real-time validation on change
  useEffect(() => {
    if (Object.keys(touched).length === 0) return;
    const payload = {
      firstName, lastName, email, password, confirmPassword,
      birthYear: dobParts?.birthYear ?? 1900,
      birthMonth: dobParts?.birthMonth ?? 1,
      birthDay: dobParts?.birthDay ?? 1,
      countryCode,
      guardianEmail,
      electronicCommsConsent,
      agreedToTerms,
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
      for (const [k, v] of Object.entries(fieldErrors)) {
        if (touched[k]) touchedErrors[k] = v;
      }
      setErrors(touchedErrors);
    } else {
      setErrors({});
    }
  }, [firstName, lastName, email, password, confirmPassword, dob, agreedToTerms, electronicCommsConsent, guardianEmail, touched, countryCode]);

  // Auto-heal stale device-side lockouts on mount (shared with LoginPage).
  useEffect(() => {
    maybeAutoHealAuthLockout();
    setLockoutState(getAuthLockoutState());
  }, []);

  // Switching emails = different account context; clear stale device counter.
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const currentLockout = getAuthLockoutState();
    setLockoutState(currentLockout);
    if (currentLockout.locked) {
      setAuthError(formatAuthLockoutMessage(currentLockout.remainingSeconds));
      return;
    }
    const allTouched: Record<string, boolean> = {
      firstName: true, lastName: true, email: true,
      password: true, confirmPassword: true, dob: true,
      agreedToTerms: true, electronicCommsConsent: true, guardianEmail: true,
    };
    setTouched(allTouched);

    const payload = {
      firstName, lastName, email, password, confirmPassword,
      birthYear: dobParts?.birthYear ?? 1900,
      birthMonth: dobParts?.birthMonth ?? 1,
      birthDay: dobParts?.birthDay ?? 1,
      countryCode,
      guardianEmail,
      electronicCommsConsent,
      agreedToTerms,
    };
    const result = registerSchema.safeParse(payload);
    if (!result.success) {
      reportValidationRejection("registerSchema", result.error.issues, "RegisterPage.handleSubmit");
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

    // Sanctions / export-control screening (T&C §19, ToU §17). Anonymous endpoint.
    if (countryCode) {
      try {
        const { data: sanctionsResult } = await supabase.functions.invoke("screen-sanctions", {
          body: { email: result.data.email, country_code: countryCode },
        });
        if (sanctionsResult?.decision === "deny") {
          setAuthError(
            "We're sorry — Tech Fleet cannot create accounts for users in this country due to U.S. export-control and sanctions laws.",
          );
          return;
        }
      } catch {
        // Fail-open on network errors (the screening row is still attempted server-side).
      }
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
      logCaptchaTelemetry("auth_captcha_failed", { surface: "register", failedAttempts: captchaState.failedAttempts + 1 });
      setCaptchaState(refreshLoginCaptcha());
      setCaptchaToken("");
      setCaptchaFailureCount((count) => count + 1);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      setAuthError(nextLockout.locked ? formatAuthLockoutMessage(nextLockout.remainingSeconds) : "Complete the human verification before trying again.");
      return;
    }

    setErrors({});
    setLoading(true);
    setAuthError("");

    try {
      const rateCheck = await RateLimitService.peek(result.data.email, "signup_attempt");
      if (!rateCheck.allowed) {
        const minutes = Math.max(1, Math.ceil(rateCheck.retry_after / 60));
        void logAccountActivity("signup_rate_limited", {
          email: result.data.email,
          details: { retryAfterSec: rateCheck.retry_after },
        });
        setAuthError(`Too many signup attempts for this email. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}, or sign in if you already have an account.`);
        setLoading(false);
        return;
      }

      await AuthService.signUp(
        result.data.email,
        result.data.password,
        result.data.firstName,
        result.data.lastName,
        getCanonicalAppOrigin() + (redirectParam ? redirectParam : "/profile-setup"),
        captchaToken,
        result.data.birthYear
      );
      // Server-side acknowledgment + electronic-comms consent (T&C §23, ToU §18, §19).
      await recordPolicyAcknowledgment("registration", {
        electronicCommsConsent: true,
      });
      clearAuthLockout();
      setSubmitted(true);
    } catch (err: any) {
      if (isAuthThrottleCaptchaError(err)) {
        logCaptchaTelemetry("auth_captcha_fetch_blocked", { surface: "register", reason: "client_auth_throttle_429" });
        setCaptchaState(refreshLoginCaptcha());
        setCaptchaToken("");
        setCaptchaFailureCount((count) => count + 1);
        setAuthError(err.message);
        setLoading(false);
        return;
      }
      // Account already exists — friendly UX, NOT an error. Don't consume
      // a rate-limit slot or bump the device lockout counter.
      if (err?.code === "ACCOUNT_EXISTS") {
        setAuthError("");
        setExistingAccountEmail(result.data.email);
        setLoading(false);
        return;
      }
      // Confirmed signup failure — record once on the server bucket.
      void RateLimitService.recordFailure(result.data.email, "signup_attempt").catch(() => {});
      setAuthError(err.message);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      lastFailedEmailRef.current = result.data.email.trim().toLowerCase();
      if (nextLockout.locked) setAuthError(formatAuthLockoutMessage(nextLockout.remainingSeconds));
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    setResending(true);
    setResendStatus("idle");
    setResendMessage("");

    try {
      if (!resendCaptchaToken.trim()) {
        logCaptchaTelemetry("auth_captcha_failed", { surface: "signup_confirmation_resend", failedAttempts: captchaState.failedAttempts + 1 });
        setResendCaptchaToken("");
        setResendCaptchaFailureCount((count) => count + 1);
        setResendStatus("error");
        setResendMessage("Complete the human verification before requesting another verification email.");
        return;
      }

      // Resend uses its own bucket so it never consumes signup attempts.
      const rateCheck = await RateLimitService.check(email, "signup_resend");
      if (!rateCheck.allowed) {
        const minutes = Math.ceil(rateCheck.retry_after / 60);
        setResendStatus("error");
        setResendMessage(`Please wait ${minutes} minute${minutes > 1 ? "s" : ""} before requesting another verification email.`);
        return;
      }

      await AuthService.resendSignupConfirmation(
        email,
        getCanonicalAppOrigin() + (redirectParam ? redirectParam : "/profile-setup"),
        resendCaptchaToken
      );
      setResendStatus("success");
      setResendMessage("If this email is still waiting for verification, a fresh link has been sent. Check your inbox and spam folder.");
    } catch (err: any) {
      setResendStatus("error");
      setResendMessage(err.message || "We could not resend the verification email right now. Please try again in a minute.");
    } finally {
      setResending(false);
    }
  };

  const vs = (field: string, value: string | boolean) =>
    getFieldValidationState(errors[field], value, !!touched[field]);
  const bc = (field: string, value: string | boolean) =>
    validationBorderClass(vs(field, value));

  if (submitted) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <CheckCircle2 className="h-16 w-16 text-success mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground leading-relaxed">
            If <strong className="text-foreground">{email}</strong> needs verification, a confirmation link is on the way. Existing verified accounts will not receive another signup email.
          </p>
          {resendMessage && (
            <p className={`mt-4 rounded-md p-3 text-sm ${resendStatus === "success" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`} role="status" aria-live="polite">
              {resendMessage}
            </p>
          )}
          <div className="mt-6 grid gap-3">
            <TurnstileChallenge action="signup_confirmation_resend" onTokenChange={setResendCaptchaToken} failureCount={resendCaptchaFailureCount} />
            <Button type="button" onClick={handleResendConfirmation} disabled={resending}>
              {resending ? "Sending verification…" : "Resend verification email"}
            </Button>
            <Link to="/login"><Button variant="outline" className="w-full">Go to sign in</Button></Link>
            <Link to="/forgot-password" className="text-sm text-primary-text font-medium hover:underline">Forgot your password?</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto mb-4 dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Join Tech Fleet</h1>
          <p className="text-muted-foreground mt-1">Create your account and start your journey</p>
        </div>

        <div className="card-elevated p-6 sm:p-8">
          {existingAccountEmail && (
            <div
              className="mb-4 p-4 rounded-md border border-primary/30 bg-primary/5 text-sm"
              role="status"
              aria-live="polite"
            >
              <h2 className="font-semibold text-foreground mb-1">You already have an account</h2>
              <p className="text-muted-foreground mb-3">
                An account already exists for <span className="font-medium text-foreground break-all">{existingAccountEmail}</span>. Sign in to continue, or reset your password if you've forgotten it.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button asChild className="w-full sm:w-auto">
                  <Link to={`/login?email=${encodeURIComponent(existingAccountEmail)}${redirectParam ? `&redirect=${encodeURIComponent(redirectParam)}` : ""}`}>
                    Sign in instead
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link to={`/forgot-password?email=${encodeURIComponent(existingAccountEmail)}`}>
                    Reset your password
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => { setExistingAccountEmail(null); setEmail(""); }}
                >
                  Use a different email
                </Button>
              </div>
            </div>
          )}
          {authError && !existingAccountEmail && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{authError}</div>
          )}

          <GoogleSignInButton
            label="Sign up with Google"
            redirectTo={redirectParam || "/dashboard"}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ValidatedField id="reg-firstName" label="First name" required error={errors.firstName} value={firstName} touched={touched.firstName}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="reg-firstName" type="text" placeholder="Jane" value={firstName} onChange={(e) => setFirstName(e.target.value)} onBlur={() => markTouched("firstName")} className={`pl-10 ${bc("firstName", firstName)}`} autoComplete="given-name" required aria-required="true" aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? "reg-firstName-error" : undefined} />
                </div>
              </ValidatedField>

              <ValidatedField id="reg-lastName" label="Last name" required error={errors.lastName} value={lastName} touched={touched.lastName}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="reg-lastName" type="text" placeholder="Doe" value={lastName} onChange={(e) => setLastName(e.target.value)} onBlur={() => markTouched("lastName")} className={`pl-10 ${bc("lastName", lastName)}`} autoComplete="family-name" required aria-required="true" aria-invalid={!!errors.lastName} aria-describedby={errors.lastName ? "reg-lastName-error" : undefined} />
                </div>
              </ValidatedField>
            </div>

            <ValidatedField id="reg-email" label="Email address" required error={errors.email} value={email} touched={touched.email}>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input id="reg-email" type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => markTouched("email")} className={`pl-10 ${bc("email", email)}`} autoComplete="email" required aria-required="true" aria-invalid={!!errors.email} aria-describedby={errors.email ? "reg-email-error" : undefined} />
              </div>
            </ValidatedField>

            <PasswordSetFields
              value={{ password, confirmPassword }}
              onChange={(next) => {
                setPassword(next.password);
                setConfirmPassword(next.confirmPassword);
              }}
              ids={{ password: "reg-password", confirmPassword: "reg-confirmPassword", requirements: "password-requirements" }}
              labels={{ password: "Password", confirmPassword: "Confirm password" }}
              placeholders={{ password: "Create a strong password", confirmPassword: "Re-enter your password" }}
              touched={{ password: touched.password, confirmPassword: touched.confirmPassword }}
              onBlur={(field) => markTouched(field)}
              errors={{ password: errors.password, confirmPassword: errors.confirmPassword }}
            />

            <ValidatedField id="reg-dob" label="Date of birth" required error={errors.dob} value={dob} touched={touched.dob}>
              <div className="relative">
                <Cake className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="reg-dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  onBlur={() => markTouched("dob")}
                  max={new Date().toISOString().slice(0, 10)}
                  min="1900-01-01"
                  className={`pl-10 ${bc("dob", dob)}`}
                  autoComplete="bday"
                  required
                  aria-required="true"
                  aria-invalid={!!errors.dob}
                  aria-describedby="dob-help"
                />
              </div>
              <p id="dob-help" className="text-xs text-muted-foreground mt-1">
                Tech Fleet is for ages 18+. Users 13–17 may join with a parent or guardian's consent (T&amp;C §2). We store the year only.
              </p>
            </ValidatedField>

            {(() => {
              const age = dobParts ? ageInYears(dobParts.birthYear, dobParts.birthMonth, dobParts.birthDay) : null;
              const needsGuardian = age !== null && age >= GUARDIAN_MIN_AGE && age < 18;
              if (!needsGuardian) return null;
              return (
                <ValidatedField id="reg-guardian" label="Parent or guardian email" required error={errors.guardianEmail} value={guardianEmail} touched={touched.guardianEmail}>
                  <div className="relative">
                    <ShieldAlert className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <Input id="reg-guardian" type="email" placeholder="parent@example.com" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} onBlur={() => markTouched("guardianEmail")} className={`pl-10 ${bc("guardianEmail", guardianEmail)}`} autoComplete="email" required aria-required="true" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    We will email your parent or guardian to confirm consent before your account is fully activated.
                  </p>
                </ValidatedField>
              );
            })()}

            <div className="flex items-start gap-2">
              <Checkbox id="comms" checked={electronicCommsConsent} onCheckedChange={(checked) => { setElectronicCommsConsent(checked === true); markTouched("electronicCommsConsent"); }} aria-required="true" aria-invalid={!!errors.electronicCommsConsent} />
              <Label htmlFor="comms" className="text-sm leading-relaxed">
                I agree to receive notices, account alerts, and other electronic communications by email (ToU §18).
              </Label>
            </div>
            {errors.electronicCommsConsent && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><span className="h-3 w-3 shrink-0">⚠</span> {errors.electronicCommsConsent}</p>}

            <div className="flex items-start gap-2">
              <Checkbox id="terms" checked={agreedToTerms} onCheckedChange={(checked) => { setAgreedToTerms(checked === true); markTouched("agreedToTerms"); }} aria-required="true" aria-invalid={!!errors.agreedToTerms} />
              <Label htmlFor="terms" className="text-sm leading-relaxed">
                I have read and agree to the <PolicyLinksInline />.
              </Label>
            </div>
            {errors.agreedToTerms && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><span className="h-3 w-3 shrink-0">⚠</span> {errors.agreedToTerms}</p>}

            <TurnstileChallenge action="register" onTokenChange={setCaptchaToken} failureCount={captchaFailureCount} />

            <Button type="submit" className="w-full" disabled={loading || lockoutState.locked} aria-describedby={lockoutState.locked ? "register-lockout-status" : undefined}>
              {loading ? "Creating account…" : lockoutState.locked ? `Try again in ${lockoutState.remainingSeconds}s` : "Create account"}
            </Button>
            {lockoutState.locked && <p id="register-lockout-status" className="text-sm text-muted-foreground text-center" aria-live="polite">{formatAuthLockoutMessage(lockoutState.remainingSeconds)}</p>}
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to={redirectParam ? `/login?redirect=${encodeURIComponent(redirectParam)}` : "/login"} className="text-primary-text font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
