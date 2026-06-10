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
import { recordResetTelemetry, type ResetBranch, type ResetOutcome } from "@/lib/auth/reset-telemetry";

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

/**
 * HARD RECOVERY-SESSION INVARIANT (AUTH-RESET-SESSION-003):
 *
 * The password form must NEVER render unless we hold an active Supabase
 * session that was produced by a fresh recovery proof. Earlier code
 * treated "no error" from verifyOtp/exchangeCodeForSession/setSession as
 * sufficient — but those can succeed without returning a usable session
 * (SDK quirks, partial PKCE state), which left `updateUser()` with no
 * JWT and the user with a misleading "service unavailable" toast.
 *
 * The page now verifies that `getUser()` returns a real user after the
 * proof completes; otherwise we route to the expired-link branch and
 * never reveal the form.
 */
async function confirmActiveRecoverySession(): Promise<{ ok: boolean; email: string | null }> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { ok: false, email: null };
    return { ok: Boolean(data?.user?.id), email: data?.user?.email ?? null };
  } catch {
    return { ok: false, email: null };
  }
}

/**
 * Tell the browser + password manager that this credential is now valid.
 * This is the W3C Credential Management API call that Chrome/Edge/Opera/
 * Samsung Internet + 1Password/Bitwarden/Dashlane/LastPass listen for to
 * UPDATE the saved password in place. Without it, password managers keep
 * autofilling the old password on next login → "invalid credentials" →
 * the member resets again → infinite loop. Safari/Firefox ignore this
 * call harmlessly (they pick up the credential from the hidden username
 * + new-password form fields on submit).
 */
async function storeCredentialInBrowser(email: string | null, password: string): Promise<void> {
  if (!email) return;
  try {
    const w = window as unknown as { PasswordCredential?: new (init: { id: string; password: string; name?: string }) => Credential };
    if (typeof navigator === "undefined" || !("credentials" in navigator) || !w.PasswordCredential) return;
    const cred = new w.PasswordCredential({ id: email, password, name: email });
    await (navigator.credentials as unknown as { store: (c: Credential) => Promise<void> }).store(cred);
  } catch {
    /* non-fatal — the hidden username + new-password form still triggers the native save prompt */
  }
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
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  // AUTH-RESET-PREFETCH-001 (v2): the page itself is the prefetch gate.
  // When the URL carries ?token_hash=...&type=recovery and we don't yet
  // hold a session, we wait for an explicit user click before calling
  // verifyOtp — link prefetchers (Outlook SafeLinks, Proofpoint, Slack/
  // iMessage unfurlers, AV scanners) issue automated GETs that would
  // otherwise burn the single-use token before the human ever sees it.
  // Folding the gate into /reset-password (instead of a /reset-password/
  // confirm subroute) keeps the email URL valid across every historical
  // deploy — an unpublished route can never strand users on a 404.
  const [awaitingUserGesture, setAwaitingUserGesture] = useState(false);
  const [pendingTokenHash, setPendingTokenHash] = useState<string | null>(null);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const navigate = useNavigate();
  const recoveredRef = useRef(false);
  const settledRef = useRef(false);

  const stripSensitiveParams = () => {
    try {
      const clean = new URL(window.location.href);
      ["token_hash", "type", "code", "access_token", "refresh_token", "expires_in", "expires_at", "token_type"].forEach((k) => clean.searchParams.delete(k));
      const newUrl = clean.pathname + (clean.search ? clean.search : "") + (clean.hash && !clean.hash.includes("access_token") && !clean.hash.includes("type=recovery") ? clean.hash : "");
      window.history.replaceState({}, "", newUrl);
    } catch { /* noop */ }
  };

  const settleValid = async (branch: ResetBranch, outcome: ResetOutcome, shape: { has_token_hash?: boolean; has_code?: boolean; has_hash?: boolean }) => {
    if (settledRef.current) return;
    const session = await confirmActiveRecoverySession();
    if (!session.ok) {
      settledRef.current = true;
      recordResetTelemetry({ branch, outcome: "no_session_returned", ...shape });
      setValidRecovery(false);
      setChecking(false);
      return;
    }
    settledRef.current = true;
    setRecoveryEmail(session.email);
    recordResetTelemetry({ branch, outcome, ...shape });
    setValidRecovery(true);
    setChecking(false);
    clearAuthLockout();
    clearAttempts();
    setAttempts(0);
    recoveredRef.current = true;
  };

  const settleInvalid = (branch: ResetBranch, outcome: ResetOutcome, shape: { has_token_hash?: boolean; has_code?: boolean; has_hash?: boolean }) => {
    if (settledRef.current) return;
    settledRef.current = true;
    recordResetTelemetry({ branch, outcome, ...shape });
    setValidRecovery(false);
    setChecking(false);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = window.location.hash;
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const typeParam = url.searchParams.get("type");
    const hasRecoveryInHash = hash.includes("type=recovery");
    const hasTokenHashRecovery = Boolean(tokenHash) && typeParam === "recovery";
    const hasRecoveryInQuery = typeParam === "recovery" || Boolean(code);
    const shape = {
      has_token_hash: Boolean(tokenHash),
      has_code: Boolean(code),
      has_hash: Boolean(hash),
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        void settleValid("session_event", "ok", shape);
      }
    });

    if (hasTokenHashRecovery) {
      // PREFETCH GATE: never verifyOtp without a real user gesture.
      // If we already hold a session (browser back from form, double-click),
      // accept it. Otherwise render the Continue button and stop.
      (async () => {
        const session = await confirmActiveRecoverySession();
        if (session.ok) {
          stripSensitiveParams();
          void settleValid("token_hash", "ok", shape);
          return;
        }
        recordResetTelemetry({ branch: "no_params", outcome: "ok", ...shape });
        setPendingTokenHash(tokenHash);
        setAwaitingUserGesture(true);
        setChecking(false);
      })();
    } else if (!hasRecoveryInHash && !hasRecoveryInQuery) {
      settleInvalid("no_params", "missing_proof_blocked", shape);
    } else if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
      supabase.auth.exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) settleInvalid("code", "exchange_error", shape);
          else { stripSensitiveParams(); void settleValid("code", "ok", shape); }
        })
        .catch(() => settleInvalid("code", "exchange_error", shape));
    } else {
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (hasRecoveryInHash && accessToken && refreshToken) {
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ error }) => {
            if (error) settleInvalid("hash", "set_session_error", shape);
            else { stripSensitiveParams(); void settleValid("hash", "ok", shape); }
          })
          .catch(() => settleInvalid("hash", "set_session_error", shape));

        return () => subscription.unsubscribe();
      }

      const timeout = setTimeout(() => {
        settleInvalid("timeout", "missing_proof_blocked", shape);
      }, 8000);
      return () => {
        clearTimeout(timeout);
        subscription.unsubscribe();
      };
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleContinueGesture = async () => {
    if (!pendingTokenHash || verifyingToken) return;
    setVerifyingToken(true);
    const shape = { has_token_hash: true, has_code: false, has_hash: false };
    try {
      const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: pendingTokenHash });
      if (error) {
        const session = await confirmActiveRecoverySession();
        if (session.ok) {
          // 10-minute grace branch: verifyOtp said "consumed" but a recovery
          // session already exists for this device → the prior consumption
          // was almost certainly an upstream prefetcher (SafeLinks et al.).
          // Let the human proceed instead of bouncing them to "expired".
          stripSensitiveParams();
          setAwaitingUserGesture(false);
          await settleValid("token_hash", "ok", shape);
          return;
        }
        // No session AND verifyOtp errored → token was burned upstream. Beacon
        // the prefetch fingerprint so System Health can spot the pattern
        // without us having to ask the affected member.
        recordResetTelemetry({ branch: "token_hash", outcome: "recovery_link_prefetch_suspected", ...shape });
        stripSensitiveParams();
        setLinkExpired(true);
        setAwaitingUserGesture(false);
        settleInvalid("token_hash", "verify_error", shape);
        return;
      }
      stripSensitiveParams();
      setAwaitingUserGesture(false);
      await settleValid("token_hash", "ok", shape);
    } catch {
      setAwaitingUserGesture(false);
      settleInvalid("token_hash", "verify_error", shape);
    } finally {
      setVerifyingToken(false);
    }
  };

  const [otherDevicesRevoked, setOtherDevicesRevoked] = useState(true);
  const [retryingRevoke, setRetryingRevoke] = useState(false);

  useEffect(() => {
    if (!success) return;
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

    // DEFENSE IN DEPTH: even if validRecovery somehow becomes true without a
    // session, re-confirm before calling updateUser. This guarantees the
    // user cannot see "service unavailable" when the real problem is a
    // missing recovery session.
    if (!recoveredRef.current) {
      recordResetTelemetry({ branch: "update_submit", outcome: "missing_proof_blocked" });
      setLinkExpired(true);
      setValidRecovery(false);
      return;
    }
    const session = await confirmActiveRecoverySession();
    if (!session.ok) {
      recordResetTelemetry({ branch: "update_submit", outcome: "update_session_expired" });
      setLinkExpired(true);
      setValidRecovery(false);
      return;
    }
    if (session.email && session.email !== recoveryEmail) setRecoveryEmail(session.email);

    setError("");
    setErrorCode("");
    setLoading(true);

    try {
      const { otherDevicesRevoked: revoked } = await AuthService.updatePassword(passwordSet);
      setOtherDevicesRevoked(revoked);
      clearAttempts();
      clearAuthLockout();
      // Tell the browser + password manager to UPDATE the saved credential
      // immediately. This is the structural fix that prevents the reset
      // loop: without it, autofill keeps replaying the old password on
      // next sign-in and the member ends up resetting again.
      await storeCredentialInBrowser(session.email ?? recoveryEmail, passwordSet.password);
      recordResetTelemetry({ branch: "update_submit", outcome: "update_success" });
      setSuccess(true);
    } catch (err) {
      const e = err as Error & { code?: string };
      const code = e.code || "unknown";

      if (code === "session_expired") {
        recordResetTelemetry({ branch: "update_submit", outcome: "update_session_expired" });
        setLinkExpired(true);
        setValidRecovery(false);
        return;
      }

      setErrorCode(code);
      setError(e.message);

      const outcomeMap: Record<string, ResetOutcome> = {
        service_unavailable: "update_service_unavailable",
        rate_limited: "update_rate_limited",
        same_password: "update_same_password",
        weak_password: "update_weak_password",
        unknown: "update_unknown_error",
      };
      recordResetTelemetry({ branch: "update_submit", outcome: outcomeMap[code] ?? "update_unknown_error" });

      if (code === "service_unavailable") {
        return;
      }

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

  if (awaitingUserGesture) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-5">
          <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Continue resetting your password</h1>
          <p className="text-muted-foreground">
            For your safety, we wait for you to confirm before we activate this reset link. Tap continue and we'll take you straight to the new-password screen.
          </p>
          <Button onClick={handleContinueGesture} disabled={verifyingToken} className="w-full">
            {verifyingToken ? "One moment…" : "Continue resetting password"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Didn't request this? You can safely close this page — your password stays the same.
          </p>
        </div>
      </div>
    );
  }


  if (!validRecovery) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {linkExpired ? "This reset link can't be used" : "Invalid or expired link"}
          </h1>
          <p className="text-muted-foreground mb-4">
            {linkExpired
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
                  username={recoveryEmail ?? undefined}
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
