import { useState, type FormEvent } from "react";
import { useAuthMachine } from "../state/use-auth-machine";
import { AuthErrorMessage } from "./AuthErrorMessage";

/**
 * ForgotPasswordForm — pure view bound to the auth state machine.
 * Always shows a neutral confirmation (no account enumeration).
 */
export function ForgotPasswordForm({
  redirectTo,
}: {
  redirectTo?: string;
}) {
  const { state, submitResetRequest } = useAuthMachine("request_password_reset");
  const [email, setEmail] = useState("");

  const status = state.value as string;
  const busy = status === "submitting" || status === "awaiting_captcha";
  const sent =
    status === "signed_in" || // terminal ok state in machine
    (state.context.success?.kind === "password_reset_email_sent");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || sent) return;
    await submitResetRequest(email, redirectTo);
  };

  if (sent) {
    return (
      <div
        className="rounded-md border bg-muted/30 p-4 text-sm"
        data-testid="forgot-password-confirmation"
      >
        If an account exists for <strong>{email}</strong>, we just sent a reset link.
        Check your inbox and spam folder.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="forgot-password-form"
      data-machine-state={status}
      noValidate
    >
      <div className="space-y-1.5">
        <label htmlFor="forgot-email" className="text-sm font-medium">Email</label>
        <input
          id="forgot-email"
          name="username"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="w-full rounded-md border bg-background px-3 py-2 text-base"
        />
      </div>

      {status === "failed" && state.context.error ? (
        <AuthErrorMessage error={state.context.error} />
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Sending reset link…" : "Send reset link"}
      </button>
    </form>
  );
}
