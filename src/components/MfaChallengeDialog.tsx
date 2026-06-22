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
  /** Called once the user successfully completes MFA — session is now AAL2. */
  onSuccess: () => void;
  /** Called if the user cancels — we sign them out, since the session is only AAL1. */
  onCancel: () => void | Promise<void>;
}

/**
 * Industry-standard MFA challenge dialog shown after password login when
 * the user has an enrolled TOTP factor. Session remains at AAL1 until verified.
 *
 * RESILIENCE NOTES (root-cause fix for "Invalid TOTP" on correct codes):
 *  - We DO NOT pre-create a challenge on dialog open. GoTrue's `/challenge`
 *    endpoint occasionally returns 504 after 11s, and even on success the
 *    challenge has a short TTL — by the time the user finishes typing 6
 *    digits, the challenge can already be invalid, producing 422 "Invalid
 *    TOTP code" for codes the user typed correctly.
 *  - Verify ALWAYS routes through `challengeAndVerifyResilient`, which is a
 *    single GoTrue round-trip (challenge created microseconds before verify)
 *    with transparent retry on 504/network only — never on 422.
 *  - On transient errors we KEEP the typed digits so the user can just tap
 *    Verify again without retyping.
 */
export function MfaChallengeDialog({ open, onSuccess, onCancel }: Props) {
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
      toast.success("Verified — welcome back!", { position: "top-center" });
      onSuccess();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed";
      toast.error(message, { position: "top-center" });
      // Only clear the input on a real wrong-code error. Transient infra
      // failures (504, network) leave the user's still-valid digits in place.
      if (e instanceof MfaInvalidCodeError) setCode("");
    } finally {
      setVerifying(false);
    }
  };

  const handleCancel = async () => {
    await onCancel();
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Two-Factor Verification
          </DialogTitle>
          <DialogDescription>
            Open your authenticator app and enter the 6-digit code for your Tech Fleet account.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : !factor ? (
          <p className="py-4 text-sm text-destructive">No active 2FA method found. Please contact support.</p>
        ) : (
          <div className="space-y-2 py-2">
            <Label htmlFor="mfa-challenge-code" className="sr-only">6-digit code</Label>
            <div className="flex justify-center">
              <InputOTP
                id="mfa-challenge-code"
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
          <Button variant="outline" onClick={() => void handleCancel()} disabled={verifying}>
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
