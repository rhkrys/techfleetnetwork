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

export const sessionPort = {
  /** GoTrue session bootstrap with idle-policy enforcement. */
  getSession: AuthService.getSession.bind(AuthService),
  /** GoTrue auth-state subscription (SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / …). */
  onAuthStateChange: AuthService.onAuthStateChange.bind(AuthService),
  /** Clears local sb-* tokens + session marker. Best-effort; never throws. */
  clearLocalAuthState: AuthService.clearLocalAuthState.bind(AuthService),
  /** Single-device sign-out (this browser). */
  signOut: AuthService.signOut.bind(AuthService),
  /** Global sign-out — revokes all refresh tokens for the user. */
  signOutAllDevices: AuthService.signOutAllDevices.bind(AuthService),
  /** Triggers a password-reset email via Supabase + RateLimitService. */
  resetPassword: AuthService.resetPassword.bind(AuthService),
} as const;

export type SessionPort = typeof sessionPort;
