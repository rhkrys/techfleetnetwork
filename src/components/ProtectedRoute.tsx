import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { isOAuthCallbackPending } from "@/lib/auth/oauth-callback-pending";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // While AuthContext is still consuming an OAuth callback (PKCE `?code=` or
  // implicit `#access_token=…&refresh_token=…`) the user is briefly null even
  // though sign-in is succeeding. Redirecting to /login here is the bug that
  // bounced Gmail logins back to the home page — defer until the consumer
  // finishes or its 12s watchdog trips. See src/lib/auth/oauth-callback-pending.ts
  if ((loading || !user) && isOAuthCallbackPending()) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
          <span className="sr-only">Finishing sign-in…</span>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
