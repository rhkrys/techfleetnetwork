import { type AuthResult, ok, err } from "../domain/auth-result";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed consume-recovery-link flow. Handles the `?code=...` or
 * `#access_token=...&type=recovery` redirect from a password-reset
 * email and establishes the recovery session.
 *
 * If the link is expired or already used, returns the typed
 * `recovery_session_expired` / `recovery_link_consumed` code so the UI
 * can render the empathetic message from AuthErrorMessage.
 */
export interface ConsumeRecoveryLinkInput {
  /** Full URL the user landed on (e.g. window.location.href). */
  url: string;
  correlationId?: string;
}

export async function consumeRecoveryLink(
  input: ConsumeRecoveryLinkInput,
): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  const url = new URL(input.url);
  const code = url.searchParams.get("code");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const errParam = url.searchParams.get("error") ?? hash.get("error");
  const errCode = url.searchParams.get("error_code") ?? hash.get("error_code");

  await emitAuthBeacon("auth.reset.consume_link", {
    correlationId,
    route: "reset.consume",
  });

  if (errParam || errCode) {
    const mapped =
      errCode === "otp_expired" || errParam === "access_denied"
        ? "recovery_session_expired"
        : "unexpected";
    return err({ code: mapped, correlationId });
  }

  // PKCE-style ?code=...
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const isExpired = /expired|invalid/i.test(error.message ?? "");
      return err({
        code: isExpired ? "recovery_session_expired" : "recovery_link_consumed",
        correlationId,
      });
    }
    return ok({ kind: "password_reset_email_sent", correlationId });
  }

  // Implicit-flow hash tokens are handled by GoTrue automatically; just
  // confirm we have a session.
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    return ok({ kind: "password_reset_email_sent", correlationId });
  }
  return err({ code: "recovery_session_expired", correlationId });
}
