import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";

/**
 * AUTH-RESET-PREFETCH-001: inert landing route for recovery emails.
 * Link scanners may GET this page, but verifyOtp never runs until a human
 * clicks the button and we navigate to /reset-password with reset_intent.
 */
export default function ConfirmRecoveryLinkPage() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { /* no-op: ensures hooks ordering across renders */ }, []);

  const handleContinue = () => {
    const params = new URLSearchParams(location.search);
    params.set("reset_intent", "confirm");
    navigate(`/reset-password?${params.toString()}`, { replace: true });
  };

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8 space-y-5">
        <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto dark:invert" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-foreground">Continue resetting your password</h1>
        <p className="text-muted-foreground">
          For your safety, we wait for you to confirm before we activate this reset link.
        </p>
        <Button onClick={handleContinue} className="w-full">
          Continue resetting password
        </Button>
        <p className="text-xs text-muted-foreground">
          Didn't request this? You can safely close this page — your password stays the same.
        </p>
      </div>
    </div>
  );
}
