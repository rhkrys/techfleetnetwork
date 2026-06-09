/**
 * The ONLY allow-list of auth-related storage keys. Any literal that begins
 * with `sb-`, `auth.`, `tfn:auth`, or `tfn:reset-` MUST live here.
 *
 * Enforced by the `no-auth-storage-literals` ESLint rule: any file outside
 * `src/features/auth/services/auth-storage.service.ts` that references one
 * of these literals fails CI.
 */
export const AUTH_STORAGE_KEYS = {
  /** Supabase GoTrue token bag (managed by the SDK). */
  supabaseToken: /^sb-.*-auth-token$/,
  /** Per-tab session age marker. */
  sessionStartedAt: "session_started_at",
  /** Last DOM activity timestamp (cross-tab). */
  lastActivityAt: "tfn:auth:last-activity",
  /** Reset-password attempt counter (3-strike form lock). */
  resetAttempts: "tfn:reset-attempts",
  /** Per-device login lockout window. */
  loginLockout: "tfn:auth:login-lockout",
  /** CAPTCHA verification marker shared across tabs. */
  captchaVerifiedAt: "tfn:auth:captcha-verified-at",
  /** XState machine snapshot (debugging only; never trusted for AAL). */
  machineSnapshot: "tfn:auth:machine-snapshot",
  /** Correlation id for the in-flight submit (mounted per form). */
  correlationId: "tfn:auth:correlation-id",
} as const;

export type AuthStorageKey = keyof typeof AUTH_STORAGE_KEYS;
