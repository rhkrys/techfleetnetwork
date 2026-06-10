import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { recordResetTelemetry } from "@/lib/auth/reset-telemetry";

/**
 * AUTH-RESET-PREFETCH-001..005
 *
 * Two-step recovery landing page. The password-reset email points here
 * instead of directly at /reset-password so that link-prefetchers (Outlook
 * SafeLinks, Proofpoint, Slack/iMessage unfurlers, antivirus scanners) do
 * NOT consume the single-use recovery `token_hash` before the real human
 * clicks. We render a button that copies the token_hash/type into the
 * /reset-password URL only when the user clicks — meaning automated GETs
 * to this page are harmless.
 *
 * Defense in depth:
 *  - Page emits no `verifyOtp` call.
 *  - `noindex` meta + no-store header (public/_headers) prevents proxies
 *    from caching the link contents.
 *  - Form button uses an explicit user gesture; never auto-submits.
 */
export default function ConfirmRecoveryLinkPage() {
  const navigate = useNavigate();
  const [proceeding, setProceeding] = useState(false);

  const { tokenHash, type, hasToken } = useMemo(() => {
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") || "recovery";
    return { tokenHash, type, hasToken: Boolean(tokenHash) };
  }, []);

  useEffect(() => {
    // Tag a beacon so we can see how often pre-fetchers hit this gate vs.
    // real humans clicking through. No PII, no token content.
    recordResetTelemetry({
      branch: "no_params",
      outcome: hasToken ? "ok" : "missing_proof_blocked",
      has_token_hash: hasToken,
    });
  }, [hasToken]);

  const handleContinue = () => {
    if (!hasToken || proceeding) return;
    setProceeding(true);
    const params = new URLSearchParams();
    params.set("token_hash", tokenHash!);
    params.set("type", type);
    // Use replace so the prefetcher-safe URL doesn't sit in history.
    navigate(`/reset-password?${params.toString()}`, { replace: true });
  };

  if (!hasToken) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Reset link looks incomplete</h1>
          <p className="text-muted-foreground">
            Open the most recent password-reset email and tap the button there. If the link still won't work, request a fresh one.
          </p>
          <Link to="/forgot-password"><Button variant="outline" className="w-full">Send a new reset link</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-5">
        <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto dark:invert" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-foreground">Continue resetting your password</h1>
        <p className="text-muted-foreground">
          For your safety, we wait for you to confirm before we activate this reset link. Tap continue and we'll take you straight to the new-password screen.
        </p>
        <Button onClick={handleContinue} disabled={proceeding} className="w-full">
          {proceeding ? "One moment…" : "Continue resetting password"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Didn't request this? You can safely close this page — your password stays the same.
        </p>
      </div>
    </div>
  );
}
