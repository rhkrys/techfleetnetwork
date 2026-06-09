import { useState, type FormEvent } from "react";
import { useAuthMachine } from "../state/use-auth-machine";
import { AuthErrorMessage } from "./AuthErrorMessage";

/**
 * SignInForm — pure view bound to the auth state machine.
 *
 * Architectural invariants:
 *   - No `useState<boolean>` for `isLoading|isSubmitting` (state.value owns it).
 *   - No direct `supabase.auth.*` call (the flow service owns it).
 *   - Credential input names + autoComplete locked for password managers
 *     (the future `check-credential-attrs.mjs` CI script will pin these).
 *
 * Phase 5 wires this beneath the existing LoginPage as a thin renderer.
 * Phase 7 swaps the page body to this component.
 */
export function SignInForm({
  onSignedIn,
}: {
  onSignedIn?: () => void;
}) {
  const { state, submitPassword } = useAuthMachine("signin_password");
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
    const result = await submitPassword(email, password);
    if (result.ok && result.value.kind === "signed_in") {
      onSignedIn?.();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="sign-in-form"
      data-machine-state={status}
      noValidate
    >
      <div className="space-y-1.5">
        <label htmlFor="signin-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="signin-email"
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
        <label htmlFor="signin-password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="signin-password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          required
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
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
