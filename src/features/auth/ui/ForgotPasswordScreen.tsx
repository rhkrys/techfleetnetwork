/**
 * ForgotPasswordScreen — presentation only. State lives in
 * useForgotPasswordEngine. Visual contract preserved 1:1 from legacy
 * ForgotPasswordPage.
 */
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2 } from "lucide-react";
import { TurnstileCaptchaAdapter } from "@/features/auth/adapters/turnstile-captcha.adapter";
import { useForgotPasswordEngine } from "@/features/auth/engine/use-forgot-password-engine";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";

export default function ForgotPasswordScreen() {
  const e = useForgotPasswordEngine();

  if (e.submitted) {
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
          {e.error && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{e.error}</div>
          )}

          <form onSubmit={e.handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={e.email}
                  onChange={(ev) => e.setEmail(ev.target.value)}
                  className="pl-10"
                  autoComplete="email"
                  required
                  aria-required="true"
                  aria-invalid={!!e.error}
                />
              </div>
            </div>

            <TurnstileCaptchaAdapter
              action="forgot_password"
              onToken={e.setCaptchaToken}
              failureCount={e.captchaFailureCount}
              softResetCount={e.captchaSoftResetCount}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={e.loading || e.lockoutState.locked}
              aria-describedby={e.lockoutState.locked ? "forgot-password-lockout-status" : undefined}
            >
              {e.loading
                ? "Sending reset link…"
                : e.lockoutState.locked
                  ? `Try again in ${e.lockoutState.remainingSeconds}s`
                  : "Send reset link"}
            </Button>
            {e.lockoutState.locked && (
              <p id="forgot-password-lockout-status" className="text-sm text-muted-foreground text-center" aria-live="polite">
                {e.formatLockoutMessage(e.lockoutState.remainingSeconds)}
              </p>
            )}
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
