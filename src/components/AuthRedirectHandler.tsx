import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeSafeRedirectTarget } from "@/lib/security";
import { isOAuthCallbackPending } from "@/lib/auth/oauth-callback-pending";
import { readOAuthErrorFragment, clearOAuthErrorFragment } from "@/lib/auth/oauth-error-fragment";
import { recordLoginEvent, newAttemptId } from "@/lib/login-telemetry";
import { toast } from "sonner";

const AUTH_REDIRECT_KEY = "auth_redirect";

function readStoredRedirect() {
  try {
    return sessionStorage.getItem(AUTH_REDIRECT_KEY) ?? localStorage.getItem(AUTH_REDIRECT_KEY);
  } catch {
    return null;
  }
}

function clearStoredRedirect() {
  try { sessionStorage.removeItem(AUTH_REDIRECT_KEY); } catch { /* storage disabled */ }
  try { localStorage.removeItem(AUTH_REDIRECT_KEY); } catch { /* storage disabled */ }
}

export function AuthRedirectHandler() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // AUTH-OAUTH-ERROR-FRAGMENT-001 — Detect `#error=…&error_description=…` left
  // by a failed OAuth broker round-trip. Without this guard the user lands on
  // the logged-out home with no signal.
  useEffect(() => {
    const fragment = readOAuthErrorFragment(location.hash);
    if (!fragment) return;
    clearOAuthErrorFragment();
    const description = fragment.description || "Google sign-in didn't complete.";
    toast.error(`${description} Please try again.`, { duration: 30000, position: "top-center" });
    try {
      recordLoginEvent(newAttemptId(), "server_error", {
        branch: `oauth_broker:${fragment.error}`,
      });
    } catch { /* telemetry never throws */ }
    navigate("/login?from=oauth-error", { replace: true });
  }, [location.hash, navigate]);

  useEffect(() => {
    if (loading || !user) return;
    // Never navigate while the OAuth callback consumer is mid-flight — would
    // race AuthContext stripping the hash + redirecting to the stored target.
    if (isOAuthCallbackPending()) return;
    const storedRedirect = readStoredRedirect();
    const isAuthLandingPage = location.pathname === "/" || location.pathname === "/login";
    if (!storedRedirect && !isAuthLandingPage) return;

    if (storedRedirect) clearStoredRedirect();
    const target = normalizeSafeRedirectTarget(storedRedirect || "/dashboard");
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (target !== current) navigate(target, { replace: true });
  }, [loading, user, navigate, location.pathname, location.search, location.hash]);

  return null;
}
