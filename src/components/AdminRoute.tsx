import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { MfaService } from "@/services/mfa.service";
import { rpcWithTimeout } from "@/lib/db/rpc-with-timeout";
import { reportError } from "@/services/error-reporter.service";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Clock } from "lucide-react";
import { Button } from "@/design-system";

/**
 * Route guard requiring authentication, admin role, and admin authenticator 2FA after the setup grace period.
 * Non-admins are redirected to /dashboard. Admins without 2FA get a setup path.
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, profileLoaded } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const [mfaState, setMfaState] = useState<{
    hasTotp: boolean;
    graceActive: boolean | null;
    deadline: string | null;
  } | null>(null);
  const location = useLocation();
  const toastShown = useRef(false);

  const showAccessDenied = !authLoading && !adminLoading && profileLoaded && user && !isAdmin;

  useEffect(() => {
    if (showAccessDenied && !toastShown.current) {
      toastShown.current = true;
      toast.error("Access denied. Admin privileges required.");
    }
  }, [showAccessDenied]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !isAdmin) {
      setMfaState(null);
      return;
    }
    void (async () => {
      setMfaState(null);
      const [hasTotpResult, deadlineResult, graceResult] = await Promise.allSettled([
        MfaService.hasVerifiedTotp(),
        rpcWithTimeout<string | null>("admin_2fa_grace_deadline", { _user_id: user.id }),
        rpcWithTimeout<boolean>("admin_2fa_grace_active", { _user_id: user.id }),
      ]);
      if (cancelled) return;
      const hasTotp = hasTotpResult.status === "fulfilled" ? hasTotpResult.value : false;
      const deadlineRes = deadlineResult.status === "fulfilled" ? deadlineResult.value : null;
      const graceRes = graceResult.status === "fulfilled" ? graceResult.value : null;
      const timedOut =
        deadlineRes?.error?.code === "RPC_TIMEOUT" || graceRes?.error?.code === "RPC_TIMEOUT";
      if (timedOut) {
        // Fail open: never block admin render on a wedged PostgREST stream.
        // The dialog/banner reconciles on the next successful poll.
        reportError("admin 2FA grace RPC timed out — failing open", "AdminRoute", {
          eventType: "infra_transient",
          severity: "warn",
          extraFields: ["fingerprint:admin_2fa_rpc_timeout"],
        });
      }
      const deadline = deadlineRes && !deadlineRes.error ? deadlineRes.data : null;
      const graceActive = graceRes && !graceRes.error ? graceRes.data === true : null;
      setMfaState({ hasTotp, graceActive, deadline });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin]);

  if (authLoading || adminLoading || !profileLoaded || (isAdmin && mfaState === null)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          role="status"
        >
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isAdmin) {
    return (
      <Navigate
        to="/access-denied"
        state={{
          from: location,
          reason:
            "Admin access is required for this page. You can continue using the rest of Tech Fleet Network normally.",
        }}
        replace
      />
    );
  }

  if (mfaState && !mfaState.hasTotp && mfaState.graceActive === false) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4 rounded-lg border bg-card p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Admin 2FA setup required</h1>
          <p className="text-sm text-muted-foreground">
            You're signed in, but admin access now requires a Google Authenticator-compatible 2FA
            code. Set it up from your account settings to continue.
          </p>
          <Button asChild>
            <Link to="/profile/edit?tab=account">Set up 2FA</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            You can keep using the rest of Tech Fleet Network normally in the meantime.
          </p>
        </div>
      </div>
    );
  }

  if (mfaState && !mfaState.hasTotp && mfaState.graceActive === true) {
    return (
      <>
        <div className="border-b border-primary/30 bg-primary/10">
          <div className="container-app flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 text-sm">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">Admin 2FA setup grace period</p>
                <p className="text-muted-foreground">
                  Set up Google Authenticator-compatible 2FA before{" "}
                  {mfaState.deadline
                    ? new Date(mfaState.deadline).toLocaleDateString()
                    : "the deadline"}{" "}
                  to keep admin access uninterrupted.
                </p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link to="/profile/edit?tab=account">Set up 2FA</Link>
            </Button>
          </div>
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
