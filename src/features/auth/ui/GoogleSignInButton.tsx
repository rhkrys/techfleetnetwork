import { useAuthMachine } from "../state/use-auth-machine";
import { AuthErrorMessage } from "./AuthErrorMessage";

/**
 * GoogleSignInButton — pure view bound to the auth state machine.
 * The flow handles the OAuth redirect; this component only renders state.
 */
export function GoogleSignInButton({
  redirectTo,
  label = "Continue with Google",
}: {
  redirectTo?: string;
  label?: string;
}) {
  const { state, submitGoogle } = useAuthMachine("signin_google");
  const status = state.value as string;
  const busy =
    status === "submitting" ||
    status === "redirecting_to_provider";

  return (
    <div className="space-y-2" data-testid="google-signin-wrapper" data-machine-state={status}>
      <button
        type="button"
        onClick={() => {
          if (busy) return;
          void submitGoogle(redirectTo);
        }}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-base hover:bg-muted disabled:opacity-60"
        data-testid="google-signin-button"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
        </svg>
        {busy ? "Redirecting…" : label}
      </button>

      {status === "failed" && state.context.error ? (
        <AuthErrorMessage error={state.context.error} />
      ) : null}
    </div>
  );
}
