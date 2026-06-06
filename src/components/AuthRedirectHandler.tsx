import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeSafeRedirectTarget } from "@/lib/security";

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

  useEffect(() => {
    if (loading || !user) return;
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