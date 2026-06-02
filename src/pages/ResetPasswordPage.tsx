import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { AuthService } from "@/services/auth.service";
import { supabase } from "@/integrations/supabase/client";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { reportValidationRejection } from "@/services/error-reporter.service";
import { PasswordSetFields } from "@/components/auth/PasswordSetFields";
import { validatePasswordSet } from "@/lib/auth/password-set";

export default function ResetPasswordPage() {
  const [passwordSet, setPasswordSet] = useState({ password: "", confirmPassword: "" });
  const [touched, setTouched] = useState({ password: false, confirmPassword: false });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validRecovery, setValidRecovery] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let settled = false;
    const settle = (valid: boolean) => {
      if (settled) return;
      settled = true;
      setValidRecovery(valid);
      setChecking(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settle(true);
      }
    });

    const url = new URL(window.location.href);
    const hash = window.location.hash;
    const code = url.searchParams.get("code");
    const hasRecoveryInHash = hash.includes("type=recovery");
    const hasRecoveryInQuery = url.searchParams.get("type") === "recovery" || Boolean(code);

    const settleFromSession = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        settle(!!session);
      }).catch(() => settle(false));
    };

    if (!hasRecoveryInHash && !hasRecoveryInQuery) {
      // No recovery hash — check for an existing session (link may have already been consumed)
      settleFromSession();
    } else if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
      supabase.auth.exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) settleFromSession();
          else settle(true);
        })
        .catch(settleFromSession);
    } else {
      // Hash is present — Supabase SDK will process it asynchronously.
      // Wait up to 5s for the PASSWORD_RECOVERY event before giving up.
      const timeout = setTimeout(() => {
        settleFromSession();
      }, 5000);
      return () => {
        clearTimeout(timeout);
        subscription.unsubscribe();
      };
    }

    return () => subscription.unsubscribe();
  }, []);

  const [otherDevicesRevoked, setOtherDevicesRevoked] = useState(true);
  const [retryingRevoke, setRetryingRevoke] = useState(false);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => navigate("/dashboard", { replace: true }), 4000);
    return () => clearTimeout(t);
  }, [success, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });
    const validation = validatePasswordSet(passwordSet);
    if (!validation.isValid) {
      reportValidationRejection("passwordSet", [{ message: validation.passwordError || validation.confirmError, path: [validation.passwordError ? "password" : "confirmPassword"] }], "ResetPasswordPage.handleSubmit");
      setError(validation.passwordError || validation.confirmError);
      return;
    }
    setError("");
    setLoading(true);

    try {
      const { otherDevicesRevoked: revoked } = await AuthService.updatePassword(passwordSet);
      setOtherDevicesRevoked(revoked);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetryRevoke = async () => {
    setRetryingRevoke(true);
    try {
      const { revocationRecorded } = await AuthService.signOutAllDevices({
        keepCurrent: true,
        reason: "self_password_changed",
      });
      setOtherDevicesRevoked(revocationRecorded);
    } finally {
      setRetryingRevoke(false);
    }
  };

  const passwordValidation = validatePasswordSet(passwordSet);

  if (success) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-4">
          <CheckCircle2 className="h-16 w-16 text-success mx-auto" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Password updated</h1>
          <p className="text-muted-foreground">
            You're signed in on this device. Use your new password the next time you sign in.
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => navigate("/dashboard", { replace: true })} className="w-full">
              Go to dashboard
            </Button>
            {!otherDevicesRevoked && (
              <button
                type="button"
                onClick={handleRetryRevoke}
                disabled={retryingRevoke}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                {retryingRevoke ? "Signing out other devices…" : "Sign out other devices manually"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <div className="h-8 w-8 mx-auto mb-4 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-muted-foreground">Verifying your reset link…</p>
        </div>
      </div>
    );
  }

  if (!validRecovery) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Invalid or expired link</h1>
          <p className="text-muted-foreground mb-4">This password reset link is invalid or has expired.</p>
          <Link to="/forgot-password"><Button variant="outline">Request a new link</Button></Link>
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
          {error && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <PasswordSetFields
              value={passwordSet}
              onChange={(next) => { setPasswordSet(next); setError(""); }}
              touched={touched}
              onBlur={(field) => setTouched((current) => ({ ...current, [field]: true }))}
            />

            <Button type="submit" className="w-full" disabled={loading || !passwordValidation.isValid}>
              {loading ? "Updating…" : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
