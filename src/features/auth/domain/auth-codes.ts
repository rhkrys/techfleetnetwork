/**
 * AuthErrorCode — the ONLY authoritative taxonomy of auth failures.
 *
 * Every code in this enum is server-issued (by GoTrue, the `auth-broker`
 * edge function, or a DB RPC). The client classifier is code-first and
 * never produces these codes from message-string matching.
 *
 * Adding a code here is a deliberate act and triggers:
 *   - exhaustive switch failures in every consumer (caught at build)
 *   - `auth-failure-policy.ts` must declare a mapping or CI fails
 *   - `AuthErrorMessage` must render copy for it
 *
 * Vichea-class bug prevention: `invalid_credentials` is the ONLY code
 * that may fire credential counters. Client-side session-write failures
 * map to `client_session_write_failed`, which is explicitly non-punitive.
 */
export const AUTH_ERROR_CODES = [
  "invalid_credentials",
  "account_locked",
  "captcha_required",
  "captcha_failed",
  "rate_limited",
  "google_only_account",
  "email_not_confirmed",
  "email_provider_unverified",
  "weak_password",
  "same_password",
  "recovery_session_expired",
  "recovery_link_consumed",
  "client_session_write_failed",
  "mfa_required",
  "mfa_invalid_code",
  "network_error",
  "service_unavailable",
  "account_exists",
  "unexpected",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Compile-time exhaustiveness helper. Use in default branches of switches
 * over AuthErrorCode / AuthOk.kind so missing cases fail the build.
 */
export function assertNever(value: never, context = "assertNever"): never {
  throw new Error(`${context}: unexpected value ${JSON.stringify(value)}`);
}
