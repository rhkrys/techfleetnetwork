import { useRef, useState } from "react";
import { Button } from "@/design-system";

import { supabase } from "@/integrations/supabase/client";
import { isSafeRedirectUrl } from "@/lib/security";
import { markOAuthUiInitiated } from "@/lib/oauth-ui-guard";
import { markOAuthCallbackPending } from "@/lib/auth/oauth-callback-pending";
import { beaconWedge } from "@/lib/auth/session-health";
import { getCanonicalOAuthOrigin } from "@/lib/auth/oauth-origin";
import { toast } from "sonner";

interface GoogleSignInButtonProps {
  label?: string;
  className?: string;
  onBeforeSubmit?: () => boolean;
  redirectTo?: string;
}

const AUTH_REDIRECT_KEY = "auth_redirect";

function storeAuthRedirect(target: string) {
  try {
    localStorage.setItem(AUTH_REDIRECT_KEY, target);
  } catch {
    /* storage disabled */
  }
  try {
    sessionStorage.setItem(AUTH_REDIRECT_KEY, target);
  } catch {
    /* storage disabled */
  }
}

export function GoogleSignInButton({
  label = "Sign in with Google",
  className,
  onBeforeSubmit,
  redirectTo,
}: GoogleSignInButtonProps) {
  const [loading, setLoading] = useState(false);
  const oauthInFlightRef = useRef(false);

  const handleClick = async () => {
    if (oauthInFlightRef.current) return;
    if (onBeforeSubmit && !onBeforeSubmit()) return;
    oauthInFlightRef.current = true;
    setLoading(true);
    try {
      if (redirectTo && redirectTo !== "/dashboard" && isSafeRedirectUrl(redirectTo)) {
        storeAuthRedirect(redirectTo);
      }
      // Native Supabase Google OAuth against the owned project. (Replaced the
      // Lovable Cloud adapter `lovable.auth.signInWithOAuth`, which pointed at
      // Lovable's managed OAuth infra and 404s now that we've migrated off
      // Lovable.) GoogleSignInButton remains the SINGLE Google entrypoint
      // (check-no-direct-google-oauth + no-direct-auth-mutations allowlist it);
      // the return leg (`?code=`/`#access_token=`) is consumed natively by
      // AuthContext via exchangeCodeForSession. redirectTo is pinned to the
      // canonical origin as defense-in-depth.
      markOAuthUiInitiated("google");
      // Arm the callback-pending guard so when Google bounces us back with
      // `?code=` or `#access_token=…`, ProtectedRoute / AuthRedirectHandler
      // defer redirects until the consumer finishes (12s watchdog).
      markOAuthCallbackPending();
      try {
        beaconWedge("oauth_start", "google_sign_in_button");
      } catch {
        /* noop */
      }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getCanonicalOAuthOrigin(),
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) {
        console.error("OAuth provider error occurred");
        toast.error("Google sign-in could not start. Please try again.", {
          duration: 30000,
          position: "top-center",
        });
      }
    } catch {
      console.error("OAuth sign-in failed");
      toast.error("Google sign-in could not start. Please try again.", {
        duration: 30000,
        position: "top-center",
      });
    } finally {
      oauthInFlightRef.current = false;
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      className={`w-full ${className ?? ""}`}
      onClick={handleClick}
      disabled={loading}
    >
      <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      {label}
    </Button>
  );
}
