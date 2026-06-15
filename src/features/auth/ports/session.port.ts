/**
 * Session port — AUTH-ARCH-CUTOVER-014 (2026-06-15).
 *
 * Single seam between non-auth-screen callers (AuthContext bootstrap,
 * ProfileEditPanel, EditProfilePage, …) and the per-use-case auth services.
 * Zero dependency on the deleted legacy `@/services/auth.service`.
 *
 * RULES
 * - Non-auth-screen code outside `src/features/auth/**` MUST import session
 *   methods from this file (enforced by `no-restricted-imports`).
 * - This file is the ONLY non-engine module allowed to wire the per-use-case
 *   auth services into a flat callable surface for legacy code.
 * - New code SHOULD import the specific use-case service directly rather than
 *   widening this port further.
 */
import { supabase } from "@/integrations/supabase/client";
import { sessionService } from "@/features/auth/services/session.service";
import {
  signUp as signUpService,
  resendSignupConfirmation as resendSignupConfirmationService,
} from "@/features/auth/services/sign-up.service";
import { requestPasswordReset as requestPasswordResetService } from "@/features/auth/services/request-password-reset.service";
import { completePasswordReset as completePasswordResetService } from "@/features/auth/services/complete-password-reset.service";

export const sessionPort = {
  /** GoTrue session bootstrap with idle-policy enforcement. */
  getSession: sessionService.getSession.bind(sessionService),
  /** GoTrue auth-state subscription. */
  onAuthStateChange: sessionService.onAuthStateChange.bind(sessionService),
  /** Clears local sb-* tokens + session marker. Best-effort; never throws. */
  clearLocalAuthState: sessionService.clearLocalAuthState.bind(sessionService),
  /** Single-device sign-out. */
  signOut: sessionService.signOut.bind(sessionService),
  /** Global sign-out — revokes all refresh tokens for the user. */
  signOutAllDevices: sessionService.signOutAllDevices.bind(sessionService),
  /** AUTH-ARCH-CUTOVER-008: owned by request-password-reset.service. */
  resetPassword: requestPasswordResetService,
  /** AUTH-ARCH-CUTOVER-010: owned by complete-password-reset.service. */
  updatePassword: completePasswordResetService,
  /** AUTH-ARCH-CUTOVER-007: owned by sign-up.service. */
  signUp: signUpService,
  /** AUTH-ARCH-CUTOVER-007: owned by sign-up.service. */
  resendSignupConfirmation: resendSignupConfirmationService,
  /** Re-validate the active member against GoTrue. */
  getUser: () => supabase.auth.getUser(),
  /** Verify a one-time recovery token (password-reset email link). */
  verifyRecoveryOtp: (tokenHash: string) =>
    supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash }),
  /** Exchange a Supabase auth code for a session (PKCE flow). */
  exchangeCodeForSession: (code: string) =>
    typeof supabase.auth.exchangeCodeForSession === "function"
      ? supabase.auth.exchangeCodeForSession(code)
      : Promise.resolve({ data: { session: null, user: null }, error: null } as never),
  /** Restore a session from access/refresh tokens (recovery hash flow). */
  setSession: (access_token: string, refresh_token: string) =>
    supabase.auth.setSession({ access_token, refresh_token }),
  /** Invoke an auth-related edge function via the Supabase client. */
  invokeEdge: <T = unknown>(name: string, options?: { body?: unknown }) =>
    supabase.functions.invoke<T>(name, options as never),
  /** Invoke an auth-related RPC. */
  rpc: <T = unknown>(name: string, args?: Record<string, unknown>) =>
    supabase.rpc(name as never, args as never) as unknown as Promise<{ data: T | null; error: unknown }>,
} as const;

export type SessionPort = typeof sessionPort;
