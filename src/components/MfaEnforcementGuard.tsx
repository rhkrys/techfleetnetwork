import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
 * `SIGNED_IN`, `TOKEN_REFRESHED`, and `USER_UPDATED` — the SDK fires
 * `TOKEN_REFRESHED` automatically when the access token rotates, so any AAL2
 * elevation done in another tab is picked up without needing a manual focus
 * listener.
 *
 * NO-RELOAD-TAB-002 (2026-06-16): the previous `window.addEventListener("focus")`
 * handler called `supabase.auth.getSession()` on every tab return and could
 * `window.location.replace("/login")` if the SDK transiently returned no
 * session — that landed users (especially admins on /admin/activity-log) on a
 * full-page navigation that destroyed their scroll, filters, search, and page
 * index. The focus listener is intentionally removed; `onAuthStateChange` is
 * the single re-eval channel.
 *
 * Loop-prevention: after a successful verify we silence re-checks for 10s so
 * the TOKEN_REFRESHED storm that immediately follows can't race the JWT cache
 * update and re-prompt the user (AUTH-2FA-LOOP-001..003).
 */
const POST_VERIFY_QUIET_MS = 10_000;

export function MfaEnforcementGuard() {
  const { user, session, loading } = useAuth();
  const navigate = useNavigate();
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
    // TOKEN_REFRESHED fires automatically on token rotation (including after
    // an AAL2 elevation in another tab), which makes the prior focus listener
    // redundant. See NO-RELOAD-TAB-002.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!newSession?.access_token) return;
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        const token = newSession.access_token;
        queueMicrotask(() => { void runCheck(token); });
      }
    });

    return () => {
      sub.subscription.unsubscribe();
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
        // User refused MFA — sign out fully to prevent half-authenticated AAL1 access.
        // SPA navigation (not window.location.replace) so React Query cache,
        // scroll, and any open admin grids survive the redirect. See NO-RELOAD-TAB-002.
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
      }}
    />
  );
}
