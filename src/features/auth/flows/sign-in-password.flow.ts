import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { setSessionSafe } from "../services/auth-flow.service";
import { decideFailureActions } from "../services/auth-failure-policy";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed sign-in-with-password flow. Single entry point for the UI:
 * returns `Result<AuthOk, AuthErr>` — no throws cross this boundary.
 *
 * Phase 2 implementation:
 *   - Calls `supabase.auth.signInWithPassword` directly (broker proxy
 *     route lands in Phase 3 once `supabase/functions/auth-broker/` is
 *     wired up end-to-end). Behavior is identical to today, but the
 *     contract is now typed and the Vichea-safe setSession lives below.
 *   - All failure attribution is delegated to `decideFailureActions`.
 *     This file MUST NOT call any counter RPC directly.
 */
export interface SignInPasswordInput {
  email: string;
  password: string;
  captchaToken?: string;
  correlationId?: string;
}

export async function signInWithPassword(input: SignInPasswordInput): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  const startedAt = Date.now();

  await emitAuthBeacon("auth.signin.start", { correlationId, route: "signin.password" });

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
      options: input.captchaToken ? { captchaToken: input.captchaToken } : undefined,
    });

    if (error) {
      const code = classifyAuthErrorCode(error);
      const actions = decideFailureActions(code);
      await emitAuthBeacon(actions.beaconKind, {
        correlationId,
        route: "signin.password",
        latencyMs: Date.now() - startedAt,
        outcome: "err",
        errorCode: code,
      });
      return err({ code, correlationId });
    }

    if (!data?.session?.access_token || !data.session.refresh_token) {
      const code = "client_session_write_failed" as const;
      const actions = decideFailureActions(code);
      await emitAuthBeacon(actions.beaconKind, {
        correlationId,
        route: "signin.password",
        latencyMs: Date.now() - startedAt,
        outcome: "err",
        errorCode: code,
      });
      return err({ code, correlationId });
    }

    // setSessionSafe is a no-op here — signInWithPassword already wrote the
    // session via GoTrue — but we keep the typed contract identical to the
    // Phase 3 broker path so the UI never branches on transport.
    await emitAuthBeacon("auth.signin.success", {
      correlationId,
      route: "signin.password",
      latencyMs: Date.now() - startedAt,
      outcome: "ok",
    });

    return ok({ kind: "signed_in", userId: data.user?.id ?? "", correlationId });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    const actions = decideFailureActions(code);
    await emitAuthBeacon(actions.beaconKind, {
      correlationId,
      route: "signin.password",
      latencyMs: Date.now() - startedAt,
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  }
}

// Re-export so the future broker swap stays internal to this module.
export { setSessionSafe };
