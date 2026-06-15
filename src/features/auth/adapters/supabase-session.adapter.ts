/**
 * AUTH-ENGINE — Supabase session adapter.
 *
 * The ONLY non-legacy module allowed to import `@/integrations/supabase/client`
 * for the purpose of sign-in / sign-up / password reset. Engines depend on the
 * `session.port` shape; this adapter satisfies that shape with the real
 * Supabase calls. Swapping providers (or stubbing in tests) means swapping this
 * file — no engine or screen code changes.
 *
 * Locked by the `no-restricted-imports` guard once Ship 5b lands.
 */
import { supabase } from "@/integrations/supabase/client";

export interface SignInPasswordInput {
  email: string;
  password: string;
  captchaToken?: string;
}

export interface SignUpInput {
  email: string;
  password: string;
  captchaToken?: string;
  emailRedirectTo?: string;
  data?: Record<string, unknown>;
}

export interface SendResetInput {
  email: string;
  captchaToken?: string;
  redirectTo: string;
}

export const supabaseSessionAdapter = {
  /** Email+password sign-in. Returns raw GoTrue response; classification lives in the engine. */
  signInPassword({ email, password, captchaToken }: SignInPasswordInput) {
    return supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
  },

  // AUTH-ARCH-CUTOVER-004: Google OAuth has exactly ONE entrypoint —
  // `<GoogleSignInButton/>` → `lovable.auth.signInWithOAuth("google", …)`.
  // The previous `signInGoogle` helper here is intentionally removed.
  // Adding it back will fail `scripts/ci/check-no-direct-google-oauth.mjs`.

  /** New-account sign-up. */
  signUp({ email, password, captchaToken, emailRedirectTo, data }: SignUpInput) {
    return supabase.auth.signUp({
      email,
      password,
      options: {
        ...(captchaToken ? { captchaToken } : {}),
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
        ...(data ? { data } : {}),
      },
    });
  },

  /** Send a password-reset email via Supabase Auth. */
  sendReset({ email, captchaToken, redirectTo }: SendResetInput) {
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
      ...(captchaToken ? { captchaToken } : {}),
    });
  },

  /** Final step of the reset flow — invoked by `/reset-password/confirm`. */
  finalizeReset(newPassword: string) {
    return supabase.auth.updateUser({ password: newPassword });
  },

  /** Re-validates the current session against GoTrue. */
  getUser() {
    return supabase.auth.getUser();
  },

  /** Local sign-out for this browser. */
  signOut() {
    return supabase.auth.signOut();
  },
} as const;

export type SupabaseSessionAdapter = typeof supabaseSessionAdapter;
