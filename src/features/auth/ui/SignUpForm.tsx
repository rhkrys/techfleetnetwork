import { useState, type FormEvent } from "react";
import { useAuthMachine } from "../state/use-auth-machine";
import { AuthErrorMessage } from "./AuthErrorMessage";

/**
 * SignUpForm — pure view bound to the auth state machine.
 *
 * Invariants:
 *   - No boolean `isLoading` state (machine owns it).
 *   - No direct `supabase.auth.signUp` (sign-up flow owns it).
 *   - Credential inputs lock `name`/`autoComplete` for password managers.
 */
export function SignUpForm({
  onEmailSent,
  emailRedirectTo,
}: {
  onEmailSent?: (email: string) => void;
  emailRedirectTo?: string;
}) {
  const { state, submitSignUp } = useAuthMachine("signup_password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const status = state.value as string;
  const busy =
    status === "submitting" ||
    status === "setting_session" ||
    status === "awaiting_captcha";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const result = await submitSignUp({ email, password, emailRedirectTo });
    if (result.ok === true && result.value.kind === "verification_email_sent") {
      onEmailSent?.(email);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="sign-up-form"
      data-machine-state={status}
      noValidate
    >
      <div className="space-y-1.5">
        <label htmlFor="signup-email" className="text-sm font-medium">Email</label>
        <input
          id="signup-email"
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

      <div className="space-y-1.5">
        <label htmlFor="signup-password" className="text-sm font-medium">Create password</label>
        <input
          id="signup-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {busy ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
