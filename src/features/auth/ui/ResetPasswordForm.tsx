import { useState, type FormEvent } from "react";
import { useAuthMachine } from "../state/use-auth-machine";
import { AuthErrorMessage } from "./AuthErrorMessage";

/**
 * ResetPasswordForm — pure view bound to the auth state machine.
 *
 * Consumes a recovery session that the route layer already established.
 * On success, the machine reaches `signed_in` and the parent navigates.
 */
export function ResetPasswordForm({
  onPasswordUpdated,
}: {
  onPasswordUpdated?: () => void;
}) {
  const { state, submitResetComplete } = useAuthMachine("complete_password_reset");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const status = state.value as string;
  const busy = status === "submitting" || status === "setting_session";
  const mismatch = password !== "" && confirm !== "" && password !== confirm;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || mismatch) return;
    const result = await submitResetComplete(password);
    if (result.ok === true && result.value.kind === "password_updated") {
      onPasswordUpdated?.();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="reset-password-form"
      data-machine-state={status}
      noValidate
    >
      <div className="space-y-1.5">
        <label htmlFor="reset-password" className="text-sm font-medium">New password</label>
        <input
          id="reset-password"
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

      <div className="space-y-1.5">
        <label htmlFor="reset-password-confirm" className="text-sm font-medium">Confirm new password</label>
        <input
          id="reset-password-confirm"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          className="w-full rounded-md border bg-background px-3 py-2 text-base"
        />
        {mismatch ? (
          <p className="text-sm text-destructive" role="alert">
            Passwords do not match.
          </p>
        ) : null}
      </div>

      {status === "failed" && state.context.error ? (
        <AuthErrorMessage error={state.context.error} />
      ) : null}

      <button
        type="submit"
        disabled={busy || mismatch}
        className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Updating password…" : "Update password"}
      </button>
    </form>
  );
}
