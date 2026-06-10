import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * AUTH-RESET-PREFETCH-001 (v2): legacy route kept for backward compatibility
 * with reset emails sent under the older two-route design. The prefetch
 * gate now lives inside /reset-password itself, so this page just forwards
 * the query string. Replace navigation (no history entry) so the
 * prefetcher-safe URL doesn't sit in browser history.
 */
export default function ConfirmRecoveryLinkPage() {
  const location = useLocation();
  useEffect(() => { /* no-op: ensures hooks ordering across renders */ }, []);
  const search = location.search || "";
  return <Navigate to={`/reset-password${search}`} replace />;
}
