/**
 * Session port — Ship 5 prep.
 *
 * Single seam between non-auth-screen callers (AuthContext bootstrap,
 * ProfileEditPanel, EditProfilePage, …) and the legacy `AuthService`. Today
 * this is a thin re-export; once the engines stop depending on the legacy
 * modules, the port will swap to a new adapter without touching call sites.
 *
 * RULES
 * - Non-auth-screen code outside `src/features/auth/**` MUST import session
 *   methods from this file instead of `@/services/auth.service` (enforced by
 *   the `no-restricted-imports` guard in `eslint.config.js`).
 * - This file is the ONLY non-engine module allowed to import AuthService.
 * - Do NOT add new methods here without first checking whether the engine
 *   layer should own them instead.
 */
import { AuthService } from "@/services/auth.service";
import { supabase } from "@/integrations/supabase/client";
import { signUp as signUpService, resendSignupConfirmation as resendSignupConfirmationService } from "@/features/auth/services/sign-up.service";
import { requestPasswordReset as requestPasswordResetService } from "@/features/auth/services/request-password-reset.service";
import { completePasswordReset as completePasswordResetService } from "@/features/auth/services/complete-password-reset.service";

export const sessionPort = {
  /** GoTrue session bootstrap with idle-policy enforcement (still in AuthService — Ship 6 candidate). */
  getSession: AuthService.getSession.bind(AuthService),
  /** GoTrue auth-state subscription. */
  onAuthStateChange: AuthService.onAuthStateChange.bind(AuthService),
  /** Clears local sb-* tokens + session marker. Best-effort; never throws. */
  clearLocalAuthState: AuthService.clearLocalAuthState.bind(AuthService),
  /** Single-device sign-out. */
  signOut: AuthService.signOut.bind(AuthService),
  /** Global sign-out — revokes all refresh tokens for the user. */
  signOutAllDevices: AuthService.signOutAllDevices.bind(AuthService),
  /** AUTH-ARCH-CUTOVER-008: now owned by request-password-reset.service. */
  resetPassword: requestPasswordResetService,
  /** AUTH-ARCH-CUTOVER-010: now owned by complete-password-reset.service. */
  updatePassword: completePasswordResetService,
  /** AUTH-ARCH-CUTOVER-007: now owned by sign-up.service. */
  signUp: signUpService,
  /** AUTH-ARCH-CUTOVER-007: now owned by sign-up.service. */
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
