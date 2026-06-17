import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ArrowRight, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { MfaService } from "@/services/mfa.service";
import { supabase } from "@/integrations/supabase/client";

/**
 * Persistent setup popup shown to admins who:
 *   - have NO verified TOTP factor, AND
 *   - are still inside the 5-day grace window (`admin_2fa_grace_active = true`).
 *
 * The dialog is non-dismissible by design — the only ways out are:
 *   1. Finish 2FA enrollment in /profile/edit (auto-detected on next 10s poll).
 *   2. Sign out.
 *
 * Hidden on the auth pages and on the enrollment page itself so it never sits
 * on top of the form a user is trying to fill out. After grace expires, the
 * AdminRoute lockout screen takes over for /admin/* and this dialog stays hidden.
 */
const POLL_INTERVAL_MS = 10_000;

export function AdminTwoFactorGraceDialog() {
  const { user, profileLoaded, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const location = useLocation();
  const [hasTotp, setHasTotp] = useState<boolean | null>(null);
  const [graceActive, setGraceActive] = useState<boolean | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);

  // Suppress on routes where this would overlap the actual setup or auth flows.
  const suppressedRoute =
    location.pathname.startsWith("/profile/edit") ||
    location.pathname.startsWith("/login") ||
    location.pathname.startsWith("/register") ||
    location.pathname.startsWith("/reset-password") ||
    location.pathname.startsWith("/forgot-password") ||
    location.pathname.startsWith("/confirm-admin") ||
    location.pathname.startsWith("/confirm-teacher") ||
    location.pathname.startsWith("/unsubscribe");

  useEffect(() => {
    let cancelled = false;
    if (authLoading || adminLoading || !profileLoaded || !user || !isAdmin) {
      setHasTotp(null);
      setGraceActive(null);
      setDeadline(null);
      return;
    }

    const refresh = async () => {
      try {
        const [hasTotpResult, graceResult, deadlineResult] = await Promise.allSettled([
          MfaService.hasVerifiedTotp(),
          (supabase as any).rpc("admin_2fa_grace_active", { _user_id: user.id }),
          (supabase as any).rpc("admin_2fa_grace_deadline", { _user_id: user.id }),
        ]);
        if (cancelled) return;
        setHasTotp(hasTotpResult.status === "fulfilled" ? hasTotpResult.value : null);
        setGraceActive(
          graceResult.status === "fulfilled" && !graceResult.value.error
            ? graceResult.value.data === true
            : null,
        );
        setDeadline(
          deadlineResult.status === "fulfilled" && !deadlineResult.value.error
            ? (deadlineResult.value.data as string | null)
            : null,
        );
      } catch {
        // Fail closed (don't render) rather than nag with a broken state.
      }
    };

    void refresh();
    const id = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [authLoading, adminLoading, profileLoaded, user, isAdmin]);

  const shouldShow =
    !!user && isAdmin && !suppressedRoute && hasTotp === false && graceActive === true;

  const daysLeft = (() => {
    if (!deadline) return null;
    const ms = new Date(deadline).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  })();

  const handleSignOut = async () => {
    await signOutSafe({ scope: "global", reason: "admin_action" });
    window.location.replace("/login");
  };

  return (
    <Dialog open={shouldShow}>
      <DialogContent
        className="max-w-md"
        hideCloseButton
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Set up admin 2FA
          </DialogTitle>
          <DialogDescription>
            You were promoted to admin and have a 5-day grace period to set up
            Google Authenticator-compatible 2FA.
            {typeof daysLeft === "number" && daysLeft > 0 && (
              <>
                {" "}
                <strong className="text-foreground">
                  {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining.
                </strong>
              </>
            )}
            {" "}You can keep using the rest of Tech Fleet Network normally,
            but this reminder will stay until you finish.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => void handleSignOut()}>
            Sign out
          </Button>
          <Button asChild>
            <Link to="/profile/edit?tab=account">
              Set up 2FA now
              <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden="true" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
