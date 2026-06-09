import type { AuthErr, AuthOk } from "../domain/auth-result";

/**
 * Typed XState machine context, events, and inputs.
 *
 * Pages MUST render off `state.value` only — no boolean useState for
 * `isLoading`, `needsCaptcha`, `needsMfa`, `isSubmitting`. The
 * `no-auth-booleans-in-ui` ESLint rule enforces this.
 */

export type AuthMachineMode =
  | "signin_password"
  | "signin_google"
  | "signup_password"
  | "request_password_reset"
  | "complete_password_reset";

export interface AuthMachineContext {
  mode: AuthMachineMode;
  email: string;
  /** Last typed error from the broker / classifier — never a raw string. */
  error: AuthErr | null;
  /** Last typed success — set on entry to `signed_in` / terminal ok states. */
  success: AuthOk | null;
  /** Correlation id, generated on form mount; flows through every beacon. */
  correlationId: string;
  /** Captcha token if Turnstile has produced one. */
  captchaToken: string | null;
  /** Pending MFA challenge id when in `awaiting_mfa`. */
  mfaChallengeId: string | null;
  /** Retry-after in seconds when rate-limited; UI renders a countdown. */
  retryAfter: number | null;
}

export type AuthMachineEvent =
  | { type: "SUBMIT"; email: string; password?: string; captchaToken?: string }
  | { type: "CAPTCHA_OK"; token: string }
  | { type: "CAPTCHA_FAIL" }
  | { type: "SERVER_OK"; value: AuthOk }
  | { type: "SERVER_ERR"; error: AuthErr }
  | { type: "MFA_SUBMIT"; code: string }
  | { type: "MFA_OK" }
  | { type: "MFA_FAIL"; error: AuthErr }
  | { type: "RESET" }
  | { type: "RETRY" };

export type AuthMachineStateValue =
  | "idle"
  | "validating"
  | "awaiting_captcha"
  | "submitting"
  | "redirecting_to_provider"
  | "awaiting_mfa"
  | "setting_session"
  | "signed_in"
  | "failed";
