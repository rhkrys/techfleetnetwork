/**
 * use-membership-realtime — keeps the user's profile in sync with backend
 * changes to membership state without manual reload.
 *
 * Triggers:
 *   1. On mount: fires a one-time gumroad-reconcile call to attach any
 *      pre-signup or webhook-missed Gumroad sales to the current user.
 *   2. Subscribes to postgres_changes on `profiles` filtered by user_id.
 *      When membership_tier or is_founding_member changes, calls
 *      `refreshProfile()` and shows a celebratory toast.
 *
 * Why a dedicated hook (not part of useAuth):
 *   - Reconciliation should run once per app session, not on every auth
 *     state change. The hook owns its own ran-flag to avoid duplicate calls.
 *   - Realtime channels need precise teardown to avoid memory leaks during
 *     hot module replacement. Co-locating with the page that needs it keeps
 *     subscription lifetimes short and predictable.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createLogger } from "@/services/logger.service";
import { useDeferredMount } from "@/lib/defer-until-idle";

const log = createLogger("MembershipRealtime");

const TIER_LABEL: Record<string, string> = {
  starter: "Free",
  community: "Early Career Membership",
  professional: "Professional",
};

/** Session-scoped key so the (Gumroad-API) backfill runs at most once per
 *  browser session per user, even if the hosting page remounts on navigation. */
function backfillSessionKey(userId: string): string {
  return `tfn.gumroad.backfill.v1.${userId}`;
}

export function useMembershipRealtime() {
  const { user, profile, refreshProfile } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const reconciledRef = useRef(false);
  const lastTierRef = useRef<string | null>(null);
  const lastFoundingRef = useRef<boolean | null>(null);
  const lastBillingRef = useRef<string | null>(null);
  // Defer the realtime WebSocket handshake until the browser is idle so it
  // never delays first paint on slow networks. The reconcile/backfill effect
  // below remains immediate — it's a one-shot HTTP call, not a channel.
  const ready = useDeferredMount();

  // Track current state so the realtime callback can detect transitions.
  useEffect(() => {
    if (profile) {
      const tier = (profile as unknown as { membership_tier?: string }).membership_tier ?? null;
      const founding = Boolean(
        (profile as unknown as { is_founding_member?: boolean }).is_founding_member
      );
      const billing =
        (profile as unknown as { membership_billing_period?: string }).membership_billing_period ??
        null;
      // Only seed on first sight — don't overwrite once realtime is live.
      if (lastTierRef.current === null) lastTierRef.current = tier;
      if (lastFoundingRef.current === null) lastFoundingRef.current = founding;
      if (lastBillingRef.current === null) lastBillingRef.current = billing;
    }
  }, [profile]);

  // 1. One-time reconcile + backfill on mount per session.
  //    Reconcile runs first (fast — DB-only). Backfill runs second (slower —
  //    calls Gumroad API) and only refreshes the profile if it imported sales
  //    that reconcile didn't already cover. Either failing is non-fatal:
  //    realtime + manual refresh remain available.
  useEffect(() => {
    if (!user || reconciledRef.current) return;
    reconciledRef.current = true;
    setSyncing(true);
    (async () => {
      let appliedFromReconcile = 0;

      try {
        const { data, error } = await supabase.functions.invoke("gumroad-reconcile", { body: {} });
        if (error) {
          log.warn("reconcile", `Reconcile failed: ${error.message}`, {
            userId: user.id,
          });
        } else if (data?.applied && data.applied > 0) {
          appliedFromReconcile = data.applied;
          log.info("reconcile", `Applied ${data.applied} pending sale(s) for user ${user.id}`, {
            userId: user.id,
            tier: data.tier,
          });
          await refreshProfile();
        }
      } catch (err) {
        log.warn("reconcile", `Unexpected reconcile error: ${(err as Error).message}`, {
          userId: user.id,
        });
      }

      // Backfill from Gumroad API — picks up historical sales the webhook never
      // saw. Expensive + rate-limited, so run at most once per browser session
      // (recognition otherwise flows server-side via webhook + triggers + the
      // nightly sweep). A session flag survives page remounts.
      const backfillKey = backfillSessionKey(user.id);
      let backfillAlreadyRan = false;
      try {
        backfillAlreadyRan = sessionStorage.getItem(backfillKey) === "1";
      } catch {
        /* sessionStorage unavailable (SSR/private mode) — fall through */
      }
      if (backfillAlreadyRan) {
        setSyncing(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("gumroad-backfill", { body: {} });
        try {
          sessionStorage.setItem(backfillKey, "1");
        } catch {
          /* ignore */
        }
        if (error) {
          log.warn("backfill", `Backfill failed: ${error.message}`, {
            userId: user.id,
          });
          return;
        }
        if (data?.imported && data.imported > appliedFromReconcile) {
          log.info("backfill", `Imported ${data.imported} historical sale(s) for user ${user.id}`, {
            userId: user.id,
            tier: data.tier,
          });
          await refreshProfile();
        }
      } catch (err) {
        log.warn("backfill", `Unexpected backfill error: ${(err as Error).message}`, {
          userId: user.id,
        });
      } finally {
        setSyncing(false);
      }
    })();
  }, [user, refreshProfile]);

  // 2. Realtime subscription on profiles row (deferred until browser idle).
  useEffect(() => {
    if (!user || !ready) return;

    const channel = supabase
      .channel(`user:${user.id}:profile-membership`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const next = payload.new as {
            membership_tier?: string;
            is_founding_member?: boolean;
            membership_billing_period?: string;
          };
          const prevTier = lastTierRef.current;
          const prevFounding = lastFoundingRef.current;
          const prevBilling = lastBillingRef.current;
          const newTier = next.membership_tier ?? null;
          const newFounding = Boolean(next.is_founding_member);
          const newBilling = next.membership_billing_period ?? null;

          const tierChanged = prevTier !== null && prevTier !== newTier;
          const foundingFlipped = prevFounding !== null && prevFounding !== newFounding;
          const billingChanged = prevBilling !== null && prevBilling !== newBilling;

          if (tierChanged || foundingFlipped || billingChanged) {
            log.info(
              "realtime",
              `Membership updated for user ${user.id}: ${prevTier} → ${newTier} (founding: ${newFounding})`,
              {
                userId: user.id,
                from: prevTier,
                to: newTier,
                founding: newFounding,
                billingPeriod: newBilling,
              }
            );

            const tierName = newTier ? (TIER_LABEL[newTier] ?? newTier) : "your tier";
            const message = newFounding
              ? `🎉 Welcome, Founding Member! Your ${tierName} access is live.`
              : `🎉 Your ${tierName} membership is now active.`;

            toast.success(message, {
              position: "top-center",
              duration: 6000,
            });

            lastTierRef.current = newTier;
            lastFoundingRef.current = newFounding;
            lastBillingRef.current = newBilling;
            void refreshProfile();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, ready, refreshProfile]);

  return { syncing: Boolean(user) && (!reconciledRef.current || syncing) };
}
