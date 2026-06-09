import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AuthErrorMessage } from "./AuthErrorMessage";
import type { AuthErr } from "../domain/auth-result";

/**
 * MfaChallengeDialog — pure view rendered when the machine is in
 * `awaiting_mfa`. The parent owns the TOTP verification call (still
 * routed through the existing MfaService) and reports outcome via
 * `onSubmit`. This component never touches `supabase.auth` directly.
 */
export function MfaChallengeDialog({
  open,
  challengeId,
  error,
  busy,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  challengeId: string | null;
  error: AuthErr | null;
  busy: boolean;
  onSubmit: (code: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) setCode("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent data-testid="mfa-challenge-dialog">
        <DialogHeader>
          <DialogTitle>Verify your identity</DialogTitle>
          <DialogDescription>
            Open your authenticator app and enter the 6-digit code.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || code.length !== 6) return;
            void onSubmit(code);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="challenge-id" value={challengeId ?? ""} />
          <div className="space-y-1.5">
            <label htmlFor="mfa-code" className="text-sm font-medium">Authentication code</label>
            <input
              id="mfa-code"
              name="one-time-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={busy}
              className="w-full rounded-md border bg-background px-3 py-2 text-center font-mono text-lg tracking-widest"
            />
          </div>

          {error ? <AuthErrorMessage error={error} /> : null}

          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border px-4 py-2"
            >
              Cancel and sign out
            </button>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
