import { supabase } from "@/integrations/supabase/client";
import { isLikelyJwt, isOpaqueRefreshToken, ClientSessionWriteError } from "@/lib/auth/session-health";
import { createLogger } from "@/services/logger.service";

/**
 * auth-flow.service — the ONLY module allowed to call `supabase.auth.*`
 * for credentialed flows. Phase 5 ESLint rule `no-direct-supabase-auth`
 * will enforce this; today the rule is socially enforced (this file
 * exists, has the mutex, has the Vichea fix, has the tests).
 *
 * Public surface:
 *   - setSessionSafe(tokens)         single-flight, Vichea-safe
 *   - signOutSafe()                  best-effort GoTrue signOut
 *
 * INVARIANT (Vichea):
 *   - access_token  → MUST be a 3-segment base64url JWT (isLikelyJwt)
 *   - refresh_token → MUST be a non-empty opaque string (isOpaqueRefreshToken)
 *     NEVER apply isLikelyJwt to a refresh token. CI-locked by
 *     `src/lib/__tests__/auth-vichea-regression.test.ts` and the new
 *     `auth-flow.service.test.ts`.
 */

const log = createLogger("auth-flow.service");

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

// Single-flight mutex so a double-click cannot trigger two setSession calls.
let inFlight: Promise<void> | null = null;

export async function setSessionSafe(tokens: SessionTokens): Promise<void> {
  if (inFlight) return inFlight;

  if (!isLikelyJwt(tokens.access_token)) {
    throw new ClientSessionWriteError("access_token_invalid");
  }
  if (!isOpaqueRefreshToken(tokens.refresh_token)) {
    throw new ClientSessionWriteError("refresh_token_invalid");
  }

  inFlight = (async () => {
    try {
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (error) {
        log.warn("setSession", "setSession rejected", { msg: error.message });
        throw new ClientSessionWriteError("set_session_rejected", "Sign-in didn't complete — please try again.");
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function signOutSafe(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    // Best-effort: revocation row is the authoritative kill switch.
    log.warn("signOut", "signOut threw (non-fatal)", { err: err instanceof Error ? err.message : String(err) });
  }
}
