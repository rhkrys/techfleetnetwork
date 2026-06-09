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

export const SIGN_IN_PASSWORD_REQ = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(512),
  captchaToken: z.string().min(8).max(4096).optional(),
  correlationId: z.string().min(8).max(64),
});
export type SignInPasswordReq = z.infer<typeof SIGN_IN_PASSWORD_REQ>;

export const SIGN_IN_PASSWORD_RES = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    kind: z.enum(["signed_in", "mfa_required"]),
    userId: z.string().uuid().optional(),
    challengeId: z.string().optional(),
    session: z.object({
      access_token: z.string().min(20),
      refresh_token: z.string().min(20),
      expires_in: z.number().int().positive().optional(),
    }).optional(),
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
