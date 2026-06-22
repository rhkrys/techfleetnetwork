import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MfaService, MfaInvalidCodeError, type TotpFactor } from "@/services/mfa.service";

interface Props {
  open: boolean;
  /** Action being re-verified, e.g. "promote this member to admin". Shown in dialog copy. */
  actionLabel?: string;
  /** Called after a successful TOTP verification — caller should retry the original action. */
  onSuccess: () => void;
  /** Called when the user dismisses the dialog without verifying. Caller should abort. */
  onCancel: () => void;
}

/**
 * Step-up TOTP dialog for re-verifying a logged-in admin. See
 * `MfaChallengeDialog` for the resilience rationale — same single-round-trip
 * pattern (no pre-created challenge) applies here.
 */
export function StepUpMfaDialog({ open, actionLabel, onSuccess, onCancel }: Props) {
  const [factor, setFactor] = useState<TotpFactor | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setLoading(true);
    void MfaService.listFactors()
      .then((list) => {
        const verified = list.find((f) => f.factor_type === "totp" && f.status === "verified");
        setFactor(verified ?? null);
      })
      .catch(() => setFactor(null))
      .finally(() => setLoading(false));
  }, [open]);

  const handleVerify = async () => {
    if (!factor || code.length !== 6) return;
    setVerifying(true);
    try {
      await MfaService.challengeAndVerifyResilient(factor.id, code);
      toast.success("Verified — continuing your action.", { position: "top-center" });
      onSuccess();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed";
      toast.error(message, { position: "top-center" });
      if (e instanceof MfaInvalidCodeError) setCode("");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Confirm it's you</DialogTitle>
          <DialogDescription>
            For your security, enter the 6-digit code from your authenticator app to
            {actionLabel ? ` ${actionLabel}` : " continue this admin action"}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : !factor ? (
          <p className="py-4 text-sm text-destructive">
            No active 2FA method found on your account. Please contact support.
          </p>
        ) : (
          <div className="space-y-2 py-2">
            <Label htmlFor="stepup-mfa-code" className="sr-only">6-digit code</Label>
            <div className="flex justify-center">
              <InputOTP
                id="stepup-mfa-code"
                maxLength={6}
                value={code}
                onChange={setCode}
                disabled={verifying}
                autoFocus
                onComplete={(v) => { if (v.length === 6) void handleVerify(); }}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={verifying}>
            Cancel
          </Button>
          <Button onClick={handleVerify} disabled={verifying || code.length !== 6 || !factor}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span className={verifying ? "ml-2" : ""}>Verify</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
