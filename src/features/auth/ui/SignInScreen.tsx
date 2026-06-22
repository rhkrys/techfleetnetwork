/**
 * SignInScreen — presentation only. All state lives in `useSignInEngine`.
 * Replaces the 568-line LoginPage. Visual contract preserved 1:1.
 */
import { Suspense, lazy, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";

import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedField } from "@/components/ui/validated-field";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { PolicyLinksInline } from "@/components/PolicyLinksInline";
import { MfaChallengeDialog } from "@/components/MfaChallengeDialog";
import { AuthErrorMessage } from "@/features/auth/ui/AuthErrorMessage";
import { useSignInEngine } from "@/features/auth/engine/use-sign-in-engine";
import { recordPolicyAcknowledgment } from "@/lib/policies";
import { validationBorderClass, getFieldValidationState } from "@/lib/form-validation";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";

const TurnstileCaptchaAdapter = lazy(() =>
  import("@/features/auth/adapters/turnstile-captcha.adapter").then((m) => ({ default: m.TurnstileCaptchaAdapter })),
);

export default function SignInScreen() {
  const e = useSignInEngine();
  const bc = (field: string, value: string) =>
    validationBorderClass(getFieldValidationState(e.errors[field], value, !!e.touched[field]));

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <img src={techFleetLogo} alt="" width={48} height={48} decoding="async" className="h-12 w-12 mx-auto mb-4 dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-muted-foreground mt-1">Sign in to your Tech Fleet account</p>
        </div>

        <div className="card-elevated p-6 sm:p-8">
          {e.authError && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">
              <p>{e.authError}</p>
              <p className="mt-2 text-xs text-destructive/80">
                <Link to="/forgot-password" className="underline hover:no-underline">Reset password</Link>
                <span className="mx-2" aria-hidden="true">·</span>
                <button type="button" onClick={e.refreshCaptcha} className="underline hover:no-underline">Refresh verification</button>
                <span className="mx-2" aria-hidden="true">·</span>
                <span>Signed up with Google? Use the button above.</span>
              </p>
            </div>
          )}

          {e.typedAuthError && !e.authError && (
            <AuthErrorMessage error={e.typedAuthError} className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" />
          )}

          {e.oauthHint?.has_google && !e.oauthHint.has_password && (
            <div className="mb-4 p-3 rounded-md border border-primary/30 bg-primary/10 text-sm" role="status" aria-live="polite">
              <p className="font-semibold text-foreground">This account uses Google sign-in</p>
              <p className="mt-1 text-muted-foreground">Use <strong>Continue with Google</strong> above to sign in. Your password attempt won't be counted.</p>
            </div>
          )}

          {e.redirectTarget !== "/dashboard" && (
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-foreground" role="status" aria-live="polite">
              <p className="font-semibold">Sign in to continue</p>
              <p className="mt-1 text-muted-foreground">After sign-in, we'll take you back to the page you were trying to open.</p>
            </div>
          )}

          <GoogleSignInButton
            redirectTo={e.redirectTarget}
            onBeforeSubmit={() => { recordPolicyAcknowledgment("google-oauth"); return true; }}
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

          <form onSubmit={e.handleSubmit} className="space-y-5 mt-4" noValidate>
            <ValidatedField id="email" label="Email address" required error={e.errors.email} value={e.email} touched={e.touched.email}>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={e.emailRef}
                  id="email" type="email" inputMode="email" placeholder="you@example.com"
                  value={e.email}
                  onChange={(ev) => e.setEmail(ev.target.value)}
                  onAnimationStart={(ev) => {
                    if ((ev as unknown as { animationName: string }).animationName === "onAutoFillStart" && e.emailRef.current && e.emailRef.current.value !== e.email) e.setEmail(e.emailRef.current.value);
                  }}
                  onFocus={e.armTurnstile}
                  onBlur={() => e.markTouched("email")}
                  className={`pl-10 ${bc("email", e.email)}`}
                  autoComplete="email" required aria-required="true" aria-invalid={!!e.errors.email}
                />
              </div>
            </ValidatedField>

            <ValidatedField id="password" label="Password" required error={e.errors.password} value={e.password} touched={e.touched.password}>
              <div className="flex items-center justify-between mb-1.5">
                <span />
                <Link to="/forgot-password" className="text-xs text-primary-text hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  ref={e.passwordRef}
                  id="password" type={e.showPassword ? "text" : "password"} placeholder="••••••••"
                  value={e.password}
                  onChange={(ev) => e.setPassword(ev.target.value)}
                  onAnimationStart={(ev) => {
                    if ((ev as unknown as { animationName: string }).animationName === "onAutoFillStart" && e.passwordRef.current && e.passwordRef.current.value !== e.password) e.setPassword(e.passwordRef.current.value);
                  }}
                  onBlur={() => e.markTouched("password")}
                  className={`pl-10 pr-10 ${bc("password", e.password)}`}
                  autoComplete="current-password" required aria-required="true" aria-invalid={!!e.errors.password}
                />
                <button type="button" onClick={() => e.setShowPassword(!e.showPassword)} className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={e.showPassword ? "Hide password" : "Show password"}>
                  {e.showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </ValidatedField>

            <div style={{ minHeight: 78 }} onFocusCapture={e.armTurnstile}>
              {e.turnstileReady ? (
                <Suspense fallback={<div style={{ height: 78 }} aria-hidden="true" />}>
                  <TurnstileCaptchaAdapter action="login" onToken={e.setCaptchaToken} failureCount={e.captchaFailureCount} softResetCount={e.captchaSoftResetCount} email={e.email} />
                </Suspense>
              ) : (
                <div style={{ height: 78 }} aria-hidden="true" />
              )}
            </div>
            {e.captchaNotice && !e.authError && (
              <p className="-mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">{e.captchaNotice}</p>
            )}

            <Button type="submit" className="w-full" disabled={e.loading || e.lockoutState.locked} aria-describedby={e.lockoutState.locked ? "login-lockout-status" : undefined}>
              {e.loading ? "Signing in…" : e.lockoutState.locked ? `Try again in ${e.lockoutState.remainingSeconds}s` : "Sign in"}
            </Button>
            {e.lockoutState.locked && <p id="login-lockout-status" className="text-sm text-muted-foreground text-center" aria-live="polite">{e.formatLockoutMessage(e.lockoutState.remainingSeconds)}</p>}
            {e.redirectTarget !== "/dashboard" && (
              <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground" aria-live="polite">
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> Your destination is saved.
              </p>
            )}
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          New member?{" "}
          <Link to={e.redirectTarget !== "/dashboard" ? `/register?redirect=${encodeURIComponent(e.redirectTarget)}` : "/register"} className="text-primary-text font-medium hover:underline">Sign up</Link>
        </p>
      </div>

      <MfaChallengeDialog open={e.mfaOpen} onSuccess={e.onMfaSuccess} onCancel={e.onMfaCancel} />
    </div>
  );
}
