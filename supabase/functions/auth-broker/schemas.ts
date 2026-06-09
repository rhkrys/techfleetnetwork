import { z } from "https://esm.sh/zod@3.23.8";

// Each route exports a single zod request schema + response schema.
// The response schema is a discriminated union { ok:true, ... } | { ok:false, code }
// mirroring `src/features/auth/domain/auth-result.ts` exactly. A Phase 3
// CI guard will zod-to-ts these and assert client/server stay in lockstep.

export const AUTH_ERROR_CODE = z.enum([
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
  "unexpected",
]);
export type AuthErrorCode = z.infer<typeof AUTH_ERROR_CODE>;

const CORR_ID = z.string().min(8).max(64);
const SESSION = z.object({
  access_token: z.string().min(20),
  refresh_token: z.string().min(20),
  expires_in: z.number().int().positive().optional(),
});

// ───────────────────────────── sign-in/password ────────────────────────────
export const SIGN_IN_PASSWORD_REQ = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(512),
  captchaToken: z.string().min(8).max(4096).optional(),
  correlationId: CORR_ID,
});
export type SignInPasswordReq = z.infer<typeof SIGN_IN_PASSWORD_REQ>;

export const SIGN_IN_PASSWORD_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.enum(["signed_in", "mfa_required"]),
    userId: z.string().uuid().optional(),
    challengeId: z.string().optional(),
    session: SESSION.optional(),
    correlationId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: AUTH_ERROR_CODE,
    retryAfter: z.number().int().nonnegative().optional(),
    correlationId: z.string(),
  }),
]);
export type SignInPasswordRes = z.infer<typeof SIGN_IN_PASSWORD_RES>;

// ─────────────────────────────── sign-up/password ──────────────────────────
export const SIGN_UP_REQ = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(512),
  captchaToken: z.string().min(8).max(4096).optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  redirectTo: z.string().url().max(2048).optional(),
  correlationId: CORR_ID,
});
export type SignUpReq = z.infer<typeof SIGN_UP_REQ>;

export const SIGN_UP_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.enum(["verification_email_sent", "signed_in"]),
    userId: z.string().uuid().optional(),
    session: SESSION.optional(),
    correlationId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: AUTH_ERROR_CODE,
    retryAfter: z.number().int().nonnegative().optional(),
    correlationId: z.string(),
  }),
]);
export type SignUpRes = z.infer<typeof SIGN_UP_RES>;

// ───────────────────────── password-reset/request ──────────────────────────
export const RESET_REQUEST_REQ = z.object({
  email: z.string().email().max(254),
  captchaToken: z.string().min(8).max(4096).optional(),
  redirectTo: z.string().url().max(2048).optional(),
  correlationId: CORR_ID,
});
export type ResetRequestReq = z.infer<typeof RESET_REQUEST_REQ>;

// NOTE: always returns ok:true with kind:"password_reset_email_sent" to
// avoid account enumeration. Internal failures fall through to "unexpected".
export const RESET_REQUEST_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.literal("password_reset_email_sent"),
    correlationId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: AUTH_ERROR_CODE,
    retryAfter: z.number().int().nonnegative().optional(),
    correlationId: z.string(),
  }),
]);
export type ResetRequestRes = z.infer<typeof RESET_REQUEST_RES>;

// ───────────────────────── password-reset/complete ─────────────────────────
export const RESET_COMPLETE_REQ = z.object({
  newPassword: z.string().min(8).max(512),
  correlationId: CORR_ID,
});
export type ResetCompleteReq = z.infer<typeof RESET_COMPLETE_REQ>;

export const RESET_COMPLETE_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.literal("password_updated"),
    correlationId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: AUTH_ERROR_CODE,
    retryAfter: z.number().int().nonnegative().optional(),
    correlationId: z.string(),
  }),
]);
export type ResetCompleteRes = z.infer<typeof RESET_COMPLETE_RES>;

// ───────────────────────────────── sign-out ────────────────────────────────
export const SIGN_OUT_REQ = z.object({
  correlationId: CORR_ID,
  scope: z.enum(["local", "global"]).default("local"),
});
export type SignOutReq = z.infer<typeof SIGN_OUT_REQ>;

export const SIGN_OUT_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.literal("signed_out"),
    correlationId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: AUTH_ERROR_CODE,
    correlationId: z.string(),
  }),
]);
export type SignOutRes = z.infer<typeof SIGN_OUT_RES>;

// ───────────────────────────── identity/check ──────────────────────────────
export const IDENTITY_CHECK_REQ = z.object({
  email: z.string().email().max(254),
  correlationId: CORR_ID,
});
export type IdentityCheckReq = z.infer<typeof IDENTITY_CHECK_REQ>;

// Privacy-preserving: never confirms existence. UI uses `providers` only to
// adapt copy (e.g. "use Google to sign in") and treats unknown as password.
export const IDENTITY_CHECK_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.literal("identity_hint"),
    providers: z.array(z.enum(["password", "google"])),
    correlationId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: AUTH_ERROR_CODE,
    correlationId: z.string(),
  }),
]);
export type IdentityCheckRes = z.infer<typeof IDENTITY_CHECK_RES>;
