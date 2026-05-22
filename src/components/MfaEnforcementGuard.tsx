import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { MfaService } from "@/services/mfa.service";
import { MfaChallengeDialog } from "@/components/MfaChallengeDialog";
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";

const log = createLogger("MfaEnforcementGuard");

/**
 * Global TOTP MFA gate. Runs on every authenticated session and forces a TOTP
 * challenge whenever the user has a verified TOTP factor and the current session
 * is below AAL2.
 *
 * Resilience: derives the decision from `MfaService.getMfaGateDecision()`, which
 * does NOT rely on the (sometimes stale) `nextLevel` JWT claim. Re-evaluates on
 * `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`, and on window focus so that
 * post-OAuth and post-refresh sessions are also caught.
 *
 * Loop-prevention: after a successful verify we silence re-checks for 10s so
 * the focus/TOKEN_REFRESHED storm that immediately follows can't race the JWT
 * cache update and re-prompt the user (AUTH-2FA-LOOP-001..003).
 */
const POST_VERIFY_QUIET_MS = 10_000;

export function MfaEnforcementGuard() {
  const { user, session, loading } = useAuth();
  const [challengeOpen, setChallengeOpen] = useState(false);
  const lastCheckedToken = useRef<string | null>(null);
  const inFlight = useRef(false);
  const recentlyVerifiedAt = useRef<number>(0);

  useEffect(() => {
    if (loading || !user || !session) {
      lastCheckedToken.current = null;
      setChallengeOpen(false);
      return;
    }

    const runCheck = async (token: string) => {
      if (inFlight.current) return;
      // Quiet window right after a successful verify — JWT cache is still
      // catching up; re-checking now would falsely re-prompt.
      if (Date.now() - recentlyVerifiedAt.current < POST_VERIFY_QUIET_MS) return;
      // Skip if we already evaluated this exact access token
      if (lastCheckedToken.current === token) return;
      lastCheckedToken.current = token;
      inFlight.current = true;
      try {
        const { needsChallenge } = await MfaService.getMfaGateDecision();
        if (needsChallenge) {
          log.info("check", `User ${user.id} has verified TOTP but session is below AAL2 — prompting challenge`);
          setChallengeOpen(true);
        }
      } catch (e) {
        log.warn("check", `Gate check failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        inFlight.current = false;
      }
    };

    void runCheck(session.access_token);

    // Re-evaluate on auth state changes. Per Supabase guidance, never `await`
    // inside the callback — defer with queueMicrotask to avoid deadlocks.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!newSession?.access_token) return;
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        const token = newSession.access_token;
        queueMicrotask(() => { void runCheck(token); });
      }
    });

    // Re-evaluate on focus regain in case the gate was bypassed in another tab.
    // Re-read the token from the SDK (not the stale closure) so a freshly
    // elevated AAL2 token is honoured immediately.
    const onFocus = async () => {
      if (Date.now() - recentlyVerifiedAt.current < POST_VERIFY_QUIET_MS) return;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        lastCheckedToken.current = null;
        void runCheck(token);
      } catch {
        /* non-blocking */
      }
    };
    window.addEventListener("focus", onFocus);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [user, session, loading]);

  return (
    <MfaChallengeDialog
      open={challengeOpen}
      onSuccess={() => {
        recentlyVerifiedAt.current = Date.now();
        setChallengeOpen(false);
        // Force re-evaluation on next render so we recognise the new AAL2 token
        lastCheckedToken.current = null;
      }}
      onCancel={async () => {
        setChallengeOpen(false);
        // User refused MFA — sign out fully to prevent half-authenticated AAL1 access
        await supabase.auth.signOut();
        window.location.replace("/login");
      }}
    />
  );
}
