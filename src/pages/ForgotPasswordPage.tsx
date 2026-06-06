import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2 } from "lucide-react";
import { AuthService, GOOGLE_ONLY_ACCOUNT_CODE, GOOGLE_ONLY_ACCOUNT_MESSAGE } from "@/services/auth.service";
import { RateLimitService } from "@/services/rate-limit.service";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { emailInputSchema } from "@/lib/validators/auth";
import { getLoginCaptchaState, refreshLoginCaptcha } from "@/lib/auth-captcha";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { clearAuthLockout, formatAuthLockoutMessage, getAuthLockoutState, recordInvalidAuthAttempt } from "@/lib/auth-lockout";
import { logCaptchaTelemetry } from "@/lib/auth-captcha-telemetry";
import { isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";
import { getCanonicalAppOrigin } from "@/lib/canonical-origin";
import { reportValidationRejection } from "@/services/error-reporter.service";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [captchaState, setCaptchaState] = useState(() => getLoginCaptchaState());
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaFailureCount, setCaptchaFailureCount] = useState(0);
  const [lockoutState, setLockoutState] = useState(() => getAuthLockoutState());
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

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
      setError(formatAuthLockoutMessage(currentLockout.remainingSeconds));
      return;
    }
    const result = emailInputSchema.safeParse(email);
    if (!result.success) {
      reportValidationRejection("emailInputSchema", result.error.issues, "ForgotPasswordPage.handleSubmit");
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
      setCaptchaFailureCount((count) => count + 1);
      const nextLockout = recordInvalidAuthAttempt();
      setLockoutState(nextLockout);
      setError(nextLockout.locked ? formatAuthLockoutMessage(nextLockout.remainingSeconds) : "Complete the human verification before trying again.");
      return;
    }
    setError("");
    setLoading(true);

    try {
      // Peek (read-only) — never increments on a happy-path submit. We only
      // record a failure if Supabase confirms a real rejection below. Mirrors
      // the login/signup fairness fix (LCL-RL-001..009) — previously every
      // click of "Send reset link" burned 1 of 3 attempts, blocking real
      // users for 60 minutes after a few harmless retries.
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
      if (code === GOOGLE_ONLY_ACCOUNT_CODE) {
        setError(GOOGLE_ONLY_ACCOUNT_MESSAGE);
        return;
      }
      if (isAuthThrottleCaptchaError(err)) {
        logCaptchaTelemetry("auth_captcha_fetch_blocked", { surface: "forgot_password", reason: "client_auth_throttle_429" });
        setCaptchaState(refreshLoginCaptcha());
        setCaptchaToken("");
        setCaptchaFailureCount((count) => count + 1);
        setError(err.message);
        return;
      }
      // Confirmed send failure → record so abusive loops still get capped.
      void RateLimitService.recordFailure(result.data, "password_reset");
      // Always show success to prevent email enumeration
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <CheckCircle2 className="h-16 w-16 text-success mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground">
            If an account exists with that email, we've sent a password reset link.
          </p>
          <Link to="/login" className="inline-block mt-6"><Button variant="outline">Back to sign in</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto mb-4 dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Reset your password</h1>
          <p className="text-muted-foreground mt-1">Enter your email and we'll send you a reset link</p>
        </div>

        <div className="card-elevated p-6 sm:p-8">
          {error && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input id="email" type="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" autoComplete="email" required aria-required="true" aria-invalid={!!error} />
              </div>
            </div>

            <TurnstileChallenge action="forgot_password" onTokenChange={setCaptchaToken} failureCount={captchaFailureCount} />

            <Button type="submit" className="w-full" disabled={loading || lockoutState.locked} aria-describedby={lockoutState.locked ? "forgot-password-lockout-status" : undefined}>
              {loading ? "Sending reset link…" : lockoutState.locked ? `Try again in ${lockoutState.remainingSeconds}s` : "Send reset link"}
            </Button>
            {lockoutState.locked && <p id="forgot-password-lockout-status" className="text-sm text-muted-foreground text-center" aria-live="polite">{formatAuthLockoutMessage(lockoutState.remainingSeconds)}</p>}
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <Link to="/login" className="text-primary-text font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
