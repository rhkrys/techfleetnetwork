import type { AuthErrorCode } from "./auth-codes";

/**
 * Result<T, E> — every auth flow returns this; no throws cross the boundary.
 * Consumers MUST exhaustively `switch (result.kind)` (enforced by the
 * `auth-result-exhaustive` ESLint rule).
 */
export type Result<TOk, TErr> = { ok: true; value: TOk } | { ok: false; error: TErr };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type AuthOk =
  | { kind: "signed_in"; userId: string; correlationId: string }
  | { kind: "redirecting_to_provider"; provider: "google"; correlationId: string }
  | { kind: "mfa_required"; challengeId: string; correlationId: string }
  | { kind: "verification_email_sent"; email: string; correlationId: string }
  | { kind: "password_reset_email_sent"; correlationId: string }
  | { kind: "password_updated"; correlationId: string }
  | { kind: "signed_out"; correlationId: string };

export interface AuthErr {
  code: AuthErrorCode;
  /** Optional, server-issued retry-after (seconds). */
  retryAfter?: number;
  /** Correlation id of the originating request (matches ops_events row). */
  correlationId: string;
  /** Optional structured details (NEVER a raw provider message). */
  details?: Record<string, unknown>;
}

export type AuthResult<T extends AuthOk = AuthOk> = Result<T, AuthErr>;
