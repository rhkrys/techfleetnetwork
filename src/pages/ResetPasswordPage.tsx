import { useState, useEffect, useRef, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { AuthService } from "@/services/auth.service";
import { supabase } from "@/integrations/supabase/client";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { reportValidationRejection } from "@/services/error-reporter.service";
import { PasswordSetFields } from "@/components/auth/PasswordSetFields";
import { validatePasswordSet } from "@/lib/auth/password-set";
import { clearAuthLockout } from "@/lib/auth-lockout";

// Hard cap on rejected submits before we stop the user from hammering
// the form. Lifts only when they explicitly request a new reset link.
const MAX_REJECTIONS = 3;
const RESET_ATTEMPTS_KEY = "tfn:reset-attempts";

function readAttempts(): number {
  try {
    const raw = window.sessionStorage.getItem(RESET_ATTEMPTS_KEY);
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  } catch {
    return 0;
  }
}
function writeAttempts(n: number) {
  try { window.sessionStorage.setItem(RESET_ATTEMPTS_KEY, String(n)); } catch { /* noop */ }
}
function clearAttempts() {
  try { window.sessionStorage.removeItem(RESET_ATTEMPTS_KEY); } catch { /* noop */ }
}

export default function ResetPasswordPage() {
  const [passwordSet, setPasswordSet] = useState({ password: "", confirmPassword: "" });
  const [touched, setTouched] = useState({ password: false, confirmPassword: false });
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string>("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validRecovery, setValidRecovery] = useState(false);
  const [checking, setChecking] = useState(true);
  const [attempts, setAttempts] = useState<number>(() => readAttempts());
  const [linkExpired, setLinkExpired] = useState(false);
  const navigate = useNavigate();
  const recoveredRef = useRef(false);

  useEffect(() => {
    let settled = false;

    // Severity-tagged diagnostics so a future failure surfaces the exact
    // branch in audit_log without reaching Triage (severity:info).
    const recordSettle = (branch: string, ok: boolean) => {
      try {
        supabase.rpc("write_audit_log", {
          p_event_type: ok ? `reset_settle_${branch}_ok` : `reset_settle_${branch}_fail`,
          p_table_name: "auth.users",
          p_record_id: null,
          p_user_id: null,
          p_changed_fields: [
            "severity:info",
            `path:${window.location.pathname}`,
            `has_hash:${Boolean(window.location.hash)}`,
          ],
          p_error_message: null,
        });
      } catch { /* diagnostics must never block recovery */ }
    };

    const settle = (valid: boolean, branch: string) => {
      if (settled) return;
      settled = true;
      recordSettle(branch, valid);
      setValidRecovery(valid);
      setChecking(false);
      if (valid) {
        // Member proved identity via the email link — wipe any stale device
        // lockout from prior login attempts and any prior failed-reset cap.
        clearAuthLockout();
        clearAttempts();
        setAttempts(0);
        recoveredRef.current = true;
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        settle(true, "session");
      }
    });

    const url = new URL(window.location.href);
    const hash = window.location.hash;
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const typeParam = url.searchParams.get("type");
    const hasRecoveryInHash = hash.includes("type=recovery");
    const hasTokenHashRecovery = Boolean(tokenHash) && typeParam === "recovery";
    const hasRecoveryInQuery = typeParam === "recovery" || Boolean(code);

    const stripSensitiveParams = () => {
      try {
        const clean = new URL(window.location.href);
        ["token_hash", "type", "code", "access_token", "refresh_token", "expires_in", "expires_at", "token_type"].forEach((k) => clean.searchParams.delete(k));
        const newUrl = clean.pathname + (clean.search ? clean.search : "") + (clean.hash && !clean.hash.includes("access_token") && !clean.hash.includes("type=recovery") ? clean.hash : "");
        window.history.replaceState({}, "", newUrl);
      } catch { /* noop */ }
    };

    const settleFromSession = (branch: string = "invalid") => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        settle(!!session, session ? "session" : branch);
      }).catch(() => settle(false, branch));
    };

    // PRIMARY: token_hash recovery link (new format from auth-email-hook,
    // AUTH-RESET-020). verifyOtp is idempotent until the OTP is consumed or
    // expires, so cross-device / incognito / second-click all work.
    if (hasTokenHashRecovery) {
      supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash! })
        .then(({ error }) => {
          if (error) {
            stripSensitiveParams();
            settleFromSession("token_hash_invalid");
          } else {
            stripSensitiveParams();
            settle(true, "token_hash");
          }
        })
        .catch(() => settleFromSession("token_hash_invalid"));
    } else if (!hasRecoveryInHash && !hasRecoveryInQuery) {
      settleFromSession("no_params");
    } else if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
      supabase.auth.exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) settleFromSession("code_invalid");
          else { stripSensitiveParams(); settle(true, "code"); }
        })
        .catch(() => settleFromSession("code_invalid"));
    } else {
      // Legacy `#access_token=…&refresh_token=…&type=recovery` hash fallback.
      // With detectSessionInUrl disabled, the SDK will no longer consume this
      // automatically, so the page must install the recovery session itself.
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (hasRecoveryInHash && accessToken && refreshToken) {
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ error }) => {
            if (error) settleFromSession("hash_invalid");
            else { stripSensitiveParams(); settle(true, "hash"); }
          })
          .catch(() => settleFromSession("hash_invalid"));

        return () => subscription.unsubscribe();
      }

      // If the hash is incomplete, give any already-running auth state change a
      // short chance to settle before showing the expired-link branch.
      const timeout = setTimeout(async () => {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session) { stripSensitiveParams(); return settle(true, "hash"); }
        } catch { /* fall through */ }
        settle(false, "timeout");
      }, 8000);
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
    // Redirect with marker so LoginPage knows to fully clear any
    // residual device lockout — see AUTH-RESET-005.
    const t = setTimeout(() => navigate("/dashboard?from=password-reset", { replace: true }), 4000);
    return () => clearTimeout(t);
  }, [success, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });
    const validation = validatePasswordSet(passwordSet);
    if (!validation.isValid) {
      reportValidationRejection("passwordSet", [{ message: validation.passwordError || validation.confirmError, path: [validation.passwordError ? "password" : "confirmPassword"] }], "ResetPasswordPage.handleSubmit");
      setError(validation.passwordError || validation.confirmError);
      setErrorCode("weak_password_client");
      return;
    }
    if (attempts >= MAX_REJECTIONS) return;

    setError("");
    setErrorCode("");
    setLoading(true);

    try {
      const { otherDevicesRevoked: revoked } = await AuthService.updatePassword(passwordSet);
      setOtherDevicesRevoked(revoked);
      clearAttempts();
      clearAuthLockout();
      setSuccess(true);
    } catch (err) {
      const e = err as Error & { code?: string };
      const code = e.code || "unknown";

      if (code === "session_expired") {
        // The recovery session lapsed mid-form. Don't punish the user —
        // route them to request a new link.
        setLinkExpired(true);
        setValidRecovery(false);
        return;
      }

      setErrorCode(code);
      setError(e.message);

      // AUTH-PIN-001: service_unavailable means the edge function itself
      // is unreachable (404 / network). Do NOT count it as a rejected
      // attempt — the user's password and recovery session are still fine.
      if (code === "service_unavailable") {
        return;
      }

      // Only count server-side auth-layer rejections (same_password,
      // weak_password, rate_limited, unknown). Client-side weak-password
      // checks already block submission above.
      if (code === "same_password" || code === "weak_password" || code === "unknown" || code === "rate_limited") {
        const next = attempts + 1;
        setAttempts(next);
        writeAttempts(next);
      }

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
  const formLocked = attempts >= MAX_REJECTIONS;

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
            <Button onClick={() => navigate("/dashboard?from=password-reset", { replace: true })} className="w-full">
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
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {linkExpired ? "Reset link expired" : "Invalid or expired link"}
          </h1>
          <p className="text-muted-foreground mb-4">
            {linkExpired
              ? "Your reset link expired before we could save your new password. Request a fresh one and try again."
              : "This password reset link is invalid or has expired."}
          </p>
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
          {formLocked ? (
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
              {error && (
                <div
                  className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
                  role="alert"
                  data-error-code={errorCode || undefined}
                >
                  {error}
                  {attempts > 0 && attempts < MAX_REJECTIONS && (
                    <div className="mt-1 text-xs opacity-80">
                      {MAX_REJECTIONS - attempts} {MAX_REJECTIONS - attempts === 1 ? "attempt" : "attempts"} remaining before you'll need a new link.
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <PasswordSetFields
                  value={passwordSet}
                  onChange={(next) => { setPasswordSet(next); setError(""); setErrorCode(""); }}
                  touched={touched}
                  onBlur={(field) => setTouched((current) => ({ ...current, [field]: true }))}
                />

                <Button type="submit" className="w-full" disabled={loading || !passwordValidation.isValid}>
                  {loading ? "Updating…" : "Update password"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
