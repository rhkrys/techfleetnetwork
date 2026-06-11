/**
 * AUTH-ENGINE — Turnstile captcha adapter.
 *
 * Wraps the existing `<TurnstileChallenge>` widget so engine/screen code never
 * touches `window.turnstile` or the Turnstile SDK directly. After Ship 5b the
 * `no-restricted-imports` guard will forbid Turnstile SDK imports outside this
 * file.
 *
 * The underlying widget owns its own DOM lifecycle and reacts to bumps in
 * `failureCount` / `softResetCount` to remount a fresh challenge. The adapter
 * normalises the surface so callers think in terms of `resetKey` and a single
 * `onToken` callback — matching the eventual `CaptchaPort` shape without
 * forcing a refactor of the legacy widget today.
 */
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";

export type TurnstileAction = "login" | "register" | "forgot_password" | "signup_confirmation_resend";

export interface TurnstileCaptchaAdapterProps {
  action: TurnstileAction;
  onToken: (token: string) => void;
  /** Punitive counter — advances the user-attributable failure lockout. */
  failureCount?: number;
  /** Non-punitive counter — remounts without bumping the failure lockout. */
  softResetCount?: number;
  /** Email passed through for the magic-link fallback on the login surface. */
  email?: string;
}

export function TurnstileCaptchaAdapter({
  action,
  onToken,
  failureCount = 0,
  softResetCount = 0,
  email,
}: TurnstileCaptchaAdapterProps) {
  return (
    <TurnstileChallenge
      action={action}
      onTokenChange={onToken}
      failureCount={failureCount}
      softResetCount={softResetCount}
      email={email}
    />
  );
}
