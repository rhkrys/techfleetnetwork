import type { AuthErr } from "../domain/auth-result";
import type { AuthErrorCode } from "../domain/auth-codes";

/**
 * AuthErrorMessage — the ONE component that renders copy for every
 * AuthErrorCode. Adding a code in `auth-codes.ts` forces a compile
 * error here (exhaustive switch via `assertNever`), so we cannot ship
 * a new code without user-facing copy.
 *
 * Brand voice: empathy + plain reason + recovery action.
 */

interface Copy {
  title: string;
  body: string;
  action?: string;
}

const COPY: Record<AuthErrorCode, Copy> = {
  invalid_credentials: {
    title: "We couldn't sign you in",
    body: "That email and password don't match. Double-check both and try again.",
    action: "Reset your password if you've forgotten it.",
  },
  account_locked: {
    title: "Account temporarily locked",
    body: "Too many sign-in attempts. Wait a few minutes and try again.",
  },
  captcha_required: {
    title: "One more check",
    body: "Please complete the captcha to continue.",
  },
  captcha_failed: {
    title: "Captcha didn't verify",
    body: "Please try the captcha again.",
  },
  rate_limited: {
    title: "Slow down for a moment",
    body: "You've tried that too many times. Please wait before retrying.",
  },
  google_only_account: {
    title: "Use Google sign-in for this account",
    body: "This account was created with Google. Choose Continue with Google.",
  },
  email_not_confirmed: {
    title: "Please confirm your email",
    body: "Check your inbox for the confirmation link we sent you.",
  },
  email_provider_unverified: {
    title: "Email address can't receive mail",
    body: "We couldn't reach your email provider. Try a different address.",
  },
  weak_password: {
    title: "Choose a stronger password",
    body: "Pick a longer password that hasn't been seen in a breach.",
  },
  same_password: {
    title: "New password matches the old one",
    body: "Choose a password you haven't used here before.",
  },
  recovery_session_expired: {
    title: "Reset link expired",
    body: "Request a new password reset email and try again.",
  },
  recovery_link_consumed: {
    title: "Reset link already used",
    body: "Request a new password reset email if you still need to change your password.",
  },
  client_session_write_failed: {
    title: "Sign-in didn't complete",
    body: "Something interrupted finishing sign-in. Please try again.",
  },
  mfa_required: {
    title: "Two-step verification needed",
    body: "Enter the 6-digit code from your authenticator app.",
  },
  mfa_invalid_code: {
    title: "That code didn't match",
    body: "Check your authenticator app and enter the latest 6-digit code.",
  },
  network_error: {
    title: "Connection problem",
    body: "Check your internet connection and try again.",
  },
  service_unavailable: {
    title: "Sign-in is temporarily unavailable",
    body: "We're having trouble right now. Please try again in a moment.",
  },
  unexpected: {
    title: "Something went wrong",
    body: "An unexpected issue interrupted sign-in. Please try again.",
  },
};

export interface AuthErrorMessageProps {
  error: AuthErr;
  className?: string;
}

export function AuthErrorMessage({ error, className }: AuthErrorMessageProps) {
  const copy = COPY[error.code];
  return (
    <div
      role="alert"
      aria-live="polite"
      className={className ?? "rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm"}
      data-testid="auth-error-message"
      data-auth-code={error.code}
    >
      <p className="font-semibold text-destructive">{copy.title}</p>
      <p className="mt-1 text-foreground">{copy.body}</p>
      {copy.action ? (
        <p className="mt-1 text-muted-foreground">{copy.action}</p>
      ) : null}
    </div>
  );
}
