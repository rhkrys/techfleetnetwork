/**
 * Typed MFA failure classes.
 *
 * `MfaInvalidCodeError` is the ONLY class that means "the user's 6-digit
 * code did not match" — clear the input, prompt for a new code.
 *
 * `MfaTransientError` means GoTrue / challenge endpoint had an infra
 * blip (504, network, schema reload). The user's code is still valid for
 * the rest of the 30s TOTP window — keep their digits in the input and
 * let them just tap Verify again.
 *
 * `MfaSessionEscalationError` means verify succeeded server-side but
 * persisting the AAL2 session locally failed — rare, requires re-auth.
 *
 * BDD: AUTH-MFA-RESILIENT-504-001, AUTH-MFA-422-NO-RETRY-001,
 *      AUTH-MFA-TRANSIENT-PRESERVES-INPUT-001
 */

export class MfaInvalidCodeError extends Error {
  readonly kind = "mfa_invalid_code" as const;
  constructor(message = "That 6-digit code didn't match. Open your authenticator and enter the newest code.") {
    super(message);
    this.name = "MfaInvalidCodeError";
  }
}

export class MfaTransientError extends Error {
  readonly kind = "mfa_transient" as const;
  constructor(
    message = "Two-factor service is briefly unavailable. Your code is still valid — tap Verify again.",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MfaTransientError";
  }
}

export class MfaSessionEscalationError extends Error {
  readonly kind = "mfa_session_escalation" as const;
  constructor(
    message = "We verified your code, but couldn't finish sign-in. Please sign in again.",
  ) {
    super(message);
    this.name = "MfaSessionEscalationError";
  }
}

export type MfaError =
  | MfaInvalidCodeError
  | MfaTransientError
  | MfaSessionEscalationError;

/**
 * Classify a raw error thrown by `supabase.auth.mfa.verify` or
 * `supabase.auth.mfa.challenge`. GoTrue returns 422 with body
 * `Invalid TOTP code entered` for real mistypes; 504s / timeouts / network
 * blips look completely different.
 */
export function classifyMfaError(err: unknown): MfaError {
  const e = err as { message?: string; status?: number; name?: string; code?: string };
  const msg = typeof e?.message === "string" ? e.message : "";
  const status = typeof e?.status === "number" ? e.status : undefined;

  // 422 — real wrong code.
  if (status === 422 || /invalid totp|invalid code|wrong (?:totp|code)/i.test(msg)) {
    return new MfaInvalidCodeError();
  }
  // Expired challenge — treat as transient so the next Verify creates a
  // fresh one and succeeds.
  if (/expired|challenge.*not found|challenge.*invalid/i.test(msg)) {
    return new MfaTransientError(
      "The previous challenge expired. Tap Verify again with the newest code.",
      err,
    );
  }
  // 5xx / network / abort / timeout.
  if (
    (status !== undefined && status >= 500 && status <= 599) ||
    e?.name === "AbortError" ||
    /504|502|503|timeout|context deadline|failed to fetch|network/i.test(msg)
  ) {
    return new MfaTransientError(undefined, err);
  }
  // Unknown — default to invalid so the user can retry without burning
  // attempts on an infra issue we couldn't classify.
  return new MfaInvalidCodeError(
    "We couldn't verify the code. Check that your device clock is set to network time, then try again.",
  );
}
