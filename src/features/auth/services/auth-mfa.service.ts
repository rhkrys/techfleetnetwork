import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { emitAuthBeacon, newCorrelationId } from "./auth-telemetry";
import type { AuthResult } from "../domain/auth-result";
import { ok, err } from "../domain/auth-result";

/**
 * auth-mfa.service — owns the AAL1→AAL2 transition and the post-verify
 * quiet window. Pages never call `supabase.auth.mfa.*` directly; the
 * `no-direct-supabase-auth` lint rule (Phase 5) enforces this.
 *
 * Invariants:
 *  - The 10-second post-verify quiet window lives in this module's memory,
 *    not in a page-level ref; it cannot drift across focus handlers.
 *  - `mfa_invalid_code` is the ONLY error that bumps the MFA-specific
 *    counter (see auth-failure-policy).
 *  - Cancelling an MFA challenge MUST sign out (the auth machine handles
 *    this via the RESET → signed_out transition).
 */

const log = createLogger("auth-mfa.service");

const QUIET_WINDOW_MS = 10_000;
let recentlyVerifiedAt = 0;

export function markRecentlyVerified(now: number = Date.now()): void {
  recentlyVerifiedAt = now;
}

export function isWithinQuietWindow(now: number = Date.now()): boolean {
  return now - recentlyVerifiedAt < QUIET_WINDOW_MS;
}

/**
 * Reset the post-verify quiet window on sign-out so it can never carry into the
 * next user's session on a shared tab (P35 review follow-up). The window is
 * currently read only by the contract test, not a live gate — resetting here
 * keeps it correct-by-construction if `isWithinQuietWindow` is ever wired into
 * one. AuthContext calls this from every sign-out path.
 */
export function resetMfaQuietWindowForSignOut(): void {
  recentlyVerifiedAt = 0;
}

/** Lists current AAL state without leaking provider internals. */
export async function getAal(): Promise<"aal1" | "aal2" | "unknown"> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return "unknown";
    if (data?.currentLevel === "aal2") return "aal2";
    if (data?.currentLevel === "aal1") return "aal1";
    return "unknown";
  } catch (e) {
    log.warn("getAal", "threw", { err: e instanceof Error ? e.message : String(e) });
    return "unknown";
  }
}

export interface MfaVerifyInput {
  factorId: string;
  challengeId: string;
  code: string;
  correlationId?: string;
}

/** Verifies a TOTP code. Returns typed result; throws never cross the boundary. */
export async function verifyTotp(input: MfaVerifyInput): Promise<AuthResult> {
  const correlationId = input.correlationId ?? newCorrelationId();
  try {
    const { error } = await supabase.auth.mfa.verify({
      factorId: input.factorId,
      challengeId: input.challengeId,
      code: input.code,
    });
    if (error) {
      void emitAuthBeacon(
        "auth.mfa.invalid_code",
        { correlationId, errorCode: "mfa_invalid_code" },
        "warn"
      );
      return err({ code: "mfa_invalid_code", correlationId });
    }
    markRecentlyVerified();
    void emitAuthBeacon("auth.mfa.required", { correlationId, outcome: "ok" });
    return ok({ kind: "signed_in", userId: "", correlationId });
  } catch (e) {
    log.warn("verifyTotp", "threw", { err: e instanceof Error ? e.message : String(e) });
    return err({ code: "unexpected", correlationId });
  }
}
