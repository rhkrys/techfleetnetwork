/**
 * useResetPasswordEngine — single source of truth for /reset-password.
 *
 * PURE MECHANICAL EXTRACTION from ResetPasswordPage.tsx. Every helper,
 * effect, branch, telemetry call, prefetch gate, verifyOtp 10-minute
 * grace, defense-in-depth recovery-session re-check, and CLEAN HANDOFF
 * counter wipe is preserved BYTE-FOR-BYTE. ResetPasswordScreen is pure
 * presentation over this hook.
 *
 * HARD INVARIANTS (do not weaken without a contract test):
 *  - AUTH-RESET-SESSION-003: password form never renders without an
 *    active recovery session (confirmActiveRecoverySession gate).
 *  - AUTH-RESET-PREFETCH-001 v2: verifyOtp waits for explicit user
 *    gesture when reset_intent !== "confirm".
 *  - AUTH-RESET-HANDOFF-001: on update_success we wipe lockout +
 *    reset-attempt counter + captcha state + transient bad-jwt strike.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { sessionPort } from "@/features/auth/ports/session.port";
import { reportValidationRejection } from "@/services/error-reporter.service";
import { validatePasswordSet } from "@/lib/auth/password-set";
import { clearAuthLockout } from "@/features/auth/ports/lockout.port";
import { clearLoginCaptcha } from "@/features/auth/ports/captcha-state.port";
import { clearTransientStrike } from "@/lib/auth/session-health";
import { recordResetTelemetry, type ResetBranch, type ResetOutcome } from "@/lib/auth/reset-telemetry";
import { telemetryPort } from "@/features/auth/ports/telemetry.port";

export const MAX_REJECTIONS = 3;
const RESET_ATTEMPTS_KEY = "tfn:reset-attempts";

function tokenHashPrefix(tokenHash: string | null): string | null {
  return tokenHash ? tokenHash.slice(0, 12) : null;
}
function readAttempts(): number {
  try {
    const raw = window.sessionStorage.getItem(RESET_ATTEMPTS_KEY);
    return raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  } catch { return 0; }
}
function writeAttempts(n: number) {
  try { window.sessionStorage.setItem(RESET_ATTEMPTS_KEY, String(n)); } catch { /* noop */ }
}
function clearAttempts() {
  try { window.sessionStorage.removeItem(RESET_ATTEMPTS_KEY); } catch { /* noop */ }
}

async function confirmActiveRecoverySession(): Promise<{ ok: boolean; email: string | null }> {
  try {
    const { data, error } = await sessionPort.getUser();
    if (error) return { ok: false, email: null };
    return { ok: Boolean(data?.user?.id), email: data?.user?.email ?? null };
  } catch { return { ok: false, email: null }; }
}

async function storeCredentialInBrowser(email: string | null, password: string): Promise<void> {
  if (!email) return;
  try {
    const w = window as unknown as { PasswordCredential?: new (init: { id: string; password: string; name?: string }) => Credential };
    if (typeof navigator === "undefined" || !("credentials" in navigator) || !w.PasswordCredential) return;
    const cred = new w.PasswordCredential({ id: email, password, name: email });
    await (navigator.credentials as unknown as { store: (c: Credential) => Promise<void> }).store(cred);
  } catch { /* non-fatal */ }
}

export interface ResetPasswordEngine {
  passwordSet: { password: string; confirmPassword: string };
  setPasswordSet: (next: { password: string; confirmPassword: string }) => void;
  touched: { password: boolean; confirmPassword: boolean };
  markTouched: (field: "password" | "confirmPassword") => void;
  error: string;
  setError: (v: string) => void;
  errorCode: string;
  setErrorCode: (v: string) => void;
  success: boolean;
  loading: boolean;
  validRecovery: boolean;
  checking: boolean;
  attempts: number;
  linkExpired: boolean;
  recoveryEmail: string | null;
  awaitingUserGesture: boolean;
  verifyingToken: boolean;
  otherDevicesRevoked: boolean;
  retryingRevoke: boolean;
  passwordValidation: ReturnType<typeof validatePasswordSet>;
  formLocked: boolean;
  handleSubmit: (e: FormEvent) => Promise<void>;
  handleContinueGesture: () => Promise<void>;
  handleRetryRevoke: () => Promise<void>;
  goToDashboard: () => void;
}

export function useResetPasswordEngine(): ResetPasswordEngine {
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
  const [awaitingUserGesture, setAwaitingUserGesture] = useState(false);
  const [pendingTokenHash, setPendingTokenHash] = useState<string | null>(null);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [otherDevicesRevoked, setOtherDevicesRevoked] = useState(true);
  const [retryingRevoke, setRetryingRevoke] = useState(false);
  const navigate = useNavigate();
  const recoveredRef = useRef(false);
  const settledRef = useRef(false);

  const markTouched = useCallback((field: "password" | "confirmPassword") => {
    setTouched((current) => ({ ...current, [field]: true }));
  }, []);

  const stripSensitiveParams = useCallback(() => {
    try {
      const clean = new URL(window.location.href);
      ["token_hash", "type", "code", "access_token", "refresh_token", "expires_in", "expires_at", "token_type"].forEach((k) => clean.searchParams.delete(k));
      const newUrl = clean.pathname + (clean.search ? clean.search : "") + (clean.hash && !clean.hash.includes("access_token") && !clean.hash.includes("type=recovery") ? clean.hash : "");
      window.history.replaceState({}, "", newUrl);
    } catch { /* noop */ }
  }, []);

  const settleValid = useCallback(async (branch: ResetBranch, outcome: ResetOutcome, shape: { has_token_hash?: boolean; has_code?: boolean; has_hash?: boolean }) => {
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
  }, []);

  const settleInvalid = useCallback((branch: ResetBranch, outcome: ResetOutcome, shape: { has_token_hash?: boolean; has_code?: boolean; has_hash?: boolean; token_hash_prefix?: string | null }) => {
    if (settledRef.current) return;
    settledRef.current = true;
    recordResetTelemetry({ branch, outcome, ...shape });
    setValidRecovery(false);
    setChecking(false);
  }, []);

  // <head> tags against link prefetchers / corporate proxies caching
  useEffect(() => {
    const tags: HTMLMetaElement[] = [];
    const add = (attrs: Record<string, string>) => {
      const m = document.createElement("meta");
      Object.entries(attrs).forEach(([k, v]) => m.setAttribute(k, v));
      document.head.appendChild(m);
      tags.push(m);
    };
    add({ name: "robots", content: "noindex,nofollow,noarchive,nosnippet" });
    add({ name: "googlebot", content: "noindex,nofollow" });
    add({ "http-equiv": "Cache-Control", content: "no-store, no-cache, must-revalidate" });
    add({ "http-equiv": "Pragma", content: "no-cache" });
    add({ name: "referrer", content: "no-referrer" });
    return () => { tags.forEach((m) => m.remove()); };
  }, []);

  const verifyPendingToken = useCallback(async (tokenHash: string, shape: { has_token_hash?: boolean; has_code?: boolean; has_hash?: boolean }) => {
    setVerifyingToken(true);
    try {
      const { error: verifyError } = await sessionPort.verifyRecoveryOtp(tokenHash);
      if (verifyError) {
        const session = await confirmActiveRecoverySession();
        if (session.ok) {
          stripSensitiveParams();
          setAwaitingUserGesture(false);
          await settleValid("token_hash", "ok", shape);
          return;
        }
        recordResetTelemetry({ branch: "token_hash", outcome: "recovery_link_prefetch_suspected", ...shape, token_hash_prefix: tokenHashPrefix(tokenHash) });
        stripSensitiveParams();
        setLinkExpired(true);
        setAwaitingUserGesture(false);
        settleInvalid("token_hash", "verify_error", { ...shape, token_hash_prefix: tokenHashPrefix(tokenHash) });
        return;
      }
      stripSensitiveParams();
      setAwaitingUserGesture(false);
      await settleValid("token_hash", "ok", shape);
    } catch {
      setAwaitingUserGesture(false);
      settleInvalid("token_hash", "verify_error", { ...shape, token_hash_prefix: tokenHashPrefix(tokenHash) });
    } finally {
      setVerifyingToken(false);
    }
  }, [settleValid, settleInvalid, stripSensitiveParams]);

  // Boot: figure out which branch (token_hash / code / hash / nothing)
  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = window.location.hash;
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const typeParam = url.searchParams.get("type");
    const resetIntent = url.searchParams.get("reset_intent");
    const hasRecoveryInHash = hash.includes("type=recovery");
    const hasTokenHashRecovery = Boolean(tokenHash) && typeParam === "recovery";
    const hasRecoveryInQuery = typeParam === "recovery" || Boolean(code);
    const shape = {
      has_token_hash: Boolean(tokenHash),
      has_code: Boolean(code),
      has_hash: Boolean(hash),
    };

    const { data: { subscription } } = sessionPort.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        void settleValid("session_event", "ok", shape);
      }
    });

    if (hasTokenHashRecovery && resetIntent !== "confirm") {
      (async () => {
        const session = await confirmActiveRecoverySession();
        if (session.ok) {
          stripSensitiveParams();
          void settleValid("token_hash", "ok", shape);
          return;
        }
        recordResetTelemetry({ branch: "no_params", outcome: "ok", ...shape, token_hash_prefix: tokenHashPrefix(tokenHash) });
        setPendingTokenHash(tokenHash);
        setAwaitingUserGesture(true);
        setChecking(false);
      })();
    } else if (hasTokenHashRecovery) {
      void verifyPendingToken(tokenHash!, shape);
    } else if (!hasRecoveryInHash && !hasRecoveryInQuery) {
      settleInvalid("no_params", "missing_proof_blocked", shape);
    } else if (code && typeof sessionPort.exchangeCodeForSession === "function") {
      sessionPort.exchangeCodeForSession(code)
        .then(({ error: exchangeError }) => {
          if (exchangeError) settleInvalid("code", "exchange_error", shape);
          else { stripSensitiveParams(); void settleValid("code", "ok", shape); }
        })
        .catch(() => settleInvalid("code", "exchange_error", shape));
    } else {
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (hasRecoveryInHash && accessToken && refreshToken) {
        sessionPort.setSession(accessToken, refreshToken)
          .then(({ error: setSessionError }) => {
            if (setSessionError) settleInvalid("hash", "set_session_error", shape);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContinueGesture = useCallback(async () => {
    if (!pendingTokenHash || verifyingToken) return;
    await verifyPendingToken(pendingTokenHash, { has_token_hash: true, has_code: false, has_hash: false });
  }, [pendingTokenHash, verifyingToken, verifyPendingToken]);

  // Success → 4s grace then dashboard
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => navigate("/dashboard?from=password-reset", { replace: true }), 4000);
    return () => clearTimeout(t);
  }, [success, navigate]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirmPassword: true });
    const validation = validatePasswordSet(passwordSet);
    if (!validation.isValid) {
      reportValidationRejection("passwordSet", [{ message: validation.passwordError || validation.confirmError, path: [validation.passwordError ? "password" : "confirmPassword"] }], "ResetPasswordScreen.handleSubmit");
      setError(validation.passwordError || validation.confirmError);
      setErrorCode("weak_password_client");
      return;
    }
    if (attempts >= MAX_REJECTIONS) return;

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
      const { otherDevicesRevoked: revoked } = await sessionPort.updatePassword(passwordSet);
      setOtherDevicesRevoked(revoked);
      // CLEAN HANDOFF (AUTH-RESET-HANDOFF-001)
      clearAttempts();
      clearAuthLockout();
      clearLoginCaptcha();
      clearTransientStrike();
      await storeCredentialInBrowser(session.email ?? recoveryEmail, passwordSet.password);
      recordResetTelemetry({ branch: "update_submit", outcome: "update_success" });
      telemetryPort.record("auth_engine.reset_succeeded", { email: session.email ?? recoveryEmail ?? null, other_devices_revoked: revoked });
      setSuccess(true);
    } catch (err) {
      const e2 = err as Error & { code?: string };
      const code = e2.code || "unknown";

      if (code === "session_expired") {
        recordResetTelemetry({ branch: "update_submit", outcome: "update_session_expired" });
        telemetryPort.record("auth_engine.reset_failed", { code: "session_expired" });
        setLinkExpired(true);
        setValidRecovery(false);
        return;
      }

      setErrorCode(code);
      setError(e2.message);

      const outcomeMap: Record<string, ResetOutcome> = {
        service_unavailable: "update_service_unavailable",
        rate_limited: "update_rate_limited",
        same_password: "update_same_password",
        weak_password: "update_weak_password",
        unknown: "update_unknown_error",
      };
      recordResetTelemetry({ branch: "update_submit", outcome: outcomeMap[code] ?? "update_unknown_error" });
      telemetryPort.record("auth_engine.reset_failed", { code });

      if (code === "service_unavailable") return;

      if (code === "same_password" || code === "weak_password" || code === "unknown" || code === "rate_limited") {
        const next = attempts + 1;
        setAttempts(next);
        writeAttempts(next);
      }
    } finally {
      setLoading(false);
    }
  }, [attempts, passwordSet, recoveryEmail]);

  const handleRetryRevoke = useCallback(async () => {
    setRetryingRevoke(true);
    try {
      const { revocationRecorded } = await sessionPort.signOutAllDevices({
        keepCurrent: true,
        reason: "self_password_changed",
      });
      setOtherDevicesRevoked(revocationRecorded);
    } finally {
      setRetryingRevoke(false);
    }
  }, []);

  const goToDashboard = useCallback(() => navigate("/dashboard?from=password-reset", { replace: true }), [navigate]);

  const passwordValidation = validatePasswordSet(passwordSet);
  const formLocked = attempts >= MAX_REJECTIONS;

  return {
    passwordSet, setPasswordSet,
    touched, markTouched,
    error, setError, errorCode, setErrorCode,
    success, loading, validRecovery, checking, attempts,
    linkExpired, recoveryEmail,
    awaitingUserGesture, verifyingToken,
    otherDevicesRevoked, retryingRevoke,
    passwordValidation, formLocked,
    handleSubmit, handleContinueGesture, handleRetryRevoke, goToDashboard,
  };
}
