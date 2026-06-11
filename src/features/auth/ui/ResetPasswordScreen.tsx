/**
 * ResetPasswordScreen — presentation only. State + recovery-session
 * invariants live in useResetPasswordEngine. Visual contract preserved
 * 1:1 from legacy ResetPasswordPage.
 */
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { PasswordSetFields } from "@/components/auth/PasswordSetFields";
import { useResetPasswordEngine, MAX_REJECTIONS } from "@/features/auth/engine/use-reset-password-engine";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";

export default function ResetPasswordScreen() {
  const e = useResetPasswordEngine();

  if (e.success) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-4">
          <CheckCircle2 className="h-16 w-16 text-success mx-auto" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Password updated</h1>
          <p className="text-muted-foreground">
            You're signed in on this device. Use your new password the next time you sign in.
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={e.goToDashboard} className="w-full">
              Go to dashboard
            </Button>
            {!e.otherDevicesRevoked && (
              <button
                type="button"
                onClick={e.handleRetryRevoke}
                disabled={e.retryingRevoke}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {e.retryingRevoke ? "Signing out other devices…" : "Sign out other devices manually"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (e.checking) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <div className="h-8 w-8 mx-auto mb-4 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-muted-foreground">Verifying your reset link…</p>
        </div>
      </div>
    );
  }

  if (e.awaitingUserGesture) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-5">
          <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Continue resetting your password</h1>
          <p className="text-muted-foreground">
            For your safety, we wait for you to confirm before we activate this reset link. Tap continue and we'll take you straight to the new-password screen.
          </p>
          <Button onClick={e.handleContinueGesture} disabled={e.verifyingToken} className="w-full">
            {e.verifyingToken ? "One moment…" : "Continue resetting password"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Didn't request this? You can safely close this page — your password stays the same.
          </p>
        </div>
      </div>
    );
  }

  if (!e.validRecovery) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {e.linkExpired ? "This reset link can't be used" : "Invalid or expired link"}
          </h1>
          <p className="text-muted-foreground mb-4">
            {e.linkExpired
              ? "This reset link has already been used or has expired. For your safety each link only works once. Request a fresh one and we'll get you back in."
              : "This password reset link is invalid or has expired."}
          </p>
          <Link to="/forgot-password"><Button variant="outline">Send a new reset link</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto mb-4 dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Set your new password</h1>
        </div>

        <div className="card-elevated p-6 sm:p-8">
          {e.formLocked ? (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">
                We couldn't accept that password after several tries. To keep your account safe, request a fresh reset link and try again.
              </div>
              <Link to="/forgot-password" className="block">
                <Button variant="outline" className="w-full">Request a new reset link</Button>
              </Link>
            </div>
          ) : (
            <>
              {e.error && (
                <div
                  className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
                  role="alert"
                  data-error-code={e.errorCode || undefined}
                >
                  {e.error}
                  {e.attempts > 0 && e.attempts < MAX_REJECTIONS && (
                    <div className="mt-1 text-xs opacity-80">
                      {MAX_REJECTIONS - e.attempts} {MAX_REJECTIONS - e.attempts === 1 ? "attempt" : "attempts"} remaining before you'll need a new link.
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={e.handleSubmit} className="space-y-4" noValidate>
                <PasswordSetFields
                  value={e.passwordSet}
                  onChange={(next) => { e.setPasswordSet(next); e.setError(""); e.setErrorCode(""); }}
                  touched={e.touched}
                  onBlur={(field) => e.markTouched(field as "password" | "confirmPassword")}
                  username={e.recoveryEmail ?? undefined}
                />

                <Button type="submit" className="w-full" disabled={e.loading || !e.passwordValidation.isValid}>
                  {e.loading ? "Updating…" : "Update password"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
