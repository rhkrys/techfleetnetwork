import { type AuthResult, ok, err } from "../domain/auth-result";
import { classifyAuthErrorCode } from "../services/auth-classifier";
import { emitAuthBeacon, newCorrelationId } from "../services/auth-telemetry";
import { supabase } from "@/integrations/supabase/client";

/**
 * Typed sign-up flow. Returns `verification_email_sent` on success.
 *
 * On indeterminate failure (timeout / 5xx / network abort) probes with
 * `signInWithPassword` so a Cloud Auth blip that already persisted the row
 * does not leave the user stranded — see plan SIGNUP-TIMEOUT-PROBE-001..005.
 *
 * Phase 5: direct GoTrue call; Phase 3 broker route adds HIBP +
 * disposable-email + DNS-MX checks and queues the confirmation row
 * transactionally through `application_confirmation_outbox`.
 */
export interface SignUpInput {
  email: string;
  password: string;
  emailRedirectTo?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

const SIGNUP_TIMEOUT_MS = 30_000;

function isIndeterminateStatus(status?: number | null): boolean {
  return !status || status === 0 || status >= 500;
}

export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  await emitAuthBeacon("auth.signup.start", {
    correlationId,
    route: "signup.password",
  });

  const TIMEOUT_SENTINEL = Symbol("signup_timeout");

  try {
    const attempt = supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo:
          input.emailRedirectTo ?? `${window.location.origin}/`,
        data: input.metadata,
      },
    });
    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_SENTINEL), SIGNUP_TIMEOUT_MS),
    );

    const race = await Promise.race([attempt, timeoutPromise]);

    if (race !== TIMEOUT_SENTINEL && !race.error) {
      await emitAuthBeacon("auth.signup.email_sent", {
        correlationId,
        route: "signup.password",
        outcome: "ok",
      });
      return ok({
        kind: "verification_email_sent",
        email: input.email,
        correlationId,
      });
    }

    const isTimeout = race === TIMEOUT_SENTINEL;
    const upstreamError = isTimeout ? null : (race as Awaited<typeof attempt>).error;
    const code = isTimeout ? "service_unavailable" : classifyAuthErrorCode(upstreamError);
    const isIndeterminate = isTimeout || (upstreamError != null && isIndeterminateStatus(upstreamError.status));

    if (isIndeterminate) {
      await emitAuthBeacon("auth.signup.indeterminate", {
        correlationId,
        route: "signup.password",
        outcome: "err",
        errorCode: code,
      }, "warn");

      // Probe whether the row was actually created server-side despite the
      // failure surfaced to the client.
      try {
        const probe = await supabase.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        });
        if (!probe.error && probe.data?.user) {
          await emitAuthBeacon("auth.signup.indeterminate_resolved", {
            correlationId,
            route: "signup.password",
            outcome: "ok",
            details: { resolution: "signed_in" },
          });
          return ok({
            kind: "signed_in",
            userId: probe.data.user.id,
            correlationId,
          });
        }
        const probeCode = (probe.error as { code?: string } | null)?.code ?? "";
        if (probeCode === "email_not_confirmed" || /email not confirmed|not confirmed/i.test(probe.error?.message ?? "")) {
          await emitAuthBeacon("auth.signup.indeterminate_resolved", {
            correlationId,
            route: "signup.password",
            outcome: "ok",
            details: { resolution: "email_not_confirmed" },
          });
          return ok({
            kind: "verification_email_sent",
            email: input.email,
            correlationId,
          });
        }
        const probeClassified = classifyAuthErrorCode(probe.error);
        if (probeClassified === "account_exists") {
          await emitAuthBeacon("auth.signup.indeterminate_resolved", {
            correlationId,
            route: "signup.password",
            outcome: "err",
            details: { resolution: "account_exists" },
          });
          return err({ code: "account_exists", correlationId });
        }
        if (probeClassified === "invalid_credentials") {
          // Row was NOT created → fall through to the original error.
          await emitAuthBeacon("auth.signup.indeterminate_resolved", {
            correlationId,
            route: "signup.password",
            outcome: "err",
            details: { resolution: "not_created" },
          });
        } else {
          // Probe inconclusive — return service_unavailable, do NOT classify
          // as invalid_credentials (would lock the user out of nothing).
          return err({ code: "service_unavailable", correlationId });
        }
      } catch (probeCaught) {
        await emitAuthBeacon("auth.signup.indeterminate_resolved", {
          correlationId,
          route: "signup.password",
          outcome: "err",
          details: { resolution: "probe_threw", probeError: probeCaught instanceof Error ? probeCaught.message : "unknown" },
        });
        // Fall through to original error.
      }
    }

    if (isTimeout) {
      return err({ code: "service_unavailable", correlationId });
    }

    await emitAuthBeacon("auth.signup.error", {
      correlationId,
      route: "signup.password",
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  } catch (caught) {
    const code = classifyAuthErrorCode(caught);
    await emitAuthBeacon("auth.signup.error", {
      correlationId,
      route: "signup.password",
      outcome: "err",
      errorCode: code,
    });
    return err({ code, correlationId });
  }
}
